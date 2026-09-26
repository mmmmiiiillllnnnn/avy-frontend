import { describe, expect, it } from "vitest";

import { mergeChainRuns, taskStatus, type TaskStep } from "@/lib/task-card";

const step = (over: Partial<TaskStep>): TaskStep => ({
  kind: "tool",
  id: "call_1",
  name: "task",
  args: { description: "сделай", subagent_type: "general-purpose" },
  state: "available",
  ...over,
});

describe("taskStatus", () => {
  it("фоновый запуск без статуса агента — «работает», даже если тула уже вернула успех", () => {
    // Порядок кадров: tool_result («запущен в фоне») приходит раньше
    // subagent_started с background. По result это читалось как «готово».
    const s = step({
      args: { description: "сделай", background: true },
      result: { output: "[agent_id: a1] Started in the background", ok: true, truncated: false },
    });
    expect(taskStatus(s, false)).toBe("running");
    expect(taskStatus(s, true)).toBe("running");
  });

  it("статус фонового агента главнее всего остального", () => {
    const base = { args: { description: "x", background: true }, result: { output: "", ok: true, truncated: false } };
    expect(taskStatus(step({ ...base, background: { agent_id: "a1", status: "running", subagent_type: null, title: null } }), false)).toBe("running");
    expect(taskStatus(step({ ...base, background: { agent_id: "a1", status: "done", subagent_type: null, title: null } }), true)).toBe("done");
    expect(taskStatus(step({ ...base, background: { agent_id: "a1", status: "cancelled", subagent_type: null, title: null } }), true)).toBe("cancelled");
  });

  it("синхронный вызов: по результату, а без него — по ходу", () => {
    expect(taskStatus(step({ result: { output: "ok", ok: true, truncated: false } }), true)).toBe("done");
    expect(taskStatus(step({ result: { output: "boom", ok: false, truncated: false } }), true)).toBe("error");
    expect(taskStatus(step({}), true)).toBe("running");
    expect(taskStatus(step({}), false)).toBe("done");
  });
});

describe("mergeChainRuns", () => {
  it("склеивает ленты беседы без дублей, соседние цепочки — в одну, тексты — отдельно", () => {
    const first = step({
      id: "call_1",
      subagent: {
        parts: [
          { type: "chain", steps: [{ kind: "reasoning", text: "план" }, { kind: "tool", id: "c1", name: "bash", args: {} }] },
          { type: "text", text: "Вопрос: какой формат?" },
        ],
      },
    });
    const second = step({
      id: "call_2",
      args: { description: "16:9", agent_id: "call_1" },
      subagent: {
        parts: [
          // История несёт ту же полную ленту — дубли отбрасываются.
          { type: "chain", steps: [{ kind: "reasoning", text: "план" }, { kind: "tool", id: "c1", name: "bash", args: {} }] },
          { type: "text", text: "Вопрос: какой формат?" },
          { type: "chain", steps: [{ kind: "tool", id: "c2", name: "write_file", args: {} }] },
          { type: "text", text: "Готово." },
        ],
      },
    });
    const run = mergeChainRuns([first, second]);
    expect(run?.parts).toEqual([
      { type: "chain", steps: [{ kind: "reasoning", text: "план" }, { kind: "tool", id: "c1", name: "bash", args: {} }] },
      { type: "text", text: "Вопрос: какой формат?" },
      { type: "chain", steps: [{ kind: "tool", id: "c2", name: "write_file", args: {} }] },
      { type: "text", text: "Готово." },
    ]);
  });
});
