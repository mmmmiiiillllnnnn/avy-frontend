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

import { chatStreams, liveMessages, type ChatMessage } from "@/lib/chat-streams";

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
