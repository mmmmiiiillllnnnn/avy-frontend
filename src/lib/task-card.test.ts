import { describe, expect, it } from "vitest";

import { taskStatus, type TaskStep } from "@/lib/task-card";

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
