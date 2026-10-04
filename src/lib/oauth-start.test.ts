/** Ответ /oauth/start: ссылка на окно сервиса или код устройства (Яндекс ID). */
import { describe, expect, it } from "vitest";

import { parseOAuthStart } from "@/lib/api";

describe("parseOAuthStart", () => {
  it("ссылка на окно сервиса", () => {
    expect(parseOAuthStart({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" })).toEqual({
      ok: true,
      url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    });
  });

  it("код устройства", () => {
    expect(
      parseOAuthStart({ device: { user_code: "a5432s7h", verification_url: "https://ya.ru/device", expires_in: 297 } }),
    ).toEqual({ ok: true, device: { userCode: "a5432s7h", verificationUrl: "https://ya.ru/device", expiresIn: 297 } });
  });

  it("пустой ответ — ошибка, а не пустое окно", () => {
    expect(parseOAuthStart({}).ok).toBe(false);
    expect(parseOAuthStart({ device: { user_code: "" } }).ok).toBe(false);
  });
});
