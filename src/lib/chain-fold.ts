/**
 * Склейка частей ответа для отрисовки: ОДНА цепочка работы на ход.
 *
 * Модели контура (и не только) между вызовами тул пишут короткий текст:
 * «Проверю файл…», «Теперь запущу…». В сырых частях он лежит текстом МЕЖДУ
 * цепочками, и лента понимала его как начало ответа: цепочка сворачивалась,
 * следующая тула открывала новую — по одной туле на блок, десять блоков за ход.
 *
 * Здесь любой текст, за которым ещё идёт цепочка, считается ПРОМЕЖУТОЧНЫМ:
 * он уходит внутрь цепочки заметкой (шаг kind="note"), а соседние цепочки
 * сливаются. Наружу остаётся только текст после последней цепочки — финальный
 * ответ. Пустой промежуточный текст (переводы строк) отбрасывается.
 *
 * Чистая функция над частями: применяется и к стриму, и к истории, данные в
 * сторе не меняет. Без изменений возвращает ТОТ ЖЕ массив — мемоизация ленты
 * не ломается.
 */

import type { MessagePart, ThoughtStep } from "@/lib/chat-streams";

type ChainPart = Extract<MessagePart, { type: "chain" }>;

export function foldParts(parts: MessagePart[]): MessagePart[] {
  // Нечего сливать: цепочек меньше двух и нет текста перед цепочкой.
  let chains = 0;
  let needs = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === "chain") {
      chains += 1;
      if (i > 0 && parts[i - 1].type === "text") needs = true;
    }
  }
  if (chains < 2 && !needs) return parts;

  const out: MessagePart[] = [];
  for (const p of parts) {
    if (p.type !== "chain") {
      out.push(p);
      continue;
    }
    const pending: ThoughtStep[] = [];
    // Текст перед цепочкой — промежуточный: заметкой в цепочку.
    const last = out[out.length - 1];
    if (last && last.type === "text") {
      out.pop();
      if (last.text.trim()) pending.push({ kind: "note", text: last.text });
    }
    const prev = out[out.length - 1];
    if (prev && prev.type === "chain") {
      // Сливаем с предыдущей цепочкой.
      const merged: ChainPart = { ...prev, steps: [...prev.steps, ...pending, ...p.steps] };
      out[out.length - 1] = merged;
    } else {
      out.push(pending.length ? { ...p, steps: [...pending, ...p.steps] } : p);
    }
  }
  return out;
}
