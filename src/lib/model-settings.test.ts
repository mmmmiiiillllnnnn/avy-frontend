import { describe, expect, it } from "vitest";

import type { ModelSettings } from "@/lib/api";
import { dashscopeView, isPlausibleKey } from "@/lib/model-settings";

const base = (over: Partial<ModelSettings["dashscope"]>, provider: ModelSettings["provider"]) =>
  ({
    provider,
    dashscope: { key_set: false, key_hint: "", enabled: false, updated_at: null, ...over },
  }) satisfies ModelSettings;

describe("dashscopeView", () => {
  it("без ключа: тумблер выключен и недоступен, удалять нечего", () => {
    const v = dashscopeView(base({}, "contour"));
    expect(v).toMatchObject({ on: false, toggleEnabled: false, canDelete: false, status: "no_key", keyHint: "" });
  });

  it("ключ есть, выключено: тумблер доступен, ходы идут в контур", () => {
    const v = dashscopeView(base({ key_set: true, key_hint: "…a1b2", enabled: false }, "contour"));
    expect(v).toMatchObject({ on: false, toggleEnabled: true, canDelete: true, status: "off", keyHint: "…a1b2", provider: "contour" });
  });

  it("ключ есть, включено: идём в DashScope", () => {
    const v = dashscopeView(base({ key_set: true, key_hint: "…a1b2", enabled: true }, "dashscope"));
    expect(v).toMatchObject({ on: true, status: "on", provider: "dashscope" });
  });

  it("сервер не ответил — как без ключа, путь считаем контуром", () => {
    expect(dashscopeView(null)).toMatchObject({ status: "no_key", provider: "contour", on: false });
  });

  it("включено без ключа с сервера не бывает, но на клиенте это «выключено»", () => {
    expect(dashscopeView(base({ enabled: true }, "contour")).on).toBe(false);
  });
});

describe("isPlausibleKey", () => {
  it("принимает обычный ключ и режет пробелы по краям", () => {
    expect(isPlausibleKey("  sk-1234567890abcdef  ")).toBe(true);
  });
  it("отвергает пустое, короткое и с пробелом внутри", () => {
    expect(isPlausibleKey("")).toBe(false);
    expect(isPlausibleKey("sk-1")).toBe(false);
    expect(isPlausibleKey("sk-12345 67890")).toBe(false);
  });
});
