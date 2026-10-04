/**
 * Согласованность состояния хода: кто владеет лентой, когда ход окончен и
 * какой пузырь «работает». Сценарии — с живого dev 30.09: реплика в очередь
 * ставила лайки на ещё идущий ответ, «Стоп» с быстрым следующим сообщением
 * гасил флаг стрима поверх нового хода, а реаттач к уже законченному ходу
 * оставлял квадрат в поле ввода гореть до ручной остановки.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Управляемый поток кадров: тест кладёт кадры руками, поток висит, пока
 *  его не закроют или не оборвут по signal (как настоящий fetch). */
class Feed<T> {
  private queue: T[] = [];
  private wake: (() => void)[] = [];
  private closed = false;
  signal: AbortSignal | undefined;

  push(...items: T[]) {
    this.queue.push(...items);
    this.wake.splice(0).forEach((w) => w());
  }
  end() {
    this.closed = true;
    this.wake.splice(0).forEach((w) => w());
  }
  async *stream(signal?: AbortSignal): AsyncGenerator<T> {
    this.signal = signal;
    while (true) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve, reject) => {
        this.wake.push(resolve);
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    }
  }
}

const chatFeeds: Feed<unknown>[] = [];
const attachFeeds: Feed<unknown>[] = [];
const chatCalls: { message: string }[] = [];
const attachCalls: number[] = [];
let interjectResult: "queued" | "no_turn" | "error" = "queued";

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  streamChat: (req: { message: string }, signal?: AbortSignal) => {
    chatCalls.push({ message: req.message });
    const feed = chatFeeds.shift();
    if (!feed) throw new Error("поток хода не задан");
    return feed.stream(signal);
  },
  attachChat: (_threadId: string, offset: number, signal?: AbortSignal) => {
    attachCalls.push(offset);
    const feed = attachFeeds.shift();
    if (!feed) throw new Error("поток реаттача не задан");
    return feed.stream(signal);
  },
  interjectTurn: async () => interjectResult,
  stopChat: async () => {},
  stopSubagent: async () => {},
  attachSubagent: () => { throw new Error("не ожидалось"); },
  deliverSubagentReports: async function* () { yield { type: "done" }; },
  fetchThreadHistory: async () => ({ messages: [], pending: [] }),
  streamRetry: () => { throw new Error("не ожидалось"); },
  streamEdit: () => { throw new Error("не ожидалось"); },
}));
vi.mock("@/lib/chat-permissions", () => ({
  handlePermissionRequest: () => {},
  resolvePermission: async () => {},
}));

import { vi } from "vitest";
import { chatStreams, STOP_MARKER } from "@/lib/chat-streams";

const tick = () => new Promise((r) => setTimeout(r, 0));
let n = 0;
let threadId = "";

beforeEach(() => {
  threadId = `t${++n}`;
  chatFeeds.length = 0;
  attachFeeds.length = 0;
  chatCalls.length = 0;
  attachCalls.length = 0;
  interjectResult = "queued";
});
afterEach(() => {
  chatStreams.detach(threadId);
});

function startTurn(text = "вопрос"): Feed<unknown> {
  const feed = new Feed<unknown>();
  chatFeeds.push(feed);
  void chatStreams.start(threadId, { visibleText: text, sendMessage: text });
  return feed;
}

const state = () => chatStreams.getState(threadId);
const assistant = () => state().messages.filter((m) => m.role === "assistant");

describe("конец хода", () => {
  it("кадр done завершает ход сразу, не дожидаясь закрытия потока", async () => {
    const feed = startTurn();
    await tick();
    expect(state().isStreaming).toBe(true);
    expect(state().streamingId).toBe(assistant()[0].id);

    feed.push({ type: "text", value: "готово" }, { type: "done", message_id: "srv-1" });
    await tick();

    expect(state().isStreaming).toBe(false);
    expect(state().streamingId).toBeNull();
    expect(assistant()[0].serverId).toBe("srv-1");
    // Соединение отпущено: поток ещё не закрыт сервером, но кадров больше не будет.
    expect(feed.signal?.aborted).toBe(true);
  });

  it("stopped и error — тоже конец хода", async () => {
    const feed = startTurn();
    await tick();
    feed.push({ type: "text", value: "а" }, { type: "stopped" });
    await tick();
    expect(state().isStreaming).toBe(false);
    expect(assistant()[0].content).toBe(`а${STOP_MARKER}`);
  });
});

