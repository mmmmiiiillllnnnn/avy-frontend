"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Один узел таймлайна раскрытых рассуждений: иконка в кружке, сплошная линия
 * вниз к следующему узлу, справа — заголовок и содержимое шага.
 *
 * Отличие от прежнего ChainOfThoughtStep: линия рисуется ТОЛЬКО между узлами
 * (у последнего её нет), а кружок с фоном отделяет шаг от текста — так лента
 * читается как последовательность, а не как список абзацев.
 */
/**
 * Вид узла:
 * - `active`   — шаг идёт прямо сейчас (акцентный);
 * - `complete` — шаг закончен, статуса нет (нейтральный: рассуждения, история);
 * - `done`     — тул отработал успешно (зелёный);
 * - `failed`   — тул завершился ошибкой (красный).
 *
 * Цветом помечаем именно УЗЕЛ, а не текст: в длинной ленте кружки читаются как
 * колонка статусов, и неудачный шаг видно, не вчитываясь в заголовки.
 */
export type TimelineNodeStatus = "active" | "complete" | "done" | "failed";

const NODE_STYLES: Record<TimelineNodeStatus, string> = {
  active: "border-primary/40 bg-primary/10 text-primary",
  complete: "border-border bg-muted text-muted-foreground",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

export const TimelineNode = memo(function TimelineNode({
  icon: Icon,
  status = "complete",
  label,
  last = false,
  hideIcon = false,
  children,
}: {
  icon: LucideIcon;
  status?: TimelineNodeStatus;
  label: React.ReactNode;
  /** Последний узел — линию вниз не рисуем. */
  last?: boolean;
  hideIcon?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="fade-in-0 slide-in-from-top-1 animate-in relative flex gap-3 text-sm">
      {/* Колонка тянется на всю высоту шага (self-stretch): без этого линия,
          позиционированная от неё, не могла быть длиннее одной строки — у
          высокого шага её просто не было видно. */}
      {!hideIcon && (
        <div className="relative flex w-6 shrink-0 flex-col items-center self-stretch">
          <span
            className={cn(
              "z-10 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
              NODE_STYLES[status],
            )}
          >
            <Icon className="size-3.5" />
          </span>
          {/* Зазор с обеих сторон, чтобы линия не упиралась в кружки.
              Сверху: top-7 = 24px кружок + 4px. Снизу: bottom-0 не годится —
              колонка на self-stretch тянется вместе с отступом соседа (pb-4),
              и линия доходила до следующего узла вплотную. */}
          {!last && (
            <span className="absolute inset-x-0 top-7 bottom-1 mx-auto w-px bg-border" />
          )}
        </div>
      )}
      <div
        className={cn(
          "min-w-0 flex-1 space-y-2 overflow-hidden",
          last ? "pb-0" : "pb-4",
        )}
      >
        {/* leading-6 = высота кружка: ПЕРВАЯ строка заголовка встаёт ровно по
            его центру, а последующие идут обычным потоком. Через flex-центровку
            это не решается — она уводила бы вниз весь многострочный блок. */}
        <div
          className={cn(
            "leading-6",
            status === "active" ? "text-foreground" : undefined,
          )}
        >
          {label}
        </div>
        {children}
      </div>
    </div>
  );
});
