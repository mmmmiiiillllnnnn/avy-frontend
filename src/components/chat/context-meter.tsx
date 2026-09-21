"use client";

import { Loader2 } from "lucide-react";
import { useT } from "@/i18n/i18n-context";

const RADIUS = 9;
const CENTER = 12;
const STROKE = 2.5;
const CIRC = 2 * Math.PI * RADIUS;

type ContextMeterProps = {
  usedTokens: number;
  maxTokens: number;
  compacting?: boolean;
  onCompact?: () => void;
};

/**
 * Компактный индикатор заполненности контекста для капсулы инпута: кольцо + %.
 * Клик запускает ручное сжатие контекста (то же, что авто-сжатие на пороге, но
 * сейчас). Детальную стоимость намеренно не показываем — только процент.
 *
 * Цвет кольца мягко предупреждает по мере заполнения: обычный → warning → ближе
 * к пределу. История в ленте при сжатии не меняется — падает только процент.
 */
export function ContextMeter({
  usedTokens,
  maxTokens,
  compacting = false,
  onCompact,
}: ContextMeterProps) {
  const t = useT();
  const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
  const pct = Math.round(fraction * 100);
  const dashOffset = CIRC * (1 - fraction);

  // Цвет по заполненности: <70% приглушённый, 70–90% янтарный, >90% красный.
  const ringColor =
    fraction > 0.9
      ? "var(--destructive)"
      : fraction > 0.7
        ? "#d97706" // amber-600
        : "currentColor";

  return (
    <button
      type="button"
      title={t.chat.contextTitle(pct)}
      aria-label={t.chat.contextAria(pct)}
      disabled={compacting}
      onClick={(e) => {
        e.stopPropagation();
        onCompact?.();
      }}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
    >
      {compacting ? (
        <>
          <Loader2 className="size-[18px] animate-spin" />
          <span className="text-xs font-medium whitespace-nowrap">Сжимаю…</span>
        </>
      ) : (
        <svg
          aria-hidden
          height="18"
          width="18"
          viewBox="0 0 24 24"
          style={{ color: ringColor }}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            opacity="0.2"
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={dashOffset}
            style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
          />
        </svg>
      )}
      {!compacting && <span className="text-xs font-medium tabular-nums">{pct}%</span>}
    </button>
  );
}
