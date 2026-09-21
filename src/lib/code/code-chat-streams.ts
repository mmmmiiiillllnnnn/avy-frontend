"use client";

// Стор стримов чата, живущий НАД активной сессией.
//
// Зачем: ход агента не должен «падать» при переключении сессий. Раньше состояние
// хода жило в одном useChat, привязанном к активному threadId, и смена сессии
// его рвала. Теперь состояние и сам цикл стрима живут здесь — по ключу threadId,
// независимо от того, какая сессия открыта. Уйдя в другую сессию, пользователь
// оставляет ход работать в фоне (на сервере он тоже не прерывается — см.
// server/turn_buffer.py + /attach); вернувшись, видит живой прогресс.
//
// Сервер хранит ход и буфер кадров; клиентский цикл просто читает SSE. Если
// вкладку перезагрузили — цикла в памяти больше нет, но ход на сервере жив:
// reattach(threadId) подхватит его через /attach. Стор — внешний (вне React),
// компоненты подписываются через useSyncExternalStore.

import {
  attachChat,
  stopChat,
  streamChat,
  streamRetry,
  streamEdit,
  type AskUserAnswer,
  type AskUserQuestionSpec,
  type ChatEvent,
} from "@/lib/api";
import {
  handlePermissionRequest,
  handleAskUserRequest,
  handleBgTaskEvent,
  loadBgTasks as codeLoadBgTasks,
  hasLocalCodeAgent,
  resolvePermission as codeResolvePermission,
  resolveQuestions as codeResolveQuestions,
  runCodeTurn,
} from "@/lib/code/code-streams";
import { stopCodeAgent } from "@/lib/code/code-agent-stream";

// "summary" — служебная строка сжатия контекста (не реплика). Появляется в
// ленте кодера в точке, где старая история свёрнута в summary; рендерится
// отдельным свёрнутым блоком (CodeMessageRow), content = текст summary.
// "report" — репорт фонового субагента обычного чата. В ленте кодера не
// встречается; в объединении только затем, чтобы ChatCode принимал сообщения
// универсального чата (chat-workspace отдаёт их в обоих режимах одним типом).
export type Role = "user" | "assistant" | "summary" | "report";

export type WebSource = { title: string; url: string };

export type FetchedFile = {
  path: string;
  content_type: string;
  bytes: number;
  url: string;
};

// Лента работы одного сабагента (режим deep-research): его размышления и вызовы
// web_search/web_fetch + финальный ответ оркестратору. Привязана к шагу-вызову
// task; фронт показывает её в отдельном окне по клику на чип task.
export type SubagentRun = { steps: ThoughtStep[]; text: string };

export type ThoughtStep =
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      // id вызова (tool_call_id) — для привязки результата (sources/file) к шагу
      // и для обновления шага на месте по мере дозревания аргументов.
      id?: string;
      name: string;
      args: Record<string, unknown>;
      // "streaming" — аргументы ещё стримятся (шиммер на шаге); "available" —
      // вызов завершён. undefined у старой истории = трактуем как available.
      state?: "streaming" | "available";
      // Результат выполнения тула (bash/file-тулы, avy-code).
      result?: { output: string; ok: boolean; truncated: boolean };
      // Источники из web_search (artifact). Приходят отдельным событием после
      // самого вызова, дописываются в шаг по id.
      sources?: WebSource[];
      // Скачанный файл из web_fetch (artifact) — для карточки/превью.
      file?: FetchedFile;
      // Только для вызова task (deep-research): лента работы запущенного
      // сабагента. Накапливается из событий с полем agent во время хода и
      // восстанавливается из истории. Открывается в отдельном окне.
      subagent?: SubagentRun;
    };

export type MessagePart =
  | { type: "chain"; steps: ThoughtStep[] }
  | { type: "text"; text: string };

// thumbUrl — готовый URL мини-превью картинки (data:-URL для Avy Code, где файл
// не лежит в ФС; в обычном чате превью берётся из /files/raw по path).
export type Attachment = { path: string; name: string; mime: string; thumbUrl?: string };

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  parts?: MessagePart[];
  attachments?: Attachment[];
  // Стабильный id хода из чекпойнтера (для лайка/дизлайка/ретрая/edit). У свежих
  // (ещё не сохранённых) сообщений отсутствует — появляется после перезагрузки.
  serverId?: string | null;
  // Текущая оценка ответа пользователем (восстановлена с сервера / поставлена в UI).
  feedback?: "up" | "down" | null;
  // Только для role="summary": объём свёрнутой истории в токенах (до сжатия).
  tokens?: number | null;
};

// Текст маркера остановки (совпадает с server _STOP_MARKER).
export const STOP_MARKER = "\n\nОстановлено пользователем";

// Маркеры вставленного текста: большой кусок, вставленный в инпут, обрамляется
// ими в тексте сообщения. Модель видит обычный помеченный текст; бабл по этим
// маркерам показывает блок чипом-вложением, а не портянкой.
export const PASTED_TEXT_MARKER = "--- Вставленный текст ---";
export const PASTED_TEXT_MARKER_END = "--- Конец вставленного текста ---";

/** Сэмпл для чипа вставки: начало текста (CSS line-clamp обрежет до 2-3 строк). */
export function pastePreview(text: string): string {
  // Схлопываем лишние пустые строки, но переносы оставляем — чип покажет
  // несколько строк. ~280 символов с запасом на 3 строки.
  const trimmed = text.replace(/\n{2,}/g, "\n").trim();
  return trimmed.length > 280 ? `${trimmed.slice(0, 280)}…` : trimmed;
}

/** Состояние ленты одной сессии. */
/** Ожидающая заявка на approval (режим Avy Code): агент хочет изменить файлы/
 * запустить команду, ход на паузе до решения пользователя. */
export type PendingPermission = {
  interruptId: string | null;
  tool: string;
  args: Record<string, unknown>;
  /** Задан ⇒ карточка от ФОНОВОГО САБАГЕНТА (тула task), не от оркестратора. UI
   *  подписывает её субагентом, а ответ роутится в resolveSubagentPermission
   *  (резюмит граф ЭТОГО субагента по sub.id), а не в основной resolvePermissions. */
  sub?: { id: string; type: string; description: string };
};

/** Ожидающая карточка вопросов (режим Avy Code): агент вызвал ask_user, ход на
 *  паузе до ответа пользователя. Одна карточка = один вызов ask_user (в нём
 *  1..4 вопроса), в отличие от permission — там очередь параллельных тулов. */
export type PendingQuestions = {
  interruptId: string | null;
  questions: AskUserQuestionSpec[];
};

/** Фоновый процесс (bash run_in_background) для панели фоновых задач. Durable-
 *  история (переживает рестарт приложения) — тот же shape отдаёт listBackground
 *  и несёт bg_task-событие (см. BgTaskInfo в apps/code-cli/src/agent/events.ts). */
export type BgTask = {
  id: string;
  pid: number | null;
  command: string;
  /** Реальный cwd запуска — для кнопки «Запустить снова» (в UI не показываем). */
  cwd: string;
  logPath: string;
  status: "running" | "finished" | "failed" | "stopped";
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  /** agent — запущено агентом в ходе; user — вручную из панели. */
  origin: "agent" | "user";
  /** Тип строки: "bash" — фоновая команда, "subagent" — фоновый прогон сабагента
   *  (тула task). Нет поля ⇒ bash (обратная совместимость). */
  kind?: "bash" | "subagent";
  /** Для kind:"subagent" — тип сабагента (general-purpose), для подписи в панели. */
  subagentType?: string;
  /** Для kind:"subagent" — живой транскрипт хода сабагента, рендерится в раскрытии
   *  строки панели (в чат не идёт). Растёт по мере хода. */
  transcript?: string;
};

