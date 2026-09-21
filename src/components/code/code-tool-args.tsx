"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** Треугольник нашего логотипа (path как в ui/logo). currentColor — под тему. */
function TriangleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 15.5l-5-5h10z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
 * Аргументы вызова тула в свёрнутой карточке (рамка как у блока веб-поиска).
 * Свёрнутая шапка компактная (по содержимому): только треугольник нашего
 * логотипа; пока аргументы стримятся (streaming) — он крутится по часовой. По
 * клику карточка раскрывается ВО ВСЮ ШИРИНУ списком «ключ: значение».
 */
export function ToolArgs({
  args,
  streaming = false,
}: {
  args: Record<string, unknown>;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(args ?? {}).filter(
    ([, v]) => fmtValue(v).length > 0,
  );
  // Показываем окошко СРАЗУ при стриминге (даже если args ещё пустые) — чтобы
  // крутящийся треугольник был виден с самого начала вызова. Без стрима и без
  // аргументов рендерить нечего.
  if (entries.length === 0 && !streaming) return null;
  const hasContent = entries.length > 0;

  return (
    // w-full на корне Collapsible: иначе обёртка сжимается под свёрнутый w-fit,
    // и при раскрытии w-full ребёнка считается от сжатой обёртки, а не от
    // flex-1 родителя — блок раскрывался не на всю ширину.
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 w-full">
      {/* Свёрнуто — по содержимому (w-fit); раскрыто — на всю ширину. */}
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-background",
          open ? "w-full" : "w-fit",
        )}
      >
        <CollapsibleTrigger
          // Раскрываем, только если уже есть что показать. Пустой блок (стрим
          // начался, но ни одного аргумента ещё не пришло) раскрывать нечего;
          // как только что-то настримилось — клик открывает (стрим продолжится
          // внутри). entries наполняются монотонно, «мёртвых» кадров нет.
          disabled={!hasContent}
          className={cn(
            "flex items-center px-2.5 py-2 text-muted-foreground transition-colors",
            hasContent ? "hover:text-foreground" : "cursor-default",
          )}
        >
          <TriangleMark
            className={cn("size-[18px] shrink-0", streaming && "animate-spin")}
          />
        </CollapsibleTrigger>
        {hasContent && (
          <CollapsibleContent>
            <div className="space-y-1.5 border-t border-border/60 px-2.5 py-2">
              {entries.map(([key, value]) => (
                <div key={key} className="space-y-0.5">
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {key}
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                    {fmtValue(value)}
                  </pre>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}
