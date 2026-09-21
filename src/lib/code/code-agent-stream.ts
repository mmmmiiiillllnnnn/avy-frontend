"use client";

// Источник событий хода для code-режима внутри Electron: локальный агент
// (LangChain.js, apps/code-cli в main-процессе) вместо fetch("/api/chat") +
// SSE. Форма результата — тот же AsyncGenerator<ChatEvent>, что у streamChat
// (lib/api.ts), поэтому chat-streams.ts потребляет оба источника одинаково
// через consume() — меняется только то, ЧТО порождает события, не то, как
// они применяются к ленте.
//
// IPC — событийная модель (window.avyDesktop.codeAgent.onEvent — callback),
// а consume() ожидает pull-based AsyncGenerator (for await). Мост между ними —
// небольшая асинхронная очередь: onEvent кладёт в очередь, генератор её
// вычерпывает и приостанавливается, когда очередь пуста, до следующего события.

import type { AskUserAnswer, ChatEvent } from "@/lib/api";

class AsyncEventQueue {
  private queue: ChatEvent[] = [];
  private resolvers: Array<(ev: ChatEvent | null) => void> = [];
  private closed = false;

  push(ev: ChatEvent): void {
    if (this.closed) return;
    const resolve = this.resolvers.shift();
    if (resolve) resolve(ev);
    else this.queue.push(ev);
  }

  close(): void {
    this.closed = true;
    while (this.resolvers.length) this.resolvers.shift()?.(null);
  }