export type ThreadState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  // Очередь заявок approval (режим Avy Code). Пуста = нет паузы. Агент может
  // вызвать несколько тулов параллельно — они все придут как отдельные
  // permission_request. Показываем по одной; resume отправляем только после
  // последней (сразу все решения одним списком).
  pendingPermissions: PendingPermission[];
  // Ожидающая карточка ask_user (режим Avy Code). null = нет паузы по вопросам.
  // В отличие от approval-очереди, ask_user приходит одним событием со всеми
  // вопросами сразу, поэтому это одиночное значение, а не массив.
  pendingQuestions: PendingQuestions | null;
  // Фоновые процессы треда (bash run_in_background) — панель фоновых задач.
  // running появляется по bg_task(started), переходит в finished/failed.
  bgTasks: BgTask[];
};

/** Пустое состояние сессии — снимок для нового/несуществующего треда. Одна
 *  общая замороженная ссылка: getState возвращает её, пока в тред не пришло ни
 *  одного события (стабильная ссылка → useSyncExternalStore не дёргает рендер). */
const EMPTY: ThreadState = {
  messages: [],
  isStreaming: false,
  error: null,
  pendingPermissions: [],
  pendingQuestions: null,
  bgTasks: [],
};

let _idCounter = 0;
const nextId = () => `m${++_idCounter}`;

/** Внутренняя запись потока сессии (не отдаётся в UI напрямую). */
type ThreadRecord = {
  state: ThreadState;
  // Кол-во уже полученных SSE-кадров текущего хода — offset для reattach.
  frames: number;
  // id сообщения ассистента, в которое стримим (для патчей).
  assistantId: string | null;
  // AbortController активного цикла чтения (НЕ сервера — только локального fetch).
  ctrl: AbortController | null;
  listeners: Set<() => void>;
  // Связка ключа сабагента (поле agent в событиях) → tool_call_id шага task, в
  // окно которого его лента пишется. Реального id вызова task в ns нет, поэтому
  // связываем по ПОРЯДКУ: первый увиденный сабагент → первый ещё не связанный
  // шаг task. Живёт на время хода, сбрасывается при старте нового.
  subagentMap: Map<string, string>;
  // id запланированного rAF-кадра уведомления подписчиков (0 = не запланирован).
  // Батчим: десятки событий за кадр (особенно при 8 параллельных сабагентах) →
  // один React-рендер на кадр экрана, а не на каждый токен.
  emitRaf: number;
  // Буфер дельт reasoning/text КАЖДОГО сабагента (ключ — agentKey). Эти потоки
  // самые «болтливые», и патчить ленту на каждый их токен дорого (клон parts/
  // steps). Копим и сливаем пачкой раз в SUBAGENT_FLUSH_MS одним patchMessages.
  subagentBuffer: Map<string, { reasoning: string; text: string }>;
  // id таймера слива буфера (0 = не запланирован).
  subagentFlush: ReturnType<typeof setTimeout> | 0;
  // Режим Avy Code: параметры текущего хода, нужные для возобновления после
  // approval (resolvePermission переотправляет ход с тем же режимом/моделью).
  codeRun: {
    modelId?: string;
    effort?: string | null;
    permissionMode?: string | null;
    onTitle?: (title: string) => void;
    onDone?: (threadId: string) => void;
  } | null;
  // Накопленные решения по уже пройденным карточкам, СГРУППИРОВАННЫЕ ПО ВЛАДЕЛЬЦУ:
  // ключ "__main__" — карточки оркестратора, ключ sub.id — карточки конкретного
  // фонового сабагента. Когда в очереди не осталось карточек владельца — его
  // решения уходят в resume ЕГО графа (resolvePermissions / resolveSubagentPermission).
  // Так параллельные approval'ы разных агентов не смешиваются (см. resolvePermission).
  pendingDecisions: Map<string, Array<{ type: "approve" | "reject"; message?: string }>>;
  // Копим ответы по вопросам одной карточки ask_user (по одному на вопрос,
  // в порядке questions). Когда пользователь ответил на все — уходят в resume.
  pendingAnswers: AskUserAnswer[];
  // Сообщения ВЫШЕ видимого окна (старая история). Полная лента = older +
  // state.messages: React рендерит только окно, loadMore перекладывает порцию
  // из older в окно при скролле вверх. Живые ходы дописываются в окно, а его
  // голова подрезается сюда при старте нового хода (см. LIVE_WINDOW в start) —
  // иначе за долгую сессию без перезахода DOM/рендер росли бы бесконечно.
  // (Раньше здесь лежала ПОЛНАЯ лента allMessages, а loadMore заменял окно её
  // срезом — живых сообщений в ней не было, и они ПРОПАДАЛИ из виду при
  // скролле вверх. Схема older+окно убирает этот баг по построению.)
  older: ChatMessage[];
  // Буфер дельт text/reasoning ОСНОВНОГО потока (оркестратора) + таймер слива.
  // Это самые частые события хода (десятки/сек) — патчить ленту на каждый токен
  // дорого (клон сообщения + parts + React-рендер каждый кадр rAF; на длинном
  // ходе это и есть «рваный скролл»). Копим и сливаем раз в MAIN_FLUSH_MS одним
  // patchMessages — как уже сделано для сабагентов (subagentBuffer). Буфер
  // ОДНОГО типа: смена типа дельты или структурное событие сначала сливают
  // накопленное — порядок ленты (reasoning → tool → text) сохраняется.
  mainBuffer: { type: "text" | "reasoning"; value: string } | null;
  mainFlush: ReturnType<typeof setTimeout> | 0;
  // Promise активного цикла consume() текущего хода. Нужен, чтобы дождаться
  // ПОЛНОГО закрытия прошлого генератора перед запуском следующего (resume
  // после approval / новый send): у моста одна onEvent-подписка на тред, два
  // параллельных consume() задвоили бы события (см. code-agent-stream.ts).
  run: Promise<void> | null;
  // id assistant-сообщения ТЕКУЩЕГО фонового «пробуждения» (wake-ход по
  // завершении bash run_in_background). Wake инициируется в main-процессе, не
  // renderer'ом, поэтому у него нет обычного assistantId/consume — события
  // приходят через постоянную подписку onEvent и применяются сюда (см.
  // applyBackgroundEvent). null = сейчас wake-хода нет.
  wakeAssistantId: string | null;
};

// Сколько сообщений показываем из истории за раз (первоначально и при loadMore).
// Малый размер = быстрый первый рендер; пользователь скроллит вверх → loadMore.
const HISTORY_PAGE = 30;

// Как часто сливать накопленные дельты сабагентов в ленту. 120мс — глаз не
// замечает «рывков», а патчей ленты в секунду на порядок меньше, чем токенов.
const SUBAGENT_FLUSH_MS = 120;

// Как часто сливать дельты ОСНОВНОГО потока (текст/рассуждения кодера в ленте).
// 80мс = ~12 обновлений/сек — визуально живой стрим (Claude/ChatGPT обновляют с
// сопоставимой частотой), но в ~5 раз меньше рендеров, чем 60/сек по rAF.
const MAIN_FLUSH_MS = 80;

// Максимум сообщений в ЖИВОМ окне ленты. При старте нового хода голова окна
// сверх лимита перекладывается в older (см. start) — за долгую сессию без
// перезахода DOM и работа рендера остаются ограниченными, а старое возвращается
// через loadMore при скролле вверх. Подрезаем ИМЕННО на отправке: в этот момент
// пользователь гарантированно у низа ленты, удаление строк сверху не дёргает
// его скролл.
const LIVE_WINDOW = 60;

// Map.set/delete сохраняют порядок вставки → используем Map как LRU: «свежесть»
// треда обновляем удалением+переустановкой в touch(), эвиктим с головы (самый
// давний). Без границы records копил бы messages[] всех открытых за сессию
// тредов (история + цепочки + ссылки на картинки) — память росла бесконечно.
const records = new Map<string, ThreadRecord>();

