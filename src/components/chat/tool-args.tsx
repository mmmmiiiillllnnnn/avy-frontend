"use client";

/** Значение аргумента в строку: длинный текст — как есть, объекты — JSON. */
function fmtValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Аргументы вызова тула — мягкая плашка под шагом.
 *
 * Своего триггера у блока НЕТ: раскрывает его клик по названию тула (см.
 * StepRow в tool-steps.tsx), поэтому здесь только содержимое. Раньше это была
 * карточка с рамкой и крутящимся треугольником — она занимала полосу во всю
 * ширину и не объясняла, что за ней.
 */
export function ToolArgs({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args ?? {}).filter(
    ([, v]) => fmtValue(v).length > 0,
  );
  if (entries.length === 0) return null;

  return (
    <div className="fade-in-0 slide-in-from-top-1 animate-in mt-1.5 space-y-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/50">
            {key}
          </div>
          {/* Обычный шрифт интерфейса: аргументы — это текст (запрос, путь,
              описание), а не код; моноширинный выглядел чужеродно. */}
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">
            {fmtValue(value)}
          </div>
        </div>
      ))}
    </div>
  );
}
