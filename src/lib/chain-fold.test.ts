import { describe, expect, it } from "vitest";

import { foldParts } from "@/lib/chain-fold";
import type { MessagePart } from "@/lib/chat-streams";

const tool = (name: string): MessagePart => ({
  type: "chain",
  steps: [{ kind: "tool", id: `c_${name}`, name, args: {}, state: "available" }],
});
const text = (t: string): MessagePart => ({ type: "text", text: t });

describe("foldParts", () => {
  it("текст между тулами уходит заметкой в ОДНУ цепочку, финальный ответ остаётся снаружи", () => {
    const parts = [tool("bash"), text("Проверю файл."), tool("read_file"), text("Готово: всё на месте.")];
    const out = foldParts(parts);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("chain");
    expect(out[0].type === "chain" && out[0].steps.map((s) => s.kind)).toEqual(["tool", "note", "tool"]);
    expect(out[0].type === "chain" && out[0].steps[1]).toEqual({ kind: "note", text: "Проверю файл." });
    expect(out[1]).toEqual(text("Готово: всё на месте."));
  });

  it("десять тул по одной в блоке — одна цепочка из десяти тул", () => {
    const parts: MessagePart[] = [];
    // Как склеивает стор: между тулами — только перевод строки, после
    // последней — он же плюс ответ (соседние тексты в сторе слиты в один).
    for (let i = 0; i < 9; i++) parts.push(tool(`t${i}`), text("\n"));
    parts.push(tool("t9"), text("\nИтог."));
    const out = foldParts(parts);
    // Пустой промежуточный текст (перевод строки) не становится заметкой.
    expect(out).toHaveLength(2);
    expect(out[0].type === "chain" && out[0].steps.filter((s) => s.kind === "tool")).toHaveLength(10);
    expect(out[0].type === "chain" && out[0].steps.some((s) => s.kind === "note")).toBe(false);
  });

  it("текст ПЕРЕД первой тулой — тоже заметка внутри цепочки", () => {
    const out = foldParts([text("Сейчас посмотрю."), tool("bash"), text("Ответ.")]);
    expect(out).toHaveLength(2);
    expect(out[0].type === "chain" && out[0].steps.map((s) => s.kind)).toEqual(["note", "tool"]);
  });

  it("обычный ход (цепочка + ответ) возвращается тем же массивом — мемоизация цела", () => {
    const parts = [tool("bash"), text("Ответ.")];
    expect(foldParts(parts)).toBe(parts);
  });

  it("ответ без тул не трогается", () => {
    const parts = [text("Просто ответ.")];
    expect(foldParts(parts)).toBe(parts);
  });

  it("соседние цепочки без текста между ними сливаются", () => {
    const out = foldParts([tool("a"), tool("b")]);
    expect(out).toHaveLength(1);
    expect(out[0].type === "chain" && out[0].steps).toHaveLength(2);
  });

  it("рассуждение и тулы сохраняют порядок при слиянии", () => {
    const reasoning: MessagePart = { type: "chain", steps: [{ kind: "reasoning", text: "думаю" }] };
    const out = foldParts([reasoning, text("Проверю."), tool("bash"), text("Ответ.")]);
    expect(out[0].type === "chain" && out[0].steps.map((s) => s.kind)).toEqual(["reasoning", "note", "tool"]);
  });
});