// Сколько неактивных тредов держать в памяти. Активный (стримящийся) и тред с
// живыми подписчиками НЕ считаются и не эвиктятся. 8 хватает на быстрые прыжки
// между сессиями, но не даёт копить десятки тяжёлых лент.
const MAX_IDLE_RECORDS = 8;

function rec(threadId: string): ThreadRecord {
  const existing = records.get(threadId);
  if (existing) return existing;
  const r: ThreadRecord = {
    state: EMPTY,
    frames: 0,
    assistantId: null,
    ctrl: null,
    listeners: new Set(),
    subagentMap: new Map(),
    emitRaf: 0,
    subagentBuffer: new Map(),
    subagentFlush: 0,
    codeRun: null,
    pendingDecisions: new Map(),
    pendingAnswers: [],
    older: [],
    mainBuffer: null,
    mainFlush: 0,
    run: null,
    wakeAssistantId: null,
  };
  records.set(threadId, r);
  return r;
}

/** Пометить тред как недавно использованный (переставить в конец LRU-порядка). */
function touch(threadId: string): void {
  const r = records.get(threadId);
  if (r) {
    records.delete(threadId);
    records.set(threadId, r);
  }
}

/**
 * Выгрузить давно не используемые треды, оставив в памяти не более
 * MAX_IDLE_RECORDS неактивных. Тред можно выгрузить, только если он НЕ стримит
 * и на него никто не подписан (его нет на экране) — иначе порвём живую ленту.
 * Перед удалением гасим возможные таймеры/rAF, чтобы не оставить висячих ссылок.
 */
function evictIdle(): void {
  let idle = 0;
  // Идём от свежих к старым (конец → начало): первые MAX_IDLE_RECORDS пригодных
  // к выгрузке оставляем, остальные эвиктим.
  for (const [id, r] of [...records.entries()].reverse()) {
    const evictable = !r.state.isStreaming && r.listeners.size === 0;
    if (!evictable) continue;
    idle += 1;
    if (idle > MAX_IDLE_RECORDS) {
      if (r.emitRaf) cancelAnimationFrame(r.emitRaf);
      if (r.subagentFlush) clearTimeout(r.subagentFlush);
      if (r.mainFlush) clearTimeout(r.mainFlush);
      r.ctrl?.abort();
      records.delete(id);
    }
  }
}

// rAF доступен только в браузере; на SSR падаем в синхронный вызов (там стрима
// нет, так что батчить нечего).
const _raf: (cb: () => void) => number =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => {
        cb();
        return 0;
      };

/**
 * Уведомить подписчиков — НЕ синхронно, а раз в кадр экрана (rAF). Состояние
 * стора мутируется на каждое SSE-событие (десятки/сек при параллельных
 * сабагентах), но React-рендер происходит максимум раз в кадр: пока кадр не
 * наступил, повторные emit() лишь «взводят» уже запланированный rAF, а не плодят
 * рендеры. К моменту рендера стор уже содержит все накопленные изменения.
 */
function emit(r: ThreadRecord) {
  if (r.emitRaf) return;
  r.emitRaf = _raf(() => {
    r.emitRaf = 0;
    for (const l of r.listeners) l();
  });
}

/** Заменить state записи новым объектом (иммутабельно) и уведомить подписчиков. */
function setState(threadId: string, patch: Partial<ThreadState>) {
  const r = rec(threadId);
  r.state = { ...r.state, ...patch };
  emit(r);
}

function patchMessages(
  threadId: string,
  fn: (msgs: ChatMessage[]) => ChatMessage[],
) {
  const r = rec(threadId);
  r.state = { ...r.state, messages: fn(r.state.messages) };
  emit(r);
}

/** Гарантировать, что последний part — chain; вернуть его (для мутации копии). */
function lastChain(parts: MessagePart[]) {
  const last = parts[parts.length - 1];
  if (last && last.type === "chain") return last;
  const chain = { type: "chain" as const, steps: [] as ThoughtStep[] };
  parts.push(chain);
  return chain;
}

/**
 * Дописать результат тула (sources/file) в уже добавленный tool-шаг по
 * tool_call_id. Результат приходит отдельным событием после самого вызова.
 * Патчим первый совпавший шаг (вызов почти всегда последний; флаг гасит дубль).
 */
function patchToolStep(
  m: ChatMessage,
  callId: string,
  data: Partial<Extract<ThoughtStep, { kind: "tool" }>>,
): ChatMessage {
  let hit = false;
  const parts = (m.parts ?? []).map((p) => {
    if (p.type !== "chain") return p;
    const steps = p.steps.map((s) => {
      if (!hit && s.kind === "tool" && s.id && s.id === callId) {
        hit = true;
        return { ...s, ...data };
      }
      return s;
    });
    return hit ? { ...p, steps } : p;
  });
  return hit ? { ...m, parts } : m;
}

/** Все tool_call_id шагов-вызовов task в сообщении (в порядке появления). */
function taskCallIds(m: ChatMessage): string[] {
  const ids: string[] = [];
  for (const p of m.parts ?? []) {
    if (p.type !== "chain") continue;
    for (const s of p.steps) {
      if (s.kind === "tool" && s.name === "task" && s.id) ids.push(s.id);
    }
  }
  return ids;
}

/**
 * Связать ключ сабагента с tool_call_id шага task. Реального id вызова task в
 * событиях сабагента нет, поэтому связываем по порядку: новый ключ → первый шаг
 * task, ещё не закреплённый за другим ключом. Возвращает callId или null (шага
 * task пока нет — событие прилетело раньше его финализации; редко).
 */
function resolveTaskCallId(
  r: ThreadRecord,
  m: ChatMessage,
  agentKey: string,
): string | null {
  const known = r.subagentMap.get(agentKey);
  if (known) return known;
  const taken = new Set(r.subagentMap.values());
  const free = taskCallIds(m).find((id) => !taken.has(id));
  if (!free) return null;
  r.subagentMap.set(agentKey, free);
  return free;
}

/** Применить событие к ленте сабагента внутри шага task с данным callId. */
function patchSubagentStep(
  m: ChatMessage,
  callId: string,
  apply: (run: SubagentRun) => SubagentRun,
): ChatMessage {
  let hit = false;
  const parts = (m.parts ?? []).map((p) => {
    if (p.type !== "chain") return p;
    const steps = p.steps.map((s) => {
      if (!hit && s.kind === "tool" && s.id === callId) {
        hit = true;
        const run = s.subagent ?? { steps: [], text: "" };
        return { ...s, subagent: apply(run) };
      }
      return s;
    });
    return hit ? { ...p, steps } : p;
  });
  return hit ? { ...m, parts } : m;
}

/** Дописать reasoning/text-дельту в ленту сабагента (склейка с последним). */
function appendSubagentReasoning(run: SubagentRun, text: string): SubagentRun {
  const steps = [...run.steps];
  const last = steps[steps.length - 1];
  if (last && last.kind === "reasoning") {
    steps[steps.length - 1] = { ...last, text: last.text + text };
  } else {
    steps.push({ kind: "reasoning", text });
  }
  return { ...run, steps };
}

/** Обновить/добавить tool-шаг в ленте сабагента (по id, как в основной ленте). */
function upsertSubagentTool(
  run: SubagentRun,
  data: { id: string; name: string; args: Record<string, unknown>; state: "streaming" | "available" },
): SubagentRun {
  let hit = false;
  const steps = run.steps.map((s) => {
    if (!hit && s.kind === "tool" && s.id === data.id) {
      hit = true;
      return { ...s, args: data.args, state: data.state };
    }
    return s;
  });
  if (!hit) {
    steps.push({ kind: "tool", id: data.id, name: data.name, args: data.args, state: data.state });
  }
  return { ...run, steps };
}

