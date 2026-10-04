/**
 * Карточка коннектора в ленте: кадр connector_request ставит ход на паузу
 * (как ask_user), ответ уходит тем же полем answers словарём {connected}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: unknown[] = [];
let scripts: (() => AsyncGenerator<unknown>)[] = [];

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  streamChat: (req: unknown) => {
    sent.push(req);
    const next = scripts.shift();
    if (!next) throw new Error("сценарий кадров не задан");
    return next();
  },
  attachSubagent: () => { throw new Error("не ожидалось"); },
  attachChat: () => { throw new Error("не ожидалось"); },
  deliverSubagentReports: async function* () { yield { type: "done" }; },
  fetchThreadMessages: async () => [],
  fetchThreadHistory: async () => ({ messages: [], pending: [] }),
  interjectTurn: () => { throw new Error("не ожидалось"); },
  stopChat: async () => {},
  stopSubagent: async () => {},
  streamRetry: () => { throw new Error("не ожидалось"); },
  streamEdit: () => { throw new Error("не ожидалось"); },
}));
vi.mock("@/lib/chat-permissions", () => ({
  handlePermissionRequest: () => {},
  resolvePermission: async () => {},
}));

import { chatStreams } from "@/lib/chat-streams";

async function* frames(...list: unknown[]) {
  for (const f of list) yield f;
}

const card = {
  id: "github",
  title: "GitHub",
  description: "Pages and databases",
  auth: ["oauth"],
  site: "",
  token_hint: "",
  missing_env: [],
  custom: false,
  reason: "not_connected",
};

beforeEach(() => {
  sent.length = 0;
  scripts = [];
  chatStreams.reset("t1");
});
afterEach(() => {
  chatStreams.reset("t1");
});

describe("connector_request", () => {
  it("кадр ставит ход на паузу с карточкой коннектора", async () => {
    scripts = [() => frames({ type: "connector_request", interrupt_id: "i1", connector: card })];
    await chatStreams.start("t1", { visibleText: "подключи github", sendMessage: "подключи github" });
    const s = chatStreams.getState("t1");
    expect(s.pendingConnector).toEqual({ interruptId: "i1", connector: card });
    expect(s.pendingQuestions).toBeNull();
    expect(s.isStreaming).toBe(false);
  });

  it("ответ на карточку уезжает полем answers как {connected} и снимает паузу", async () => {
    scripts = [
      () => frames({ type: "connector_request", interrupt_id: "i1", connector: card }),
      () => frames({ type: "text", text: "готово" }),
    ];
    await chatStreams.start("t1", { visibleText: "x", sendMessage: "x" });
    await chatStreams.answerConnector("t1", true);
    expect(sent).toHaveLength(2);
    expect((sent[1] as { answers: unknown }).answers).toEqual({ connected: true });
    expect((sent[1] as { message: string }).message).toBe("");
    expect(chatStreams.getState("t1").pendingConnector).toBeNull();
  });

  it("без карточки answerConnector ничего не шлёт", async () => {
    await chatStreams.answerConnector("t1", false);
    expect(sent).toHaveLength(0);
  });

  it("карточка восстанавливается из истории, продолжение идёт в новый пузырь", async () => {
    // Вход в сервис — во внешнем браузере: к возврату в окно история уже
    // перечитана, у сообщений новые id, прежнего пузыря в ленте нет.
    chatStreams.setHistory("t1", [
      { role: "user", content: "подключи github", id: "u1" },
      { role: "assistant", content: "Сейчас.", id: "a1" },
    ]);
    chatStreams.setPending("t1", [{ type: "connector_request", interrupt_id: "i1", connector: card }]);
    expect(chatStreams.getState("t1").pendingConnector).toEqual({ interruptId: "i1", connector: card });

    scripts = [() => frames({ type: "text", value: "Подключено." }, { type: "done" })];
    await chatStreams.answerConnector("t1", true);
    expect((sent[0] as { answers: unknown }).answers).toEqual({ connected: true });
    const s = chatStreams.getState("t1");
    expect(s.pendingConnector).toBeNull();
    expect(s.isStreaming).toBe(false);
    expect(s.messages.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual([
      "Сейчас.",
      "Подключено.",
    ]);
  });
});
