"use client";

// Code-режим: обработчики событий стрима и функции управления permission.
//
// Вынесено из chat-streams.ts, чтобы основной стор оставался чисто чатовым.
// Этот модуль НЕ импортирует chatStreams напрямую (циклический импорт).
// Вместо этого экспортирует функции, которые chat-streams.ts вызывает,
// передавая необходимые зависимости (rec, setState, consume, streamChat, nextId).

import { streamChat, type AskUserAnswer, type AskUserQuestionSpec, type ChatEvent } from "@/lib/api";
import {
  answerCodeAgentQuestions,
  resumeCodeAgent,
  streamCodeAgent,
  type CodeAgentAttachment,
} from "@/lib/code/code-agent-stream";
import type { Attachment, BgTask, PendingPermission, PendingQuestions } from "@/lib/code/code-chat-streams";

export function hasLocalCodeAgent(): boolean {
  return typeof window !== "undefined" && !!window.avyDesktop?.codeAgent;
}

function bufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000; // избегаем String.fromCharCode(...massив) на больших файлах (стек аргументов)
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Прочитать вложения в base64 в renderer'е (File.path недоступен в Electron —
 * ни у выбранных через диалог, ни тем более у drag&drop/paste файлов) и
 * собрать одновременно отображаемые чипы (Attachment, для пузыря сообщения)
 * и данные для локального агента (CodeAgentAttachment, инжект в content).
 * Используется вместо серверного uploadSessionFiles для avy-code, когда
 * доступен локальный агент — файл никогда не покидает машину пользователя.
 */
export async function filesToLocalAttachments(
  files: File[],
): Promise<{ display: Attachment[]; forAgent: CodeAgentAttachment[] }> {
  const display: Attachment[] = [];
  const forAgent: CodeAgentAttachment[] = [];
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const data = bufferToBase64(buf);
    const mime = file.type || "application/octet-stream";
    forAgent.push({ name: file.name, mime, data });
    display.push({
      path: file.name, // путь фиктивный (файла в ФС нет) — как раньше делал сервер
      name: file.name,
      mime,
      thumbUrl: mime.startsWith("image/") ? `data:${mime};base64,${data}` : undefined,
    });
  }
  return { display, forAgent };
}

/**
 * Источник событий для НОВОГО сообщения в режиме avy-code: локальный агент
 * внутри Electron (см. code-agent-stream.ts), если он доступен, иначе
 * HTTP+SSE к серверу (streamChat) как раньше. Вызывается из
 * chat-streams.ts:start() — единственная точка входа для обоих режимов
 * (chat/avy-code), поэтому решение "какой источник использовать" для
 * avy-code инкапсулировано здесь, а не веткой в общем сторе.
 *
 * Возвращает null для mode !== "avy-code" — вызывающий берёт streamChat сам.
 */
export function runCodeTurn(
  mode: string | null | undefined,
  req: {
    message: string;
    threadId: string;
    modelId?: string;
    effort?: string | null;
    permissionMode?: string | null;
    signal?: AbortSignal;
    attachments?: { name: string; mime: string; data: string }[];
  },
): AsyncGenerator<ChatEvent> | null {
  if (mode !== "avy-code") return null;
  if (typeof window === "undefined" || !window.avyDesktop?.codeAgent) return null;
  // signal НЕ передаётся вниз: локальный code-agent ход не должен обрываться
  // тем же AbortController, что chat-streams.ts:detach() дёргает при каждом
  // unmount/remount useChat — см. code-agent-stream.ts:subscribeCodeAgentEvents.
  return streamCodeAgent({
    message: req.message,
    threadId: req.threadId,
    roots: [], // мост сам подтянет актуальный workspace треда с сервера
    modelId: req.modelId,
    effort: req.effort,
    permissionMode: req.permissionMode,
    attachments: req.attachments,
  });
}

/** Параметры code-хода, нужные для возобновления после approval. */
export type CodeRunParams = {
  modelId?: string;
  effort?: string | null;
  permissionMode?: string | null;
  onTitle?: (title: string) => void;
  onDone?: (threadId: string) => void;
};