  async next(): Promise<ChatEvent | null> {
    if (this.queue.length) return this.queue.shift()!;
    if (this.closed) return null;
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}

const TERMINAL_TYPES = new Set(["done", "stopped", "error"]);

/**
 * Подписаться на события хода этого треда, ЗАТЕМ запустить сам ход (start),
 * и превратить поток в AsyncGenerator, совместимый с consume() из
 * chat-streams.ts. Порядок важен: подписка ставится ДО start(), иначе первые
 * события (быстрый tool-call, мгновенный permission_request) могут прийти
 * раньше, чем onEvent начнёт слушать — гонка между "invoke резолвится" и
 * "generator подписался". Завершает генератор на done/stopped/error
 * (терминальные события хода, см. events.ts на стороне агента).
 *
 * ВАЖНО: signal здесь НЕ используется для закрытия очереди. В отличие от
 * серверного SSE-хода (streamChat), где abort рвёт только ЛОКАЛЬНОЕ чтение, а
 * сам ход продолжается на сервере и reattach() его снова подхватит — здесь
 * этот AsyncGenerator единственный канал доставки событий локального агента
 * (Electron main-процесс). chat-streams.ts:detach() дёргает тот же
 * AbortController при каждом unmount/remount useChat (в т.ч. React StrictMode
 * двойной mount в dev) — если бы signal закрывал очередь, эта "техническая"
 * отписка тихо обрывала бы приём уже идущих событий агента без возможности
 * переподключиться (см. историю бага: agent.stream() в main реально отдавал
 * 31 чанк, но onEvent в preload не получил НИ ОДНОГО — очередь закрылась
 * раньше). Остановку хода пользователем ("Стоп") делает bridge.stop() —
 * агент сам пришлёт terminal-событие {type:"stopped"}, и цикл ниже завершится
 * штатно через TERMINAL_TYPES, без внешнего abort.
 */
async function* subscribeCodeAgentEvents(
  threadId: string,
  start: () => Promise<unknown>,
): AsyncGenerator<ChatEvent> {
  const bridge = window.avyDesktop?.codeAgent;
  if (!bridge) {
    throw new Error("codeAgent недоступен — запустите приложение внутри Electron-десктопа");
  }

  const queue = new AsyncEventQueue();
  const unsubscribe = bridge.onEvent(threadId, (ev) => queue.push(ev));

  try {
    await start();
    while (true) {
      const ev = await queue.next();
      if (ev === null) return;
      yield ev;
      if (TERMINAL_TYPES.has(ev.type)) return;
    }
  } finally {
    unsubscribe();
    queue.close();
  }
}

/** Вложение, уже прочитанное и base64-закодированное в renderer (см.
 *  code-streams.ts:filesToAttachments) — File.path недоступен в Electron. */
export type CodeAgentAttachment = { name: string; mime: string; data: string };

export type CodeAgentRunRequest = {
  message: string;
  threadId: string;
  roots: string[];
  modelId?: string;
  effort?: string | null;
  permissionMode?: string | null;
  attachments?: CodeAgentAttachment[];
};

/**
 * Аналог streamChat (lib/api.ts) для code-режима: запускает ход через
 * window.avyDesktop.codeAgent.sendMessage и возвращает AsyncGenerator<ChatEvent>
 * — тот же контракт, тот же способ потребления через consume().
 */
export async function* streamCodeAgent(
  req: CodeAgentRunRequest,
): AsyncGenerator<ChatEvent> {
  const bridge = window.avyDesktop?.codeAgent;
  if (!bridge) {
    throw new Error("codeAgent недоступен — запустите приложение внутри Electron-десктопа");
  }
  yield* subscribeCodeAgentEvents(req.threadId, () =>
    bridge.sendMessage(
      req.threadId,
      req.message,
      req.roots,
      {
        modelId: req.modelId,
        effort: req.effort,
        permissionMode: req.permissionMode,
      },
      req.attachments,
    ),
  );
}

/**
 * Аналог отправки resume в streamChat — возобновление хода после approval.
 * Используется из code-streams.ts:resolvePermission вместо streamChat(...resume).
 */
export async function* resumeCodeAgent(
  threadId: string,
  decisions: Array<{ type: "approve" | "reject"; message?: string }>,
): AsyncGenerator<ChatEvent> {
  const bridge = window.avyDesktop?.codeAgent;
  if (!bridge) {
    throw new Error("codeAgent недоступен — запустите приложение внутри Electron-десктопа");
  }
  yield* subscribeCodeAgentEvents(threadId, () => bridge.resolvePermissions(threadId, decisions));
}

/**
 * Возобновление хода после ответа на ask_user — аналог resumeCodeAgent, но
 * канал resume свой ({ answers }, см. sessionManager.resolveQuestions).
 * Используется из code-streams.ts:resolveQuestions.
 */
export async function* answerCodeAgentQuestions(
  threadId: string,
  answers: AskUserAnswer[],
): AsyncGenerator<ChatEvent> {
  const bridge = window.avyDesktop?.codeAgent;
  if (!bridge) {
    throw new Error("codeAgent недоступен — запустите приложение внутри Electron-десктопа");
  }
  yield* subscribeCodeAgentEvents(threadId, () => bridge.resolveQuestions(threadId, answers));
}

/**
 * Остановить ход локального агента (кнопка Stop / Esc). Дёргает
 * session.abortController.abort() в Electron main-процессе напрямую через
 * IPC — см. sessionManager.ts:stop(). Агент сам пришлёт terminal-событие
 * {type:"stopped"}, которое штатно завершит subscribeCodeAgentEvents выше.
 */
export function stopCodeAgent(threadId: string): void {
  window.avyDesktop?.codeAgent?.stop(threadId);
}

export type CodeContextUsage = { used_tokens: number; max_tokens: number };

/**
 * Заполненность контекста треда локального агента — без обращения к серверу
 * (см. sessionManager.ts:getContextUsage). null, если сессия ещё не
 * создавалась в этом процессе Electron (агент ни разу не запускался).
 */
export async function fetchCodeAgentContextUsage(
  threadId: string,
): Promise<CodeContextUsage | null> {
  const bridge = window.avyDesktop?.codeAgent;
  if (!bridge) return null;
  return bridge.getContextUsage(threadId);
}

/**
 * Принудительное сжатие контекста локального агента — аналог compactContext
 * (lib/api.ts), но идёт через IPC/sessionManager.compact() вместо
 * POST /api/threads/{id}/compact. Тот же summarizer/prompt/model, что и
 * авто-сжатие (см. buildAgent.ts:forceCompactStopMiddleware) — не отдельная
 * реализация. Вычерпывает поток событий хода до terminal (done/stopped/error),
 * извлекая текст "summary" события (если сжатие реально произошло), затем
 * запрашивает свежую заполненность контекста для возврата.
 */
export async function compactCodeAgent(
  threadId: string,
): Promise<(CodeContextUsage & { compacted: boolean; summary: string | null; tokens: number | null }) | null> {
  const bridge = window.avyDesktop?.codeAgent;
  if (!bridge) return null;
  let summary: string | null = null;
  let tokens: number | null = null;
  for await (const ev of subscribeCodeAgentEvents(threadId, () => bridge.compact(threadId))) {
    if (ev.type === "summary") {
      summary = ev.text;
      // Объём свёрнутой истории — подпись блока «Контекст сжат (Nк токенов)».
      tokens = (ev as { tokens?: number | null }).tokens ?? null;
    }
  }
  const usage = await bridge.getContextUsage(threadId);
  if (!usage) return null;
  return { ...usage, compacted: summary !== null, summary, tokens };
}