describe("реплика посреди хода", () => {
  it("пузырь-приёмник — по id, а не последний ряд; ответ на реплику идёт в новый пузырь", async () => {
    const feed = startTurn();
    await tick();
    feed.push({ type: "text", value: "первый " });
    await tick();
    const first = assistant()[0].id;

    await chatStreams.interject(threadId, { visibleText: "ещё", sendMessage: "ещё" });
    const pending = state().messages.find((m) => m.pending);
    expect(pending?.role).toBe("user");
    // Реплика встала ПОСЛЕ пузыря, но работает по-прежнему он.
    expect(state().messages[state().messages.length - 1].id).toBe(pending!.id);
    expect(state().streamingId).toBe(first);

    feed.push({ type: "interject", id: pending!.serverId, text: "ещё" });
    await tick();
    const fresh = assistant()[1];
    expect(state().streamingId).toBe(fresh.id);
    expect(state().messages.some((m) => m.pending)).toBe(false);

    feed.push({ type: "text", value: "ответ на реплику" }, { type: "done" });
    await tick();
    expect(assistant()[0].content).toBe("первый ");
    expect(assistant()[1].content).toBe("ответ на реплику");
    expect(chatCalls).toHaveLength(1); // агент забрал реплику — новый ход не нужен
    expect(state().isStreaming).toBe(false);
  });

  it("агент не дошёл до границы — реплика уходит следующим ходом сама", async () => {
    const feed = startTurn();
    await tick();
    await chatStreams.interject(threadId, { visibleText: "ещё", sendMessage: "ещё" });
    chatFeeds.push(new Feed());
    feed.push({ type: "text", value: "всё" }, { type: "done" });
    await tick();
    expect(chatCalls.map((c) => c.message)).toEqual(["вопрос", "ещё"]);
    expect(state().isStreaming).toBe(true);
    expect(state().messages.some((m) => m.pending)).toBe(false);
    expect(state().streamingId).toBe(assistant()[1].id);
  });
});

describe("владение лентой", () => {
  it("старый цикл после «Стоп» не гасит новый ход и не пишет в его пузырь", async () => {
    const feed1 = startTurn("раз");
    await tick();
    feed1.push({ type: "text", value: "первый" });
    await tick();

    chatStreams.stop(threadId);
    expect(state().isStreaming).toBe(false);

    const feed2 = startTurn("два");
    await tick();
    const second = assistant()[1];
    expect(state().isStreaming).toBe(true);
    expect(state().streamingId).toBe(second.id);

    // Сервер дописывает первому ходу stopped и закрывает поток — это уже
    // ничего не значит для ленты.
    feed1.push({ type: "stopped" });
    feed1.end();
    await tick();
    expect(state().isStreaming).toBe(true);
    expect(state().streamingId).toBe(second.id);
    expect(second.content).not.toContain(STOP_MARKER);

    feed2.push({ type: "text", value: "второй" }, { type: "text", value: "!" });
    await tick();
    expect(assistant()[1].content).toBe("второй!");
    // Offset реаттача считает только кадры живого цикла.
    chatStreams.detach(threadId);
    attachFeeds.push(new Feed());
    void chatStreams.reattach(threadId);
    await tick();
    expect(attachCalls).toEqual([2]);
  });

  it("после detach кадры старого цикла не ложатся в ленту и не двигают offset", async () => {
    const feed = startTurn();
    await tick();
    feed.push({ type: "text", value: "а" });
    await tick();

    chatStreams.detach(threadId);
    feed.push({ type: "text", value: "опоздал" });
    await tick();
    expect(assistant()[0].content).toBe("а");
    expect(state().isStreaming).toBe(true); // ход на сервере жив — флаг остаётся

    attachFeeds.push(new Feed());
    void chatStreams.reattach(threadId);
    await tick();
    expect(attachCalls).toEqual([1]);
  });
});

