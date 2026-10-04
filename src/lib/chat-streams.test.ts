/**
 * Ленты фоновых агентов: переподключение после обрыва и поиск работающих
 * агентов по живым сообщениям. Прод 21.09: после обрыва ленты карточка
 * агента замирала до перезагрузки страницы.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Сеть подменяем целиком: attachSubagent — управляемый генератор кадров,
// остальное — заглушки (стор их не зовёт в этих сценариях).
const attachCalls: { agentId: string; offset: number }[] = [];
let scripts: (() => AsyncGenerator<unknown>)[] = [];

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  attachSubagent: (_threadId: string, agentId: string, offset: number) => {
    attachCalls.push({ agentId, offset });
    const next = scripts.shift();
    if (!next) throw new Error("сценарий кадров не задан");
    return next();
  },
  attachChat: () => { throw new Error("не ожидалось"); },
  deliverSubagentReports: async function* () { yield { type: "done" }; },
  fetchThreadMessages: async () => [],
  fetchThreadHistory: async () => ({ messages: [], pending: [] }),
  interjectTurn: () => { throw new Error("не ожидалось"); },
  stopChat: async () => {},
  stopSubagent: async () => {},
  streamChat: () => { throw new Error("не ожидалось"); },
  streamRetry: () => { throw new Error("не ожидалось"); },
  streamEdit: () => { throw new Error("не ожидалось"); },
}));
vi.mock("@/lib/chat-permissions", () => ({
  handlePermissionRequest: () => {},
  resolvePermission: async () => {},
}));

import {
  chatStreams, historyBeforeLiveTurn, liveMessages, subagentSteps, subagentText, unsavedMessages,
  type ChatMessage,
} from "@/lib/chat-streams";

const runningTask = (id: string, agentId: string): ChatMessage => ({
  id,
  role: "assistant",
  content: "",
  parts: [{
    type: "chain",
    steps: [{
      kind: "tool", id: `call_${agentId}`, name: "task", state: "available",
      args: { description: "сделай", background: true },
      background: { agent_id: agentId, status: "running", subagent_type: "gp", title: null },
    }],
  }],
});

const frame = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

async function* stream(...frames: unknown[]) {
  for (const f of frames) yield f;
}

/** Генератор, который отдаёт кадры и потом ВИСИТ (живая лента), пока не отцепят. */
function hanging(...frames: unknown[]) {
  return async function* () {
    for (const f of frames) yield f;
    await new Promise(() => {});
  };
}