/** Решение по одной карточке approval. message — комментарий пользователя при
 *  «Отклонить с комментарием»: НЕ жёсткий reject — агент продолжает ход, учитывая
 *  его (бэк/HITL читают именно поле message; reject БЕЗ message = жёсткий стоп). */
export type PermissionDecision = {
  type: "approve" | "reject";
  message?: string;
};

/** Ключ владельца карточек в pendingDecisions: оркестратор либо конкретный сабагент. */
const MAIN_OWNER = "__main__";
function ownerKeyOf(p: Pick<PendingPermission, "sub">): string {
  return p.sub ? p.sub.id : MAIN_OWNER;
}

type RunCallbacks = {
  onTitle?: (title: string) => void;
  onDone?: (threadId: string) => void;
};

/** Зависимости store, передаваемые из chat-streams.ts. */
export type StoreDeps = {
  rec: (threadId: string) => {
    state: {
      pendingPermissions: PendingPermission[];
      pendingQuestions: PendingQuestions | null;
      bgTasks: BgTask[];
    };
    codeRun: CodeRunParams | null;
    assistantId: string | null;
    ctrl: AbortController | null;
    pendingDecisions: Map<string, PermissionDecision[]>;
    pendingAnswers: AskUserAnswer[];
    // Promise активного цикла consume() — resume дожидается ПОЛНОГО закрытия
    // прошлого генератора (одна onEvent-подписка на тред, см. chat-streams.ts).
    run: Promise<void> | null;
  };
  setState: (threadId: string, patch: Record<string, unknown>) => void;
  consume: (
    threadId: string,
    source: AsyncGenerator<ChatEvent>,
    assistantId: string,
    cbs: RunCallbacks,
  ) => Promise<void>;
  nextId: () => string;
};

/**
 * Обработать событие permission_request из стрима.
 *
 * Агент вызвал один или несколько тулов параллельно — каждый приходит
 * отдельным permission_request. Накапливаем в очередь; UI показывает
 * карточки по одной, resume уходит после последней.
 */
export function handlePermissionRequest(
  deps: StoreDeps,
  threadId: string,
  ev: {
    interrupt_id?: string;
    tool: string;
    args: Record<string, unknown>;
    sub?: { id: string; type: string; description: string };
  },
): void {
  const r = deps.rec(threadId);
  const next: PendingPermission = {
    interruptId: ev.interrupt_id ?? null,
    tool: ev.tool,
    args: ev.args,
    // sub задан ⇒ карточка от фонового сабагента (роутинг ответа — см. resolvePermission).
    ...(ev.sub ? { sub: ev.sub } : {}),
  };
  deps.setState(threadId, {
    pendingPermissions: [...r.state.pendingPermissions, next],
    // Карточка ОРКЕСТРАТОРА ⇒ ход по определению на паузе (граф прерван) —
    // снимаем isStreaming СРАЗУ, не дожидаясь done хвоста стрима: после
    // interrupt main ещё дописывает чекпоинт, на длинном треде это секунды, и
    // всё это время кнопки карточки были бы disabled (busy в UI = isStreaming).
    // Гонку «resume/новый send, пока хвост не закрылся» закрывает await r.run
    // (см. resolvePermission ниже и chat-streams.ts:start).
    // Карточка САБАГЕНТА (ev.sub) isStreaming НЕ трогает — оркестратор может
    // прямо сейчас продолжать стримить свой ход.
    ...(ev.sub ? {} : { isStreaming: false }),
  });
}

/**
 * Ответить на одну карточку из очереди approval.
 *
 * Агент может вызвать N тулов параллельно → N событий permission_request в
 * очереди. Показываем карточки по одной; решения копим в r.pendingDecisions.
 * Когда пользователь ответил на последнюю карточку — отправляем все решения
 * сразу одним resume и возобновляем ход.
 */
