/**
 * Канал подтверждения необратимых действий: кадр -> очередь -> решение.
 *
 * Почему это стоит тестов. Отказ здесь тихий и дорогой в обе стороны:
 *   - потеряли кадр — ход встал в interrupt навсегда, человек видит «печатает…»
 *     и не может ни ответить, ни отменить;
 *   - потеряли description — карточка покажет сырой JSON, и человек подтвердит
 *     отправку письма, не видя, кому оно уйдёт.
 *
 * Проверяем стор, а не разметку: в разметке ошибка видна глазом, в сторе — нет.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  attachSubagent: () => { throw new Error("не ожидалось"); },
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

import { handlePermissionRequest } from "@/lib/chat-permissions";
import type { PendingPermission } from "@/lib/chat-streams";

/** Минимальный стор-двойник: нам нужны только очередь и запись состояния. */
function makeDeps() {
  const state: { pendingPermissions: PendingPermission[] } = { pendingPermissions: [] };
  return {
    deps: {
      rec: () => ({ state }),
      setState: (_t: string, patch: { pendingPermissions: PendingPermission[] }) => {
        state.pendingPermissions = patch.pendingPermissions;
      },
      beginRun: () => new AbortController(),
      runTurn: async () => {},
      resumeBubble: () => "id",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    state,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("подтверждение необратимого действия", () => {
  it("кадр попадает в очередь вместе с готовым текстом", () => {
    const { deps, state } = makeDeps();
    handlePermissionRequest(deps, "t1", {
      interrupt_id: "i-1",
      tool: "send_email",
      args: { to: ["ivanov@bank.local"], subject: "Отчёт" },
      description: "Кому: ivanov@bank.local\nТема: Отчёт",
    });
    expect(state.pendingPermissions).toHaveLength(1);
    const p = state.pendingPermissions[0];
    expect(p.tool).toBe("send_email");
    expect(p.interruptId).toBe("i-1");
    // Готовый текст — то, что увидит человек. Его потеря = подтверждение вслепую.
    expect(p.description).toContain("ivanov@bank.local");
    expect(p.description).toContain("Отчёт");
  });

  it("без description очередь всё равно наполняется (карточка покажет args)", () => {
    const { deps, state } = makeDeps();
    handlePermissionRequest(deps, "t1", {
      tool: "delete_permanently",
      args: { uids: [1, 2] },
    });
    expect(state.pendingPermissions).toHaveLength(1);
    // Пустая строка, а не undefined: карточка сравнивает с пустым и уходит на
    // запасной вывод аргументов.
    expect(state.pendingPermissions[0].description).toBe("");
    expect(state.pendingPermissions[0].interruptId).toBeNull();
  });

  it("несколько подтверждений за ход — очередь по порядку", () => {
    const { deps, state } = makeDeps();
    handlePermissionRequest(deps, "t1", {
      tool: "send_email", args: {}, description: "первое",
    });
    handlePermissionRequest(deps, "t1", {
      tool: "manage_calendar_event", args: {}, description: "второе",
    });
    // Порядок важен: карточка показывает первую и пишет «1 из 2».
    expect(state.pendingPermissions.map((p) => p.description)).toEqual([
      "первое",
      "второе",
    ]);
  });

  it("имя тулы не разбирается и не подменяется — карточка универсальна", () => {
    // Регрессия на главную ошибку прежней карточки: она знала про write_file,
    // bash и edit_file, и любая новая тула требовала правки фронта.
    const { deps, state } = makeDeps();
    handlePermissionRequest(deps, "t1", {
      tool: "какая_угодно_новая_тула",
      args: { что: "угодно" },
      description: "текст от автора тулы",
    });
    expect(state.pendingPermissions[0].tool).toBe("какая_угодно_новая_тула");
    expect(state.pendingPermissions[0].description).toBe("текст от автора тулы");
  });
});