/** Дописать sources/file в tool-шаг ленты сабагента по tool_call_id. */
function patchSubagentToolResult(
  run: SubagentRun,
  callId: string,
  data: Partial<Extract<ThoughtStep, { kind: "tool" }>>,
): SubagentRun {
  let hit = false;
  const steps = run.steps.map((s) => {
    if (!hit && s.kind === "tool" && s.id === callId) {
      hit = true;
      return { ...s, ...data };
    }
    return s;
  });
  return hit ? { ...run, steps } : run;
}

/** Применить накопленную дельту основного потока к сообщению ассистента.
 *  Это прежние ветки case "text"/"reasoning" из applyEvent — один в один, но
 *  теперь их зовёт слив буфера (пачкой), а не каждое событие по отдельности. */
function applyMainDelta(
  threadId: string,
  assistantId: string,
  type: "text" | "reasoning",
  value: string,
) {
  patchMessages(threadId, (msgs) =>
    msgs.map((m) => {
      if (m.id !== assistantId) return m;
      if (type === "text") {
        const parts = [...(m.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last && last.type === "text") {
          parts[parts.length - 1] = { ...last, text: last.text + value };
        } else {
          parts.push({ type: "text", text: value });
        }
        return { ...m, parts, content: m.content + value };
      }
      const parts = [...(m.parts ?? [])];
      const chain = lastChain(parts);
      const steps = [...chain.steps];
      const last = steps[steps.length - 1];
      if (last && last.kind === "reasoning") {
        steps[steps.length - 1] = { ...last, text: last.text + value };
      } else {
        steps.push({ kind: "reasoning", text: value });
      }
      parts[parts.length - 1] = { ...chain, steps };
      return { ...m, parts };
    }),
  );
}

/** Скопить дельту text/reasoning основного потока; слив — по таймеру, при смене
 *  типа дельты или перед любым структурным событием (см. applyEvent). */
function bufferMainDelta(
  threadId: string,
  assistantId: string,
  type: "text" | "reasoning",
  value: string,
) {
  const r = rec(threadId);
  // Тип сменился (reasoning→text или наоборот) — сначала сливаем накопленное,
  // чтобы части ленты не переупорядочились.
  if (r.mainBuffer && r.mainBuffer.type !== type) flushMainBuffer(threadId, assistantId);
  if (!r.mainBuffer) r.mainBuffer = { type, value: "" };
  r.mainBuffer.value += value;
  if (!r.mainFlush) {
    r.mainFlush = setTimeout(() => flushMainBuffer(threadId, assistantId), MAIN_FLUSH_MS);
  }
}

/** Слить буфер дельт основного потока одним patchMessages (no-op, если пуст). */
function flushMainBuffer(threadId: string, assistantId: string) {
  const r = rec(threadId);
  if (r.mainFlush) {
    clearTimeout(r.mainFlush);
    r.mainFlush = 0;
  }
  const buf = r.mainBuffer;
  if (!buf) return;
  r.mainBuffer = null;
  if (buf.value) applyMainDelta(threadId, assistantId, buf.type, buf.value);
}

/** Скопить дельту reasoning/text сабагента в буфер и запланировать слив. */
function bufferSubagentDelta(
  threadId: string,
  assistantId: string,
  agentKey: string,
  type: "reasoning" | "text",
  value: string,
) {
  const r = rec(threadId);
  let buf = r.subagentBuffer.get(agentKey);
  if (!buf) {
    buf = { reasoning: "", text: "" };
    r.subagentBuffer.set(agentKey, buf);
  }
  buf[type] += value;
  if (!r.subagentFlush) {
    r.subagentFlush = setTimeout(() => flushSubagentBuffer(threadId, assistantId), SUBAGENT_FLUSH_MS);
  }
}

/**
 * Слить накопленные дельты всех сабагентов в ленту ОДНИМ patchMessages. Карта
 * хранит вставку в порядке первого появления агента, поэтому привязка
 * agentKey→task (resolveTaskCallId) сохраняет порядок. После слива буфер пуст.
 */
function flushSubagentBuffer(threadId: string, assistantId: string) {
  const r = rec(threadId);
  if (r.subagentFlush) {
    clearTimeout(r.subagentFlush);
    r.subagentFlush = 0;
  }
  if (r.subagentBuffer.size === 0) return;
  const entries = [...r.subagentBuffer.entries()];
  r.subagentBuffer.clear();

  patchMessages(threadId, (msgs) =>
    msgs.map((m) => {
      if (m.id !== assistantId) return m;
      let mm = m;
      for (const [agentKey, buf] of entries) {
        const callId = resolveTaskCallId(r, mm, agentKey);
        if (!callId) continue;
        if (buf.reasoning) {
          mm = patchSubagentStep(mm, callId, (run) =>
            appendSubagentReasoning(run, buf.reasoning),
          );
        }
        if (buf.text) {
          mm = patchSubagentStep(mm, callId, (run) => ({
            ...run,
            text: run.text + buf.text,
          }));
        }
      }
      return mm;
    }),
  );
}

/**
 * Применить событие сабагента (поле agent задано) к ленте соответствующего шага
 * task. Возвращает true, если событие обработано как сабагентское (тогда базовый
 * applyEvent его дальше не трогает).
 *
 * reasoning/text сабагентов буферизуются (throttle, см. bufferSubagentDelta) —
 * их потоки самые болтливые. Структурные события (tool/sources/fetched) идут
 * сразу, НО перед ними буфер сливается, иначе reasoning «перепрыгнул» бы через
 * tool и порядок шагов в ленте сабагента сломался бы.
 */
function applySubagentEvent(
  threadId: string,
  ev: ChatEvent,
  assistantId: string,
): boolean {
  // Только события с этими типами носят поле agent; у остальных его нет.
  if (
    ev.type !== "text" &&
    ev.type !== "reasoning" &&
    ev.type !== "tool" &&
    ev.type !== "sources" &&
    ev.type !== "fetched"
  ) {
    return false;
  }
  const agentKey = ev.agent;
  if (!agentKey) return false; // оркестратор → обычный путь

  // Болтливые потоки — в буфер (throttle). Слив раз в SUBAGENT_FLUSH_MS.
  if (ev.type === "reasoning" || ev.type === "text") {
    bufferSubagentDelta(threadId, assistantId, agentKey, ev.type, ev.value);
    return true;
  }

  // Структурные события — сразу, но СНАЧАЛА сливаем буфер, чтобы reasoning/text,
  // пришедшие до этого tool, легли в ленту ПЕРЕД ним (иначе порядок шагов
  // сабагента сломается: дельты из буфера допишутся уже после tool-шага).
  flushSubagentBuffer(threadId, assistantId);

  const r = rec(threadId);
  patchMessages(threadId, (msgs) =>
    msgs.map((m) => {
      if (m.id !== assistantId) return m;
      const callId = resolveTaskCallId(r, m, agentKey);
      if (!callId) return m; // шага task ещё нет — пропускаем (редкая гонка)
      switch (ev.type) {
        case "tool":
          return patchSubagentStep(m, callId, (run) =>
            upsertSubagentTool(run, {
              id: ev.id,
              name: ev.name,
              args: ev.args,
              state: ev.state ?? "available",
            }),
          );
        case "sources":
          return patchSubagentStep(m, callId, (run) =>
            patchSubagentToolResult(run, ev.tool_call_id, { sources: ev.sources }),
          );
        case "fetched":
          return patchSubagentStep(m, callId, (run) =>
            patchSubagentToolResult(run, ev.tool_call_id, { file: ev.file }),
          );
        default:
          return m;
      }
    }),
  );
  return true;
}

/** Применить один SSE-кадр к сообщению ассистента сессии. */
function applyEvent(
  threadId: string,
  ev: ChatEvent,
  assistantId: string,
  onTitle?: (title: string) => void,
) {
  // События сабагентов (deep-research) уходят в ленту своего шага task, а не в
  // основную ленту оркестратора. Если событие сабагентское — здесь и завершаем.
  if (applySubagentEvent(threadId, ev, assistantId)) return;

  // Дельты текста/рассуждений оркестратора — САМЫЕ частые события хода
  // (десятки/сек). В буфер, слив пачкой раз в MAIN_FLUSH_MS — иначе каждый
  // токен = клон сообщения + React-рендер (на длинном ходе — фризы и рваный
  // скролл; см. mainBuffer в ThreadRecord).
  if (ev.type === "text" || ev.type === "reasoning") {
    bufferMainDelta(threadId, assistantId, ev.type, ev.value);
    return;
  }
  // Структурное событие (tool/result/карточки/done/…) — сначала сливаем буфер,
  // чтобы порядок ленты (reasoning → tool → text) не нарушился.
  flushMainBuffer(threadId, assistantId);

  const patch = (fn: (m: ChatMessage) => ChatMessage) =>
    patchMessages(threadId, (msgs) =>
      msgs.map((m) => (m.id === assistantId ? fn(m) : m)),
    );

  switch (ev.type) {
    case "tool":
      // Стрим аргументов: первое событие (streaming) добавляет шаг, последующие
      // (дозревающие args, затем available) обновляют его НА МЕСТЕ по id —
      // иначе один вызов превратился бы в десяток шагов.
      patch((m) => {
        const state = ev.state ?? "available";
        // Уже есть шаг с этим id? → обновляем args/state. sources/file/прочее
        // (приходят отдельными событиями) не трогаем.
        const updated = patchToolStep(m, ev.id, { args: ev.args, state });
        if (updated !== m) return updated;
        // Нового шага ещё нет → добавляем.
        const parts = [...(m.parts ?? [])];
        const chain = lastChain(parts);
        parts[parts.length - 1] = {
          ...chain,
          steps: [
            ...chain.steps,
            { kind: "tool", id: ev.id, name: ev.name, args: ev.args, state },
          ],
        };
        return { ...m, parts };
      });
      break;
    case "tool_result":
      // Результат bash/file-тула (avy-code): output + ok/error статус.
      patch((m) =>
        patchToolStep(m, ev.tool_call_id, {
          result: { output: ev.output, ok: ev.ok, truncated: ev.truncated },
        }),
      );
      break;
    case "sources":
      // Результат web_search: привязываем источники к tool-шагу по tool_call_id.
      patch((m) => patchToolStep(m, ev.tool_call_id, { sources: ev.sources }));
      break;
    case "fetched":
      // Результат web_fetch: скачанный файл → в tool-шаг (карточка/превью).
      patch((m) => patchToolStep(m, ev.tool_call_id, { file: ev.file }));
      break;
    case "title":
      onTitle?.(ev.value);
      break;
    case "summary":
      // Сжатие контекста: добавляем маркер «Контекст сжат» В КОНЕЦ ленты, НЕ
      // трогая остальные сообщения — лента пользователя остаётся как есть, просто
      // появляется свёрнутый блок (как было в Python). Раньше вставляли ПЕРЕД
      // assistantId, а затем onCompacted перезагружал ленту с сервера — два
      // конкурирующих редактора одной ленты рассинхронивались и дублировали всю
      // историю треда (см. историю бага). Теперь источник один: этот live-патч,
      // без перезагрузки (use-context-usage: onCompacted больше не reload'ит).
      // tokens — подпись блока (объём свёрнутого), приходит из события агента.
      //
      // Дедуп: если последнее сообщение ленты — уже summary с ТЕМ ЖЕ текстом,
      // не добавляем второй блок. Нужен и на повторную доставку живого
      // события, и как страховка от рассинхрона с перестройкой ленты из
      // чекпоинта (apps/code-cli/src/session/historyFromMessages.ts) — там
      // summary-сообщение читается из state.messages графа независимо от
      // этого live-патча, и при повторной загрузке того же чекпоинта
      // (например summarizer записал одинаковый summary в два соседних
      // чекпоинта подряд — живой баг, см. память code-cli-summary-corruption-bug)
      // оба пути иначе давали два идентичных блока подряд.
      patchMessages(threadId, (msgs) => {
        const last = msgs[msgs.length - 1];
        if (last?.role === "summary" && last.content === ev.text) return msgs;
        const summaryMsg: ChatMessage = {
          id: `summary-${Date.now()}`,
          role: "summary",
          content: ev.text,
          tokens: ev.tokens ?? null,
        };
        return [...msgs, summaryMsg];
      });
      break;
    case "ask_user_request": {
      // Code-режим: агент вызвал ask_user — карточка с вопросами. Делегируем в
      // code-streams (тот же изолированный слой, что и approval).
      handleAskUserRequest(
        { rec, setState, consume, nextId },
        threadId,
        ev as { interrupt_id?: string; questions: AskUserQuestionSpec[] },
      );
      break;
    }
    case "permission_request": {
      // Карточка ОТ САБАГЕНТА (ev.sub) — исключительно забота фонового канала
      // (applyBackgroundEvent). Во время активного хода оркестратора то же событие
      // приходит И сюда (consume), И туда (постоянная onEvent-подписка) — если
      // обработать в обоих, карточка задвоится. Здесь sub-карточки пропускаем.
      if ((ev as { sub?: unknown }).sub) break;
      // Code-режим: делегируем в code-streams (изолирован от основного стора).
      handlePermissionRequest(
        { rec, setState, consume, nextId },
        threadId,
        ev as { interrupt_id?: string; tool: string; args: Record<string, unknown> },
      );
      break;
    }
    case "bg_task": {
      // Code-режим: панель фоновых задач (bash run_in_background). Делегируем в
      // code-streams (тот же изолированный слой, что approval/ask_user).
      handleBgTaskEvent(
        { rec, setState, consume, nextId },
        threadId,
        ev as { kind: "upsert" | "removed"; task: BgTask },
      );
      break;
    }
    case "stopped":
      patch((m) => {
        const parts = [
          ...(m.parts ?? []),
          { type: "text" as const, text: STOP_MARKER },
        ];
        return { ...m, parts, content: m.content + STOP_MARKER };
      });
      break;
    case "retry":
      // Сервер повторяет ход после транзиентного обрыва (граф продолжит с
      // чекпойнта). Сбрасываем недописанный пузырь ассистента: перестримленный
      // шаг придёт заново, иначе текст/цепочка задвоятся. Завершённые ранее
      // тулы сервер НЕ перевыполняет — но их события мы уже показали; чистим
      // весь пузырь и ждём чистый перестрим (для пользователя — «подвисло и
      // продолжило»). isStreaming не трогаем — ход продолжается.
      patch((m) => ({ ...m, parts: [], content: "" }));
      break;
    case "error":
      // Бэк присылает code (limit_exceeded/gateway_unavailable/…). Кладём в стейт
      // ИМЕННО code — компонент переведёт его в локализованное сообщение. Старые
      // ходы без code (или ошибки не из стрима) показываем как есть (message).
      setState(threadId, { error: ev.code ?? ev.message });
      break;
    case "done":
      // Проставляем serverId на свежий ответ ПО МЕСТУ (только этот один пузырь),
      // чтобы сразу заработали лайк/дизлайк/ретрай. Высота не меняется (меняется
      // лишь serverId), цепочка уже свёрнута → скролл не дёргается.
      if (ev.message_id) {
        patch((m) => ({ ...m, serverId: ev.message_id }));
      }
      break;
  }
}

type RunCallbacks = {
  onTitle?: (title: string) => void;
  onDone?: (threadId: string) => void;
};

/**
 * Прокрутить async-итератор кадров хода: считать каждый кадр, применить к
 * состоянию, вести счётчик frames (offset для reattach). Любой кадр учитывается
 * в frames — так reattach с offset=frames не повторит уже показанное.
 */
async function consume(
  threadId: string,
  source: AsyncGenerator<ChatEvent>,
  assistantId: string,
  cbs: RunCallbacks,
) {
  const r = rec(threadId);
  try {
    for await (const ev of source) {
      r.frames += 1;
      applyEvent(threadId, ev, assistantId, cbs.onTitle);
    }
  } finally {
    // Слить хвосты буферов: последние дельты (за <FLUSH_MS до конца или до
    // отмены/ошибки) иначе не попали бы в ленту. finally покрывает и throw.
    flushMainBuffer(threadId, assistantId);
    flushSubagentBuffer(threadId, assistantId);
  }
}

export const chatStreams = {
  /** Снимок состояния сессии (для useSyncExternalStore). */
  getState(threadId: string): ThreadState {
    return records.get(threadId)?.state ?? EMPTY;
  },

  /**
   * Применить событие, пришедшее ВНЕ обычного хода — от постоянной фоновой
   * подписки onEvent (см. use-chat.ts). Такие события порождает main-процесс
   * сам: (1) bg_task при старте/финише фонового процесса; (2) весь «wake»-ход,
   * которым агент реагирует на завершение фоновой команды
   * (sessionManager.runWake) — reasoning/tool/text/…/done.
   *
   * consume() их не видит: его генератор живёт только на время renderer-хода
   * (sendMessage/resolve/compact), а wake инициируется из main, когда никакой
   * consume не активен. Поэтому доставляем их сюда напрямую.
   *
   * ВАЖНО про дубли: во время renderer-хода (r.ctrl !== null) те же события уже
   * применяет consume() — здесь их пропускаем, кроме bg_task (панель фоновых
   * задач консумеру не принадлежит и должна обновляться всегда).
   */
  applyBackgroundEvent(threadId: string, ev: ChatEvent): void {
    const r = rec(threadId);

    // Панель фоновых задач — всегда (в т.ч. finished/failed после конца хода).
    if (ev.type === "bg_task") {
      applyEvent(threadId, ev, r.assistantId ?? "", undefined);
      return;
    }

    // Approval-карточка ОТ ФОНОВОГО САБАГЕНТА (ev.sub) приходит ТОЛЬКО этим
    // фоновым каналом (в стрим consume основного хода она не попадает), поэтому
    // дублей нет — показываем ВСЕГДА, даже когда идёт основной ход (r.ctrl). Иначе
    // (общий guard ниже) карточка субагента, прилетевшая во время хода
    // оркестратора, потерялась бы и субагент завис бы в фоне навсегда.
    if (ev.type === "permission_request" && (ev as { sub?: unknown }).sub) {
      handlePermissionRequest(
        { rec, setState, consume, nextId },
        threadId,
        ev as {
          interrupt_id?: string;
          tool: string;
          args: Record<string, unknown>;
          sub?: { id: string; type: string; description: string };
        },
      );
      return;
    }

    // Идёт обычный ход — эти же события применяет consume(); молчим (иначе дубль).
    if (r.ctrl) return;

    // Дальше — только wake-ход (обычного хода нет). Пауза на approval/ask_user
    // приходит как отдельное событие (permission_request/ask_user_request) —
    // делегируем в тот же code-streams, что и обычный ход (карточка в очередь).
    // resume потом придёт из UI через resolvePermission/resolveQuestions,
    // который переиспользует r.assistantId (см. ниже — wake кладёт свой id туда).
    if (ev.type === "permission_request") {
      handlePermissionRequest(
        { rec, setState, consume, nextId },
        threadId,
        ev as { interrupt_id?: string; tool: string; args: Record<string, unknown> },
      );
      return;
    }
    if (ev.type === "ask_user_request") {
      handleAskUserRequest(
        { rec, setState, consume, nextId },
        threadId,
        ev as { interrupt_id?: string; questions: AskUserQuestionSpec[] },
      );
      return;
    }

    // Терминальные события закрывают пробуждение. wakeAssistantId сбрасываем,
    // чтобы следующий wake начал новое сообщение; r.assistantId оставляем как
    // есть — он общий с resume-цепочкой (resolvePermission берёт r.assistantId).
    if (ev.type === "done" || ev.type === "stopped" || ev.type === "error") {
      if (r.wakeAssistantId) {
        flushMainBuffer(threadId, r.wakeAssistantId);
        flushSubagentBuffer(threadId, r.wakeAssistantId);
        r.wakeAssistantId = null;
      }
      if (ev.type === "error") {
        setState(threadId, { isStreaming: false, error: (ev as { message?: string }).message ?? "Ошибка" });
      } else {
        setState(threadId, { isStreaming: false });
      }
      return;
    }

    // Маркер «Контекст сжат» — самостоятельная строка ленты (role:"summary"),
    // assistant-сообщение ему не нужно: обрабатываем ДО wake-бутстрапа ниже,
    // чтобы ручное сжатие (оно приходит именно этим каналом — consume() при нём
    // не работает, см. use-context-usage.ts) не оставляло в ленте пустой
    // assistant-бабл. ЕДИНСТВЕННАЯ точка вставки маркера при ручном сжатии
    // локального агента (дубль-вставку из use-context-usage убрали 2026-07-25);
    // дедуп одинакового текста — внутри case "summary".
    if (ev.type === "summary") {
      applyEvent(threadId, ev, r.wakeAssistantId ?? "", undefined);
      return;
    }

    // Первое контентное событие wake-хода — создаём assistant-сообщение
    // (пользовательского сообщения нет: уведомление системное) и включаем
    // индикатор стрима. id кладём И в wakeAssistantId (маркер активного wake),
    // И в r.assistantId — чтобы resume после approval (resolvePermission,
    // который читает r.assistantId) продолжил ЭТО ЖЕ сообщение, а не создал
    // новое. Дальше applyEvent пишет в него, как в обычном ходе.
    if (!r.wakeAssistantId) {
      const assistantId = nextId();
      r.wakeAssistantId = assistantId;
      r.assistantId = assistantId;
      r.subagentMap = new Map();
      r.subagentBuffer = new Map();
      patchMessages(threadId, (msgs) => [
        ...msgs,
        { id: assistantId, role: "assistant", content: "", parts: [] },
      ]);
      setState(threadId, { isStreaming: true, error: null });
    }
    applyEvent(threadId, ev, r.wakeAssistantId, undefined);
  },

  /** Подгрузить durable-историю фоновых задач треда (панель фоновых задач при
   *  входе в тред — переживает рестарт). Делегируем в code-streams. */
  loadBgTasks(threadId: string): void {
    void codeLoadBgTasks({ rec, setState, consume, nextId }, threadId);
  },

  /** Выставить текст ошибки сессии (напр. неудачное прикрепление файла). */
  setError(threadId: string, message: string | null) {
    setState(threadId, { error: message });
  },

  /** Идёт ли сейчас ход в сессии. */
  isStreaming(threadId: string): boolean {
    return records.get(threadId)?.state.isStreaming ?? false;
  },

  /** Есть ли у сессии уже сообщения в сторе (живые/завершённые/загруженные). */
  hasMessages(threadId: string): boolean {
    return (records.get(threadId)?.state.messages.length ?? 0) > 0;
  },

  subscribe(threadId: string, cb: () => void): () => void {
    const r = rec(threadId);
    r.listeners.add(cb);
    touch(threadId); // открыли/смотрим тред — он самый свежий в LRU
    return () => {
      r.listeners.delete(cb);
    };
  },

  /** Загрузить готовую историю (открытие сессии без активного хода). */
  setHistory(
    threadId: string,
    history: {
      role: Role;
      content: string;
      parts?: MessagePart[];
      tokens?: number | null;
      id?: string | null;
      feedback?: "up" | "down" | null;
      attachments?: Attachment[];
    }[],
  ) {
    const r = rec(threadId);
    if (r.state.isStreaming) return;
    const all: ChatMessage[] = history.map((h) => ({
      id: nextId(),
      role: h.role,
      content: h.content,
      parts: h.parts,
      tokens: h.tokens ?? null,
      serverId: h.id ?? null,
      feedback: h.feedback ?? null,
      attachments: h.attachments,
    }));
    // React рендерит только хвост-окно; всё, что выше, — в older (loadMore
    // вернёт при скролле вверх).
    r.older = all.slice(0, Math.max(0, all.length - HISTORY_PAGE));
    r.state = {
      messages: all.slice(-HISTORY_PAGE),
      isStreaming: false,
      error: null,
      pendingPermissions: [],
      pendingQuestions: null,
      // Фоновые процессы живут в main-процессе и переживают перезагрузку ленты —
      // сохраняем их, а не обнуляем (иначе панель «забудет» идущую установку).
      bgTasks: r.state.bgTasks,
    };
    r.frames = 0;
    r.assistantId = null;
    emit(r);
  },

  /** Подгрузить следующую порцию истории (scroll вверх): переложить хвост older
   *  в начало окна. Живые сообщения окна при этом НЕ трогаются (прежняя схема
   *  заменяла окно срезом полной истории и теряла их из виду). */
  loadMore(threadId: string): boolean {
    const r = rec(threadId);
    if (r.older.length === 0) return false;
    const take = r.older.slice(-HISTORY_PAGE);
    r.older = r.older.slice(0, -take.length);
    setState(threadId, { messages: [...take, ...r.state.messages] });
    return r.older.length > 0;
  },

  /** Есть ли ещё история выше видимых сообщений. */
  hasMore(threadId: string): boolean {
    return rec(threadId).older.length > 0;
  },

  /** Сбросить ленту черновика (новая пустая сессия). */
  reset(threadId: string) {
    const r = rec(threadId);
    if (r.state.isStreaming) return; // активный ход не трогаем
    r.state = EMPTY;
    r.older = [];
    r.frames = 0;
    r.assistantId = null;
    emit(r);
  },

  /**
   * Запустить ход: добавить сообщения пользователя+ассистента, открыть стрим.
   * sendMessage уже содержит блок «Прикреплённые файлы:» (готовит вызывающий).
   */
  async start(
    threadId: string,
    opts: {
      visibleText: string;
      sendMessage: string;
      attachments?: Attachment[];
      // Только для avy-code + локальный агент: содержимое вложений уже
      // base64-закодировано в renderer, инжектится в сообщение локально (см.
      // code-streams.ts:runCodeTurn, use-chat.ts:send). attachments выше —
      // отдельно, это только то, что рисуется чипом в пузыре сообщения.
      codeAttachments?: { name: string; mime: string; data: string }[];
      modelId?: string;
      effort?: string | null;
      mode?: string | null;
      permissionMode?: string | null;
    } & RunCallbacks,
  ) {
    const r = rec(threadId);
    if (r.state.isStreaming) return;
    // Дождаться ПОЛНОГО закрытия прошлого генератора. После permission_request/
    // ask_user isStreaming снимается сразу (кнопки карточки живые), но хвост
    // стрима (main дописывает чекпоинт → done) может ещё дозакрываться — а у
    // моста одна onEvent-подписка на тред: два параллельных consume() задвоили
    // бы события (см. code-agent-stream.ts).
    if (r.run) {
      try { await r.run; } catch { /* прошлый ход упал — новому не мешает */ }
      if (r.state.isStreaming) return; // за время ожидания ход уже стартовал
    }

    // Режим Avy Code: запомнить параметры хода для возобновления после approval.
    r.codeRun =
      opts.mode === "avy-code"
        ? {
            modelId: opts.modelId,
            effort: opts.effort,
            permissionMode: opts.permissionMode,
            onTitle: opts.onTitle,
            onDone: opts.onDone,
          }
        : null;

    const userMsgId = nextId();
    const assistantId = nextId();
    r.assistantId = assistantId;
    r.frames = 0;
    r.subagentMap = new Map(); // связки сабагентов — на каждый ход свои
    // Буфер дельт сабагентов — тоже на каждый ход свой (хвост прошлого хода уже
    // слит в consume.finally; на всякий случай гасим возможный висящий таймер).
    if (r.subagentFlush) {
      clearTimeout(r.subagentFlush);
      r.subagentFlush = 0;
    }
    r.subagentBuffer = new Map();
    // Буфер дельт основного потока — тоже на каждый ход свой.
    if (r.mainFlush) {
      clearTimeout(r.mainFlush);
      r.mainFlush = 0;
    }
    r.mainBuffer = null;

    patchMessages(threadId, (msgs) => {
      // Подрезка живого окна: пользователь только что ОТПРАВИЛ сообщение — он у
      // низа ленты, удаление строк сверху скролл не дёргает. Голова сверх
      // LIVE_WINDOW уходит в older и вернётся через loadMore при скролле вверх.
      // Без этого за долгую сессию без перезахода DOM рос бы бесконечно.
      let win = msgs;
      const over = win.length - LIVE_WINDOW;
      if (over > 0) {
        r.older = [...r.older, ...win.slice(0, over)];
        win = win.slice(over);
      }
      return [
        ...win,
        {
          id: userMsgId,
          role: "user",
          content: opts.visibleText,
          attachments: opts.attachments,
        },
        { id: assistantId, role: "assistant", content: "", parts: [] },
      ];
    });
    r.pendingDecisions = new Map();
    setState(threadId, { isStreaming: true, error: null, pendingPermissions: [] });

    const ctrl = new AbortController();
    r.ctrl = ctrl;
    // Весь цикл хода — отдельным promise в r.run: resolvePermission/start
    // следующего хода дожидаются его ПОЛНОГО закрытия (см. комментарий к run).
    const run = (async () => {
      try {
        // avy-code внутри Electron: локальный агент вместо HTTP+SSE (см.
        // code-streams.ts:runCodeTurn) — null для обычного чата или desktop без
        // моста, тогда используем streamChat как раньше.
        const source =
          runCodeTurn(opts.mode, {
            message: opts.sendMessage,
            threadId,
            modelId: opts.modelId,
            effort: opts.effort,
            permissionMode: opts.permissionMode,
            signal: ctrl.signal,
            attachments: opts.codeAttachments,
          }) ??
          streamChat(
            {
              message: opts.sendMessage,
              threadId,
              modelId: opts.modelId,
              effort: opts.effort,
              mode: opts.mode,
              permissionMode: opts.permissionMode,
            },
            ctrl.signal,
          );
        await consume(threadId, source, assistantId, opts);
      } catch (e) {
        // AbortError = пользователь ушёл из сессии (локальный отцеп). Ход на сервере
        // продолжается; состояние оставляем streaming, чтобы reattach его подхватил.
        if ((e as Error).name !== "AbortError") {
          setState(threadId, { error: (e as Error).message });
        } else {
          return; // НЕ снимаем isStreaming — ход жив на сервере
        }
      }
      // Дошли до конца стрима (done) — ход завершён.
      if (r.ctrl === ctrl) r.ctrl = null;
      setState(threadId, { isStreaming: false });
      opts.onDone?.(threadId);
    })();
    r.run = run;
    await run;
  },

  /**
   * Режим Avy Code: ответить на одну карточку из очереди.
   * Делегируем в code-streams (изолирован от основного стора).
   */
  async resolvePermission(threadId: string, decision: "approve" | "reject", comment?: string) {
    await codeResolvePermission(
      { rec, setState, consume, nextId },
      threadId,
      decision,
      comment,
    );
  },

  /**
   * Режим Avy Code: ответить на карточку ask_user (все вопросы разом).
   * Делегируем в code-streams — resume уходит с массивом ответов.
   */
  async resolveQuestions(threadId: string, answers: AskUserAnswer[]) {
    await codeResolveQuestions(
      { rec, setState, consume, nextId },
      threadId,
      answers,
    );
  },

  /**
   * Режим Avy Code: Esc на карточке ask_user — остановить ход и снять карточку.
   * После ask_user_request ход уже дошёл до done (граф на паузе в чекпоинте,
   * abortController обнулён), поэтому stop() тут обычно no-op — но зовём его на
   * случай гонки, а главное убираем pendingQuestions и снимаем isStreaming.
   * Граф остаётся на паузе в чекпоинте; следующий sendMessage перезапишет ход.
   */
  dismissQuestions(threadId: string) {
    stopCodeAgent(threadId);
    const r = rec(threadId);
    r.pendingAnswers = [];
    setState(threadId, { pendingQuestions: null, isStreaming: false });
  },

  /**
   * Перегенерировать последний ответ агента. Срезаем последний ассистентский
   * пузырь из ленты, ставим пустой под новый стрим и открываем /retry. Сервер
   * чистит историю и заново отрабатывает прежнее сообщение пользователя.
   */
  async retry(
    threadId: string,
    opts: {
      modelId?: string;
      effort?: string | null;
      mode?: string | null;
    } & RunCallbacks = {},
  ) {
    const r = rec(threadId);
    if (r.state.isStreaming) return;
    // Нечего ретраить, если последнее сообщение не от ассистента.
    const msgs0 = r.state.messages;
    if (!msgs0.length || msgs0[msgs0.length - 1].role !== "assistant") return;

    const assistantId = nextId();
    r.assistantId = assistantId;
    r.frames = 0;
    r.subagentMap = new Map();
    if (r.subagentFlush) {
      clearTimeout(r.subagentFlush);
      r.subagentFlush = 0;
    }
    r.subagentBuffer = new Map();

    // Заменяем последний ассистентский пузырь пустым под новый стрим.
    patchMessages(threadId, (msgs) => [
      ...msgs.slice(0, -1),
      { id: assistantId, role: "assistant", content: "", parts: [] },
    ]);
    setState(threadId, { isStreaming: true, error: null });

    const ctrl = new AbortController();
    r.ctrl = ctrl;
    try {
      await consume(
        threadId,
        streamRetry(
          {
            threadId,
            modelId: opts.modelId,
            effort: opts.effort,
            mode: opts.mode,
          },
          ctrl.signal,
        ),
        assistantId,
        opts,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setState(threadId, { error: (e as Error).message });
      } else {
        return;
      }
    }
    if (r.ctrl === ctrl) r.ctrl = null;
    setState(threadId, { isStreaming: false });
    opts.onDone?.(threadId);
  },

  /**
   * Отредактировать сообщение пользователя и перегенерировать ответ. Срезаем
   * ленту с этого сообщения (по serverId), ставим обновлённый пузырь юзера +
   * пустой ассистентский под стрим, открываем /edit.
   */
  async edit(
    threadId: string,
    serverId: string,
    newText: string,
    opts: {
      modelId?: string;
      effort?: string | null;
      mode?: string | null;
    } & RunCallbacks = {},
  ) {
    const r = rec(threadId);
    if (r.state.isStreaming) return;
    const idx = r.state.messages.findIndex((m) => m.serverId === serverId);
    if (idx < 0) return;

    const userMsgId = nextId();
    const assistantId = nextId();
    r.assistantId = assistantId;
    r.frames = 0;
    r.subagentMap = new Map();
    if (r.subagentFlush) {
      clearTimeout(r.subagentFlush);
      r.subagentFlush = 0;
    }
    r.subagentBuffer = new Map();

    // Оставляем всё ДО редактируемого сообщения, затем новый user + пустой ответ.
    patchMessages(threadId, (msgs) => [
      ...msgs.slice(0, idx),
      { id: userMsgId, role: "user", content: newText },
      { id: assistantId, role: "assistant", content: "", parts: [] },
    ]);
    setState(threadId, { isStreaming: true, error: null });

    const ctrl = new AbortController();
    r.ctrl = ctrl;
    try {
      await consume(
        threadId,
        streamEdit(
          {
            threadId,
            messageId: serverId,
            text: newText,
            modelId: opts.modelId,
            effort: opts.effort,
            mode: opts.mode,
          },
          ctrl.signal,
        ),
        assistantId,
        opts,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setState(threadId, { error: (e as Error).message });
      } else {
        return;
      }
    }
    if (r.ctrl === ctrl) r.ctrl = null;
    setState(threadId, { isStreaming: false });
    opts.onDone?.(threadId);
  },

  /**
   * Переподключиться к идущему на сервере ходу (после reload или возврата в
   * сессию, чей локальный цикл был отцеплен). Если хода нет — no-op (сервер
   * пришлёт только done). offset = сколько кадров уже показано (frames).
   */
  async reattach(threadId: string, cbs: RunCallbacks = {}) {
    const r = rec(threadId);
    // Уже есть живой локальный цикл (start или прошлый reattach) — второй не нужен.
    if (r.ctrl) return;

    const ctrl = new AbortController();
    r.ctrl = ctrl;
    // ВАЖНО: isStreaming НЕ выставляем заранее — иначе параллельная загрузка
    // истории (setHistory) будет заблокирована, даже если живого хода нет. Ждём
    // первого СОДЕРЖАТЕЛЬНОГО кадра: если придёт только `done` (хода нет) —
    // состояние не трогаем, история загрузится как обычно.
    let started = false;
    let assistantId = r.assistantId;
    try {
      const source = attachChat(threadId, r.frames, ctrl.signal);
      for await (const ev of source) {
        if (!started) {
          if (ev.type === "done") break; // живого хода нет — выходим тихо
          started = true;
          // Нужен ассистентский пузырь под стрим. После reload его нет — создаём.
          if (!assistantId) {
            assistantId = nextId();
            r.assistantId = assistantId;
            patchMessages(threadId, (msgs) => [
              ...msgs,
              { id: assistantId!, role: "assistant", content: "", parts: [] },
            ]);
          }
          setState(threadId, { isStreaming: true, error: null });
        }
        r.frames += 1;
        applyEvent(threadId, ev, assistantId!, cbs.onTitle);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        if (started) setState(threadId, { error: (e as Error).message });
      } else {
        return; // снова отцепились — ход жив на сервере
      }
    } finally {
      // Слить хвосты буферов и при успехе, и при отмене/ошибке reattach.
      if (started) {
        flushMainBuffer(threadId, assistantId!);
        flushSubagentBuffer(threadId, assistantId!);
      }
    }
    if (r.ctrl === ctrl) r.ctrl = null;
    if (started) {
      setState(threadId, { isStreaming: false });
      cbs.onDone?.(threadId);
    }
  },

  /** Отцепить локальный цикл сессии БЕЗ отмены хода на сервере (уход из сессии). */
  detach(threadId: string) {
    const r = records.get(threadId);
    if (r?.ctrl) {
      r.ctrl.abort();
      r.ctrl = null;
    }
    // Ушли из треда — момент почистить память от давно не открывавшихся сессий
    // (выгружаются только неактивные и без подписчиков; см. evictIdle).
    evictIdle();
  },

  /** Остановить ход (кнопка Stop / Esc): отменяем на сервере + локально. */
  stop(threadId: string) {
    if (hasLocalCodeAgent()) {
      // Electron + локальный агент: нет серверного SSE-хода вообще — стоп
      // идёт напрямую в main-процесс через IPC (session.abortController.abort()
      // в sessionManager.ts). Агент сам пришлёт terminal-событие {type:"stopped"},
      // которое штатно завершит generator в code-agent-stream.ts.
      stopCodeAgent(threadId);
      return;
    }
    void stopChat(threadId);
    const r = records.get(threadId);
    // Локальный fetch рвём с задержкой, чтобы успел дойти кадр `stopped`.
    const ctrl = r?.ctrl;
    if (ctrl) setTimeout(() => ctrl.abort(), 2000);
  },
};
