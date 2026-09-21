"use client";

import { useT } from "@/i18n/i18n-context";
import { cn } from "@/lib/utils";

type Option = { label?: string; description?: string | null };
type Question = {
  question?: string;
  header?: string;
  options?: Option[];
  multiSelect?: boolean | null;
};

/**
 * Шаг ask_user в раскрытой ленте (главной и субагента): вопросы с вариантами
 * чипами и, когда есть, ответ — вместо сырого JSON аргументов. Это НЕ
 * карточка для ответа (та живёт в question-card.tsx), а запись о том, что
 * было спрошено и что ответили.
 */
export function AskUserStep({
  args,
  answer,
}: {
  args: Record<string, unknown>;
  /** Результат тулы — ответ (человека или оркестратора) текстом. */
  answer?: string | null;
}) {
  const t = useT();
  const questions = (Array.isArray(args?.questions) ? args.questions : []) as Question[];
  if (questions.length === 0 && !answer) return null;
  return (
    <div className="fade-in-0 slide-in-from-top-1 animate-in mt-1.5 space-y-2.5 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
      {questions.map((q, i) => (
        <div key={i} className="min-w-0">
          {q.header ? (
            <div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/60">
              {q.header}
            </div>
          ) : null}
          <div className="break-words text-foreground/90">{q.question}</div>
          {q.options?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {q.options.map((o, j) => (
                <span
                  key={j}
                  title={o.description ?? undefined}
                  className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {o.label}
                </span>
              ))}
              {q.multiSelect ? (
                <span className="self-center text-[11px] text-muted-foreground/60">
                  {t.chat.askUserStep.multi}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {answer ? (
        <div className={cn("whitespace-pre-wrap break-words", questions.length > 0 && "border-t border-border/60 pt-2")}>
          <span className="text-muted-foreground">{t.chat.askUserStep.answer}: </span>
          <span className="text-foreground">{answer}</span>
        </div>
      ) : null}
    </div>
  );
}
