"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Иконка кнопки: любой компонент с className (lucide-иконки и наш BotIcon). */
type IconComponent = React.ComponentType<{ className?: string }>;

/**
 * Кнопка-действие в хедере: иконка, которая при наведении плавно раздвигается
 * вправо и показывает подпись прямо в строке (паттерн «expanding pill», как у
 * кнопки «Глубокое исследование» в инпуте). Подпись — это и подсказка названия,
 * без всплывающего тултипа.
 *
 * Раскрытие управляется НАСТОЯЩИМ CSS `:hover`/`:focus-visible`, а не JS-флагом.
 * Это важно: motion-обёртки onHoverStart/End и onFocus «залипали» в раскрытом
 * виде при потере фокуса окна (ушёл из браузера → вернулся → кнопка раскрыта,
 * хотя курсора над ней нет) и после клика (focus оставался на кнопке). Браузер
 * корректно сбрасывает :hover при потере фокуса окна, а :focus-visible не
 * срабатывает от клика мышью — поэтому залипания нет.
 *
 * Ширина зависит от измеренной ширины подписи, поэтому раскрытую ширину отдаём
 * в CSS-переменную, а :hover/:focus-visible лишь переключают на неё (анимация —
 * обычным CSS-transition).
 */
export function HeaderAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  shimmer,
}: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Оранжевый «бегущий» акцент на иконке (идёт работа) — как chain of thought. */
  shimmer?: boolean;
}) {
  const labelRef = React.useRef<HTMLSpanElement>(null);
  const [labelWidth, setLabelWidth] = React.useState(0);

  // Меряем ширину подписи (и при её смене), чтобы раздвигать ровно по контенту.
  React.useEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLabelWidth(el.scrollWidth));
    ro.observe(el);
    setLabelWidth(el.scrollWidth);
    return () => ro.disconnect();
  }, [label]);

  // Геометрия: иконка прижата влево (PAD), текст за ней с зазором GAP (его несёт
  // padding самой подписи, поэтому в expanded отдельно не прибавляем).
  const ICON = 16; // px — глиф size-4
  const PAD = 8; // px — левый отступ иконки и правый отступ
  const GAP = 6; // px — зазор иконка↔текст
  const collapsed = PAD + ICON + PAD;
  const expanded = PAD + ICON + labelWidth + PAD;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={
        {
          paddingLeft: PAD,
          // Обе ширины — в переменных; саму width задаём КЛАССАМИ (база + hover),
          // а НЕ инлайном: инлайн-width имел бы бОльшую специфичность и перебивал
          // бы hover:w-[...] (кнопка не раскрывалась). class-vs-class → hover берёт верх.
          "--ha-collapsed": `${collapsed}px`,
          "--ha-w": `${expanded}px`,
        } as React.CSSProperties
      }
      className={cn(
        "group/ha relative flex h-8 shrink-0 items-center overflow-hidden rounded-md text-muted-foreground outline-none",
        "w-[var(--ha-collapsed)] transition-[width,background-color,color] duration-200 ease-out",
        "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        "hover:w-[var(--ha-w)] focus-visible:w-[var(--ha-w)]",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {/* Иконка прижата влево (PAD) — не «едет» при раскрытии. shimmer: пока
          идёт работа — оранжевый «дышащий» акцент (как chain of thought). */}
      <Icon
        className={cn(
          "size-4 shrink-0",
          shimmer && "animate-pulse text-primary",
        )}
      />
      {/* Подпись: в потоке (для измерения), обрезается overflow'ом в свёрнутом
          виде, проявляется по hover/focus-visible вместе с шириной. */}
      <span
        ref={labelRef}
        style={{ paddingLeft: GAP }}
        className={cn(
          "whitespace-nowrap text-sm font-medium opacity-0 transition-opacity duration-150",
          "group-hover/ha:opacity-100 group-focus-visible/ha:opacity-100",
        )}
      >
        {label}
      </span>
    </button>
  );
}
