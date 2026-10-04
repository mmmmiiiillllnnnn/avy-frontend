/** Подключение формой (`auth: form`): значения полей уходят в `fields`, токен — нет. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectConnector } from "@/lib/api";

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("connectConnector", () => {
  it("форма: поля как есть, включая галочку", async () => {
    const calls = stubFetch(200, { tools: [{ name: "send" }] });
    const fields = { server: "mail.corp.ru", email: "a@corp.ru", login: "", password: "p", insecure: true };
    const res = await connectConnector("exchange", undefined, fields);
    expect(res.ok).toBe(true);
    expect(calls[0].url).toContain("/api/connectors/exchange/connect");
    expect(calls[0].body).toEqual({ token: null, fields });
  });

  it("токен: тело прежнее, без fields", async () => {
    const calls = stubFetch(200, { tools: [] });
    await connectConnector("telegram", "123:abc");
    expect(calls[0].body).toEqual({ token: "123:abc" });
  });

  it("отказ сервера — текстом ошибки", async () => {
    stubFetch(400, { detail: "Сервер не принял подключение: Exchange не принял логин или пароль" });
    const res = await connectConnector("exchange", undefined, { server: "x", email: "a@b.c", password: "bad" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("не принял логин или пароль");
  });
});