beforeEach(() => {
  attachCalls.length = 0;
  scripts = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("liveMessages", () => {
  it("живая версия сообщения из state перекрывает историю, история дополняет", () => {
    const stale: ChatMessage = { ...runningTask("m1", "a1"), parts: [] }; // в истории агента ещё нет
    const older: ChatMessage = { id: "m0", role: "user", content: "привет" };
    const live = runningTask("m1", "a1");
    const out = liveMessages({ allMessages: [older, stale], state: { messages: [live] } });
    expect(out.map((m) => m.id).sort()).toEqual(["m0", "m1"]);
    expect(out.find((m) => m.id === "m1")).toBe(live);
  });
});

describe("unsavedMessages — живой хвост, когда начало хода неизвестно", () => {
  it("реплики этой сессии без серверного id не дублируются после истории", () => {
    // dev 28.09: деплой перезапустил бэкенд посреди хода, лента переподключилась
    // и перечитала историю — обе реплики треда всплыли дублями в конце.
    const q1: ChatMessage = { id: "l1", role: "user", content: "Доступ к календарю у тебя есть?" };
    const a1: ChatMessage = { id: "l2", role: "assistant", content: "Да", serverId: "s1" };
    const q2: ChatMessage = { id: "l3", role: "user", content: "Проверь весь функционал" };
    const bubble: ChatMessage = { id: "l4", role: "assistant", content: "Проверяю…", parts: [] };
    const history: ChatMessage[] = [
      { id: "h1", role: "user", content: "Доступ к календарю у тебя есть?" },
      { id: "h2", role: "assistant", content: "Да", serverId: "s1" },
      { id: "h3", role: "user", content: "Проверь весь функционал" },
      { id: "h4", role: "assistant", content: "Проверяю…" },
    ];
    const tail = unsavedMessages([q1, a1, q2, bubble], history);
    expect(tail.map((m) => m.id)).toEqual(["l4"]);
    const merged = [...historyBeforeLiveTurn(history, tail), ...tail];
    expect(merged.map((m) => m.content)).toEqual([
      "Доступ к календарю у тебя есть?", "Да", "Проверь весь функционал", "Проверяю…",
    ]);
  });

  it("новая реплика, которой в истории ещё нет, остаётся живой — и одинаковые не склеиваются", () => {
    const history: ChatMessage[] = [{ id: "h1", role: "user", content: "ещё" }];
    const live: ChatMessage[] = [
      { id: "l1", role: "user", content: "ещё" },
      { id: "l2", role: "user", content: "ещё" },
      { id: "l3", role: "user", content: "в очереди", pending: true },
    ];
    expect(unsavedMessages(live, history).map((m) => m.id)).toEqual(["l2", "l3"]);
  });

  it("история с блоком вложений узнаётся по началу текста", () => {
    const history: ChatMessage[] = [
      { id: "h1", role: "user", content: "Посмотри файл\n\nПрикреплённые файлы:\n- /uploads/a.pdf" },
    ];
    const live: ChatMessage[] = [{ id: "l1", role: "user", content: "Посмотри файл" }];
    expect(unsavedMessages(live, history)).toEqual([]);
  });
});

describe("лента фонового агента", () => {
  it("оборвалась без subagent_done — переоткрывается через 2 с", async () => {
    const threadId = "t-reconnect";
    scripts = [
      () => stream(frame("tool", { id: "x", name: "bash", args: {}, state: "available" })), // обрыв
      hanging(frame("reasoning", { value: "думаю" })),
    ];
    chatStreams.setHistory(threadId, [runningTask("m1", "a1")]);
    await vi.advanceTimersByTimeAsync(10);
    expect(attachCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2100);
    expect(attachCalls).toHaveLength(2);
    expect(attachCalls[1]).toEqual({ agentId: "a1", offset: 0 });
    // Живая лента — больше не переоткрываем.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attachCalls).toHaveLength(2);
    chatStreams.detach(threadId);
  });

  it("дочитана до subagent_done — не переоткрывается, статус проставлен", async () => {
    const threadId = "t-done";
    scripts = [() => stream(frame("subagent_done", { agent_id: "a1", status: "done", follow_up: false }))];
    chatStreams.setHistory(threadId, [runningTask("m1", "a1")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attachCalls).toHaveLength(1);
    const msg = chatStreams.getState(threadId).messages.find((m) => m.id !== undefined);
    const step = msg?.parts?.[0].type === "chain" ? msg.parts[0].steps[0] : undefined;
    expect(step?.kind === "tool" && step.background?.status).toBe("done");
    chatStreams.detach(threadId);
  });

  it("ленты нет на сервере (первый кадр done) — не более трёх повторов, без вечного цикла", async () => {
    const threadId = "t-missing";
    scripts = [
      () => stream(frame("done")),
      () => stream(frame("done")),
      () => stream(frame("done")),
      () => stream(frame("done")),
      () => stream(frame("done")),
    ];
    chatStreams.setHistory(threadId, [runningTask("m1", "a1")]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attachCalls.length).toBe(4);
    chatStreams.detach(threadId);
  });

  it("отцепили (detach) во время ленты — не переоткрывается", async () => {
    const threadId = "t-detach";
    scripts = [hanging(frame("reasoning", { value: "…" })), hanging()];
    chatStreams.setHistory(threadId, [runningTask("m1", "a1")]);
    await vi.advanceTimersByTimeAsync(10);
    expect(attachCalls).toHaveLength(1);
    chatStreams.detach(threadId);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attachCalls).toHaveLength(1);
  });
});

describe("лента субагента — те же части, что у ответа ассистента", () => {
  it("текст между тулами стоит на своём месте, итог — последняя текстовая часть", async () => {
    const threadId = "t-parts";
    scripts = [
      () =>
        stream(
          frame("reasoning", { value: "думаю" }),
          frame("tool", { id: "c1", name: "web_search", args: { query: "q" }, state: "available" }),
          frame("text", { value: "Нашёл, проверю. " }),
          frame("tool", { id: "c2", name: "bash", args: { command: "ls" }, state: "available" }),
          frame("tool_result", { tool_call_id: "c2", output: "a", ok: true, truncated: false }),
          frame("text", { value: "Готово." }),
          frame("subagent_done", { agent_id: "a1", status: "done", follow_up: false }),
        ),
    ];
    chatStreams.setHistory(threadId, [runningTask("m1", "a1")]);
    await vi.advanceTimersByTimeAsync(10_000);
    const msg = chatStreams.getState(threadId).messages[0];
    const step = msg.parts?.[0].type === "chain" ? msg.parts[0].steps[0] : undefined;
    const run = step?.kind === "tool" ? step.subagent : undefined;
    expect(run?.parts.map((p) => p.type)).toEqual(["chain", "text", "chain", "text"]);
    expect(subagentText(run)).toBe("Готово.");
    expect(subagentSteps(run).map((s) => (s.kind === "tool" ? s.name : "reasoning"))).toEqual([
      "reasoning",
      "web_search",
      "bash",
    ]);
    // Результат тула дописался в шаг внутри цепочки, а не потерялся.
    const bash = subagentSteps(run)[2];
    expect(bash.kind === "tool" && bash.result?.ok).toBe(true);
    chatStreams.detach(threadId);
  });
});

describe("субагент субагента", () => {
  it("кадры с путём «внешний/вложенный» ложатся в шаг task внутри ленты внешнего", async () => {
    const threadId = "t-nested";
    scripts = [
      () =>
        stream(
          frame("reasoning", { agent: "call_a1", value: "план" }),
          frame("tool", {
            agent: "call_a1", id: "inner", name: "task", state: "available",
            args: { subagent_type: "researcher", description: "d" },
          }),
          frame("reasoning", { agent: "call_a1/inner", value: "думаю" }),
          frame("tool", { agent: "call_a1/inner", id: "s1", name: "web_search", args: { query: "q" }, state: "available" }),
          frame("sources", { agent: "call_a1/inner", tool_call_id: "s1", sources: [{ title: "t", url: "https://x" }] }),
          frame("text", { agent: "call_a1/inner", value: "нашёл" }),
          frame("text", { agent: "call_a1", value: "итог внешнего" }),
          frame("subagent_done", { agent_id: "a1", status: "done", follow_up: false }),
        ),
    ];
    chatStreams.setHistory(threadId, [runningTask("m1", "a1")]);
    await vi.advanceTimersByTimeAsync(10_000);
    const msg = chatStreams.getState(threadId).messages[0];
    const top = msg.parts?.[0].type === "chain" ? msg.parts[0].steps[0] : undefined;
    const outer = top?.kind === "tool" ? top.subagent : undefined;
    // Внешний: цепочка (план + вызов task) и его итог; поиск вложенного в неё НЕ попал.
    expect(outer?.parts.map((p) => p.type)).toEqual(["chain", "text"]);
    expect(subagentSteps(outer).map((s) => (s.kind === "tool" ? s.name : "reasoning"))).toEqual(["reasoning", "task"]);
    expect(subagentText(outer)).toBe("итог внешнего");
    // Вложенный: своя лента в шаге task внешнего.
    const innerStep = subagentSteps(outer)[1];
    const inner = innerStep.kind === "tool" ? innerStep.subagent : undefined;
    expect(inner?.parts.map((p) => p.type)).toEqual(["chain", "text"]);
    expect(subagentSteps(inner).map((s) => (s.kind === "tool" ? s.name : "reasoning"))).toEqual(["reasoning", "web_search"]);
    const search = subagentSteps(inner)[1];
    expect(search.kind === "tool" && search.sources?.[0].url).toBe("https://x");
    expect(subagentText(inner)).toBe("нашёл");
    chatStreams.detach(threadId);
  });
});


describe("карточки хода на паузе переживают перечитывание истории", () => {
  it("setPending восстанавливает подтверждения, вопрос и параметры продолжения", () => {
    const t = "pending-thread";
    chatStreams.setTurnParams(t, { modelId: "qwen3.8-flash", effort: "medium", mode: null });
    chatStreams.setHistory(t, [{ role: "user", content: "удали файл" }]);
    chatStreams.setPending(t, [
      { type: "permission_request", interrupt_id: "i1", tool: "mcp__yandex-disk__trash_by_query",
        args: { query: "old" }, description: "В корзину?" },
      { type: "permission_request", interrupt_id: "i1", tool: "mcp__yandex-disk__share", args: {}, description: "" },
      { type: "ask_user_request", interrupt_id: "i2", questions: [{ question: "Какой?" }] },
    ]);
    const s = chatStreams.getState(t);
    expect(s.pendingPermissions.map((p) => p.tool)).toEqual([
      "mcp__yandex-disk__trash_by_query", "mcp__yandex-disk__share",
    ]);
    expect(s.pendingPermissions[0].description).toBe("В корзину?");
    expect(s.pendingQuestions?.interruptId).toBe("i2");
    expect(s.pendingConnector).toBeNull();
  });

  it("новая загрузка истории без pending карточку не подменяет чужим", () => {
    const t = "pending-thread-2";
    chatStreams.setHistory(t, []);
    chatStreams.setPending(t, []);
    expect(chatStreams.getState(t).pendingPermissions).toEqual([]);
  });
});
