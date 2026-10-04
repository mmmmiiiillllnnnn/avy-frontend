/**
 * Продолжение хода после карточки подтверждения: решения уходят одним resume,
 * ТЕМ ЖЕ режимом, что у прерванного хода. Подтверждение просит и обычный чат
 * (инструменты коннекторов, `confirm:` у агента); с прошитым "avy-code" сервер
 * отклонял продолжение — тред чата в чужом режиме (409).
 */
import { describe, expect, it, vi } from "vitest";

const sent: unknown[] = [];

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  streamChat: (req: unknown) => {
    sent.push(req);
    return (async function* () {})();
  },
}));

import { resolvePermission, type StoreDeps } from "@/lib/chat-permissions";
import type { PendingPermission } from "@/lib/chat-streams";

const card = (tool: string): PendingPermission => ({
  interruptId: "i1",
  tool,
  args: {},
  description: "",
});

function makeDeps(
  mode: string | null | undefined,
  queue: PendingPermission[],
  agentId?: string | null,
) {
  const record = {
    state: { pendingPermissions: queue },
    codeRun: { modelId: "m", effort: "medium", mode, agentId },
    assistantId: null as string | null,
    ctrl: null as AbortController | null,
    pendingDecisions: [] as { type: "approve" | "reject"; comment?: string }[],
  };
  const bubbles: string[] = [];
  // Пузыри, с которыми стор начал цикл хода (beginRun), и число прогонов.
  const runs: string[] = [];
  const deps: StoreDeps = {
    rec: () => record,
    setState: (_t, patch) => {
      Object.assign(record.state, patch);
    },
    beginRun: (_t, assistantId) => {
      runs.push(assistantId);
      return new AbortController();
    },
    runTurn: async () => {},
    resumeBubble: (threadId) => {
      bubbles.push(threadId);
      return "bubble";
    },
  };
  return { deps, record, bubbles, runs };
}

describe("продолжение после подтверждения", () => {
  it("обычный чат продолжается обычным чатом, а не кодером", async () => {
    sent.length = 0;
    const { deps, bubbles, runs } = makeDeps(null, [card("mcp__gmail__send")]);
    await resolvePermission(deps, "t1", "approve");
    expect(sent).toHaveLength(1);
    const req = sent[0] as { mode: unknown; resume: unknown; message: string };
    expect(req.mode).toBeNull();
    expect(req.message).toBe("");
    expect(req.resume).toEqual([{ type: "approve" }]);
    // Пузырь-приёмник берётся через стор: после перечитывания истории он новый.
    expect(bubbles).toEqual(["t1"]);
    // Цикл хода начат именно с этим пузырём (флаг стрима и владение — в beginRun).
    expect(runs).toEqual(["bubble"]);
  });

  it("ход агента из библиотеки продолжается тем же агентом", async () => {
    sent.length = 0;
    const { deps } = makeDeps(null, [card("mcp__jira__delete_issue")], "agent-42");
    await resolvePermission(deps, "t1", "approve");
    expect((sent[0] as { agentId: unknown }).agentId).toBe("agent-42");
    // Ассистент без выбранного агента: поле пустое, сервер соберёт ассистента.
    sent.length = 0;
    const plain = makeDeps(null, [card("mcp__jira__delete_issue")]);
    await resolvePermission(plain.deps, "t1", "approve");
    expect((sent[0] as { agentId: unknown }).agentId).toBeUndefined();
  });

  it("очередь из двух карточек: resume уходит после последней, решения по порядку", async () => {
    sent.length = 0;
    const { deps, record } = makeDeps(undefined, [card("mcp__gmail__send"), card("mcp__gmail__trash")]);
    await resolvePermission(deps, "t1", "approve");
    expect(sent).toHaveLength(0);
    expect(record.state.pendingPermissions.map((p) => p.tool)).toEqual(["mcp__gmail__trash"]);
    await resolvePermission(deps, "t1", "reject", "не надо");
    expect(sent).toHaveLength(1);
    expect((sent[0] as { resume: unknown }).resume).toEqual([
      { type: "approve" },
      { type: "reject", comment: "не надо" },
    ]);
    expect(record.state.pendingPermissions).toEqual([]);
  });
});