export async function resolvePermission(
  deps: StoreDeps,
  threadId: string,
  decision: "approve" | "reject",
  comment?: string,
): Promise<void> {
  const r = deps.rec(threadId);
  const queue = r.state.pendingPermissions;
  if (queue.length === 0) return;

  // Карточки в очереди могут принадлежать РАЗНЫМ владельцам (оркестратор + N
  // фоновых сабагентов), т.к. approval'ы идут параллельно. Отвечаем на переднюю,
  // копим решение в аккумулятор ЕЁ владельца, и резюмим владельца ТОЛЬКО когда в
  // очереди не осталось его карточек — его батч (возможно, из нескольких
  // параллельных тулов) собран. Так решения разных агентов не смешиваются.
  const card = queue[0];
  const ownerKey = ownerKeyOf(card);

  // comment → поле message: reject С комментарием НЕ жёсткий (агент продолжит,
  // учтя его); reject БЕЗ message = жёсткий стоп (бэк/HITL так и различают).
  const owned = r.pendingDecisions.get(ownerKey) ?? [];
  owned.push({ type: decision, ...(comment ? { message: comment } : {}) });
  r.pendingDecisions.set(ownerKey, owned);

  const remaining = queue.slice(1);
  deps.setState(threadId, { pendingPermissions: remaining });

  // У этого владельца ещё есть карточки в очереди — его батч не готов, ждём
  // (следующая карточка уже показана из remaining, возможно, чужая — не важно).
  if (remaining.some((p) => ownerKeyOf(p) === ownerKey)) return;

  const decisions = owned;
  r.pendingDecisions.delete(ownerKey);

  // Владелец — ФОНОВЫЙ САБАГЕНТ: резюмим ИМЕННО его граф (fire-and-forget). Его
  // ход идёт в панель «Фоновые задачи» через onBackgroundEvent, не в основной
  // чат — поэтому НЕ трогаем isStreaming/assistantId/consume основного треда.
  if (card.sub) {
    const bridge = window.avyDesktop?.codeAgent;
    void bridge?.resolveSubagentPermission?.(threadId, card.sub.id, decisions);
    return;
  }

  // Владелец — ОРКЕСТРАТОР: возобновляем основной ход (стримится в чат).
  const code = r.codeRun;
  if (!code) return;

  // Кнопки карточки активны СРАЗУ после permission_request (isStreaming снят в
  // handlePermissionRequest), а хвост прошлого генератора (main дописывает
  // чекпоинт → done) может ещё дозакрываться. Решение уже зафиксировано выше —
  // дожидаемся полного закрытия и только потом резюмим: у моста одна
  // onEvent-подписка на тред, параллельный consume() задвоил бы события.
  // В типичном случае пользователь думал дольше, чем main дописывал — ожидание
  // здесь нулевое.
  if (r.run) {
    try { await r.run; } catch { /* прошлый ход упал — resume всё равно валиден */ }
  }

  deps.setState(threadId, { isStreaming: true, error: null });

  const assistantId = r.assistantId ?? deps.nextId();
  r.assistantId = assistantId;

  const ctrl = new AbortController();
  r.ctrl = ctrl;
  const run = (async () => {
    try {
      const source = hasLocalCodeAgent()
        ? resumeCodeAgent(threadId, decisions)
        : streamChat(
            {
              message: "",
              threadId,
              modelId: code.modelId,
              effort: code.effort,
              mode: "avy-code",
              permissionMode: code.permissionMode,
              resume: decisions,
            },
            ctrl.signal,
          );
      await deps.consume(threadId, source, assistantId, {
        onTitle: code.onTitle,
        onDone: code.onDone,
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        deps.setState(threadId, { error: (e as Error).message });
      } else {
        return;
      }
    }
    if (r.ctrl === ctrl) r.ctrl = null;
    deps.setState(threadId, { isStreaming: false });
    code.onDone?.(threadId);
  })();
  r.run = run;
  await run;
}

/**
 * Обработать событие ask_user_request из стрима — агент вызвал ask_user.
 *
 * В отличие от permission_request (очередь параллельных тулов), ask_user
 * приходит одним событием со всеми вопросами карточки — кладём его как
 * единственную ожидающую карточку. Пустой массив ответов заводим заранее,
 * чтобы UI мог накапливать выбор по вопросам до отправки.
 */
export function handleAskUserRequest(
  deps: StoreDeps,
  threadId: string,
  ev: { interrupt_id?: string; questions: AskUserQuestionSpec[] },
): void {
  const r = deps.rec(threadId);
  r.pendingAnswers = [];
  deps.setState(threadId, {
    pendingQuestions: {
      interruptId: ev.interrupt_id ?? null,
      questions: ev.questions,
    } satisfies PendingQuestions,
    // Как и у approval-карточки: граф уже прерван, карточка вопросов активна
    // сразу — не ждём done хвоста стрима (см. handlePermissionRequest).
    isStreaming: false,
  });
}

/**
 * Ответить на карточку ask_user (все вопросы сразу) и возобновить ход.
 *
 * answers — по одному на вопрос, в порядке questions. Снимаем карточку с паузы,
 * ставим ход обратно в streaming и резюмируем граф с массивом ответов (resume-
 * канал ask_user, см. sessionManager.resolveQuestions).
 */
export async function resolveQuestions(
  deps: StoreDeps,
  threadId: string,
  answers: AskUserAnswer[],
): Promise<void> {
  const r = deps.rec(threadId);
  const pending = r.state.pendingQuestions;
  const code = r.codeRun;
  if (!pending || !code) return;

  // Снимаем карточку сразу (двойной сабмит отсечётся проверкой pending выше),
  // но resume — только после ПОЛНОГО закрытия прошлого генератора (см.
  // resolvePermission: одна onEvent-подписка на тред).
  deps.setState(threadId, { pendingQuestions: null });
  r.pendingAnswers = [];
  if (r.run) {
    try { await r.run; } catch { /* прошлый ход упал — resume всё равно валиден */ }
  }

  deps.setState(threadId, { isStreaming: true, error: null });

  const assistantId = r.assistantId ?? deps.nextId();
  r.assistantId = assistantId;

  const ctrl = new AbortController();
  r.ctrl = ctrl;
  const run = (async () => {
    try {
      // ask_user есть только у локального агента (серверный code-путь его не
      // порождает) — резюмируем через мост. hasLocalCodeAgent() всегда true, если
      // карточка вообще появилась, но проверяем для симметрии с resolvePermission.
      if (!hasLocalCodeAgent()) return;
      const source = answerCodeAgentQuestions(threadId, answers);
      await deps.consume(threadId, source, assistantId, {
        onTitle: code.onTitle,
        onDone: code.onDone,
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        deps.setState(threadId, { error: (e as Error).message });
      } else {
        return;
      }
    }
    if (r.ctrl === ctrl) r.ctrl = null;
    deps.setState(threadId, { isStreaming: false });
    code.onDone?.(threadId);
  })();
  r.run = run;
  await run;
}

/**
 * Обработать событие bg_task из стрима — панель фоновых задач (bash
 * run_in_background). kind:upsert — добавить/обновить строку по id (task —
 * полный durable-снимок, тот же shape, что отдаёт listBackground); removed —
 * убрать (пользователь удалил из истории). Инициируется main-процессом сам
 * (child.on exit / кнопки панели), поэтому идёт через applyBackgroundEvent.
 */
export function handleBgTaskEvent(
  deps: StoreDeps,
  threadId: string,
  ev: { kind: "upsert" | "removed"; task: BgTask },
): void {
  const prev = deps.rec(threadId).state.bgTasks;
  if (ev.kind === "removed") {
    deps.setState(threadId, { bgTasks: prev.filter((t) => t.id !== ev.task.id) });
    return;
  }
  const idx = prev.findIndex((t) => t.id === ev.task.id);
  const bgTasks = idx >= 0 ? prev.map((t, i) => (i === idx ? ev.task : t)) : [...prev, ev.task];
  deps.setState(threadId, { bgTasks });
}

/**
 * Подгрузить durable-историю фоновых задач треда из моста (переживает рестарт) и
 * положить в стор — панель зовёт при входе в тред. listBackground возвращает
 * полный список (running этого запуска + persisted, где running → stopped), он
 * и есть источник правды, поэтому просто заменяем bgTasks целиком.
 */
export async function loadBgTasks(deps: StoreDeps, threadId: string): Promise<void> {
  const bridge = window.avyDesktop?.codeAgent;
  if (!bridge?.listBackground) return;
  try {
    const tasks = await bridge.listBackground(threadId);
    deps.setState(threadId, { bgTasks: tasks });
  } catch {
    // мост недоступен / тред без задач — оставляем как есть
  }
}
