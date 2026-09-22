import { beforeEach, describe, expect, it, vi } from "vitest";

const setTaskSecret = vi.fn();
const uploadTaskInputs = vi.fn();
vi.mock("@/lib/api", () => ({
  setTaskSecret: (...a: unknown[]) => setTaskSecret(...a),
  uploadTaskInputs: (...a: unknown[]) => uploadTaskInputs(...a),
}));

import { attachTaskExtras } from "./task-extras";

const file = (name: string) => ({ file: new File(["x"], name), relPath: name });

describe("attachTaskExtras", () => {
  beforeEach(() => {
    setTaskSecret.mockReset();
    uploadTaskInputs.mockReset();
  });

  it("does nothing for empty extras", async () => {
    const problems = await attachTaskExtras("t1", { secrets: [], files: [] });
    expect(problems).toEqual([]);
    expect(setTaskSecret).not.toHaveBeenCalled();
    expect(uploadTaskInputs).not.toHaveBeenCalled();
  });

  it("binds every secret and uploads files in one request", async () => {
    setTaskSecret.mockResolvedValue(undefined);
    uploadTaskInputs.mockResolvedValue({ files: [], errors: [] });
    const problems = await attachTaskExtras("t1", {
      secrets: [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ],
      files: [file("a.txt"), file("b.txt")],
    });
    expect(problems).toEqual([]);
    expect(setTaskSecret).toHaveBeenCalledTimes(2);
    expect(setTaskSecret).toHaveBeenCalledWith("t1", "A", "1");
    expect(uploadTaskInputs).toHaveBeenCalledTimes(1);
    expect(uploadTaskInputs.mock.calls[0][1]).toHaveLength(2);
  });

  it("one failed secret does not stop the rest, and is reported by name", async () => {
    setTaskSecret
      .mockRejectedValueOnce(new Error("503 no key"))
      .mockResolvedValueOnce(undefined);
    uploadTaskInputs.mockResolvedValue({ files: [], errors: [{ name: "big.bin", error: "too large" }] });
    const problems = await attachTaskExtras("t1", {
      secrets: [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ],
      files: [file("big.bin")],
    });
    expect(setTaskSecret).toHaveBeenCalledTimes(2);
    expect(problems).toEqual(["A: 503 no key", "big.bin: too large"]);
  });

  it("reports an upload request failure with the file names", async () => {
    uploadTaskInputs.mockRejectedValue(new Error("network"));
    const problems = await attachTaskExtras("t1", {
      secrets: [],
      files: [file("a.txt"), file("dir/b.txt")],
    });
    expect(problems).toEqual(["a.txt, dir/b.txt: network"]);
  });
});