describe("продолжение после карточки", () => {
  it("после перечитывания истории ответ идёт в новый пузырь, а не в пустоту", async () => {
    const feed = startTurn("отправь письмо");
    await tick();
    feed.push(
      { type: "text", value: "Отправляю." },
      { type: "ask_user_request", interrupt_id: "i1", questions: [{ id: "q", text: "Кому?" }] },
      { type: "done" },
    );
    await tick();
    expect(state().isStreaming).toBe(false);
    expect(state().pendingQuestions?.interruptId).toBe("i1");

    // История перечитана: у сообщений новые id, прежнего пузыря больше нет.
    chatStreams.setHistory(threadId, [
      { role: "user", content: "отправь письмо", id: "u1" },
      { role: "assistant", content: "Отправляю.", id: "a1" },
    ]);
    chatStreams.setPending(threadId, [
      { type: "ask_user_request", interrupt_id: "i1", questions: [{ id: "q", text: "Кому?" }] },
    ] as never);
    expect(state().pendingQuestions?.interruptId).toBe("i1");

    const resumed = new Feed<unknown>();
    chatFeeds.push(resumed);
    void chatStreams.answerQuestions(threadId, [{ id: "q", answer: "маме" }] as never);
    await tick();
    expect(state().isStreaming).toBe(true);
    const bubble = assistant()[assistant().length - 1];
    expect(state().streamingId).toBe(bubble.id);
    resumed.push({ type: "text", value: "Письмо отправлено." }, { type: "done" });
    await tick();
    expect(assistant().map((m) => m.content)).toEqual(["Отправляю.", "Письмо отправлено."]);
    expect(state().isStreaming).toBe(false);
  });
});

describe("реаттач", () => {
  it("ход кончился, пока нас не было: одиночный done снимает флаг и ставит id ответа", async () => {
    const feed = startTurn();
    await tick();
    feed.push({ type: "text", value: "ответ" });
    await tick();
    chatStreams.detach(threadId);
    expect(state().isStreaming).toBe(true);

    const tail = new Feed<unknown>();
    attachFeeds.push(tail);
    void chatStreams.reattach(threadId);
    await tick();
    tail.push({ type: "done", message_id: "srv-9" });
    tail.end();
    await tick();

    expect(state().isStreaming).toBe(false);
    expect(state().streamingId).toBeNull();
    expect(assistant()[0].serverId).toBe("srv-9");
    // Синтетический done не считается кадром: следующий реаттач — с того же offset.
    attachFeeds.push(new Feed());
    void chatStreams.reattach(threadId);
    await tick();
    expect(attachCalls).toEqual([1, 1]);
  });

  it("хода не было и мы этого не ждали — done ничего не меняет", async () => {
    const tail = new Feed<unknown>();
    attachFeeds.push(tail);
    void chatStreams.reattach(threadId);
    await tick();
    tail.push({ type: "done" });
    tail.end();
    await tick();
    expect(state().isStreaming).toBe(false);
    expect(state().messages).toEqual([]);
  });

  it("живой ход дочитывается в пузырь, done завершает без ожидания потока", async () => {
    const tail = new Feed<unknown>();
    attachFeeds.push(tail);
    void chatStreams.reattach(threadId);
    await tick();
    tail.push({ type: "text", value: "продолжение" });
    await tick();
    expect(state().isStreaming).toBe(true);
    expect(state().streamingId).toBe(assistant()[0].id);
    tail.push({ type: "done" });
    await tick();
    expect(state().isStreaming).toBe(false);
    expect(assistant()[0].content).toBe("продолжение");
    expect(tail.signal?.aborted).toBe(true);
  });
});
