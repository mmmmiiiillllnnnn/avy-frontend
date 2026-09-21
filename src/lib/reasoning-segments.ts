/**
 * Расщепить reasoning-markdown на чередующиеся сегменты текста и код-блоков.
 *
 * Зачем: код в рассуждении показываем не портянкой, а свёрнутой пилюлей «Пишу
 * код» (CodingBlock). Для этого надо вытащить ```fenced``` блоки из текста,
 * оставив остальное обычным markdown.
 *
 * Стрим: последний fence может быть ещё НЕ закрыт (агент печатает код прямо
 * сейчас). Такой блок тоже считаем кодом и помечаем `closed: false` — по нему
 * UI понимает, что это «активный» код (на метке shimmer).
 */
export type ReasoningSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; markdown: string; closed: boolean };

// Строка-ограждение код-блока: ``` или ~~~ (опц. с языком), с отступом до 3 пробелов.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

export function splitReasoning(input: string): ReasoningSegment[] {
  if (!input) return [];
  const lines = input.split("\n");
  const segments: ReasoningSegment[] = [];

  let textBuf: string[] = [];
  let codeBuf: string[] = [];
  let fence: string | null = null; // активное ограждение (``` или ~~~), если внутри кода

  const flushText = () => {
    if (textBuf.length) {
      const text = textBuf.join("\n");
      if (text.trim()) segments.push({ kind: "text", text });
      textBuf = [];
    }
  };

  for (const line of lines) {
    const m = line.match(FENCE_RE);
    if (fence === null) {
      // Вне кода. Открывающее ограждение начинает код-блок.
      if (m) {
        flushText();
        fence = m[1];
        codeBuf = [line];
      } else {
        textBuf.push(line);
      }
      continue;
    }
    // Внутри кода. Закрывающее ограждение — та же последовательность (``` / ~~~)
    // не короче открывшей и без языка после неё.
    codeBuf.push(line);
    if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) {
      segments.push({ kind: "code", markdown: codeBuf.join("\n"), closed: true });
      fence = null;
      codeBuf = [];
    }
  }

  // Хвост: незакрытый код (идёт стрим) или остаток текста.
  if (fence !== null) {
    segments.push({ kind: "code", markdown: codeBuf.join("\n"), closed: false });
  } else {
    flushText();
  }
  return segments;
}
