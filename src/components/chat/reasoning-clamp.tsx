"use client";

import { useEffect, useState } from "react";

/**
 * Сырой текст рассуждения в «приоткрытом» виде: РОВНО ДВЕ СТРОКИ, дальше не
 * видно ничего и НЕ раскрывается — решение продукта: сырой поток целиком в UI
 * не показываем никогда. Когда блок завершается, его место занимает
 * фраза-сжатие (reasoning_summary), и этот компонент больше не рендерится.
 *
 * Переносы строк модели (в т.ч. пустые строки — «2 строки + щель») схлопнуты
 * в пробелы: показываем непрерывный поток текста, а не его вёрстку.
 *
 * Геометрия жёсткая: leading-[22px] (не leading-relaxed — его 22.75px за две
 * строки накапливают дробь), высота 44px = ровно две строки, третья отсечена
 * начисто. Маска мягко гасит самый низ второй строки (34->44px), чтобы срез
 * не выглядел ножом при любых выносных элементах букв.
 */
export function ClampedReasoning({ text }: { text: string }) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return (
    <p className="h-[44px] overflow-hidden break-words text-sm leading-[22px] text-muted-foreground [mask-image:linear-gradient(to_bottom,black_34px,transparent_44px)]">
      {flat}
    </p>
  );
}

/** Длительность перехода «сырой текст -> фраза» (мс). */
const SWAP_MS = 400;

/**
 * Замена сырого текста рассуждения фразой-сжатием.
 *
 * animate=true (раскрытая лента): когда фраза ПРИХОДИТ на глазах у человека,
 * она выезжает слева, а старый текст растворяется на месте. animate=false
 * (свёрнутое live-окно) — мгновенная замена: там лента и так в движении.
 *
 * Анимируется только ЖИВОЙ переход: если компонент смонтирован уже с фразой
 * (история, повторное раскрытие блока) — сразу статичная фраза, ничего не
 * проигрывается.
 */
export function ReasoningSummarySwap({
  text,
  summary,
  animate = false,
}: {
  text: string;
  summary?: string;
  animate?: boolean;
}) {
  // Фиксируем на маунте, была ли фраза уже тогда: useState-инициализатор, а
  // не ref — ref в рендере читать нельзя (react-hooks/refs).
  const [hadSummaryAtMount] = useState(() => summary != null);
  const [settled, setSettled] = useState(hadSummaryAtMount);

  // Таймер завершения перехода. setState здесь асинхронный (из setTimeout),
  // каскадного рендера нет — правило set-state-in-effect не нарушено.
  useEffect(() => {
    if (!summary || settled) return;
    const id = setTimeout(() => setSettled(true), SWAP_MS);
    return () => clearTimeout(id);
  }, [summary, settled]);

  if (!summary) return <ClampedReasoning text={text} />;

  const phrase = (
    <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
  );
  if (settled || !animate || !text) return phrase;

  // Переход: старый текст гаснет на месте, фраза выезжает слева ПОВЕРХ него
  // (absolute — чтобы обе не занимали высоту разом). Высота схлопнется по
  // завершении, когда старый текст уже невидим.
  return (
    <div className="relative overflow-hidden">
      <div
        className="fade-out animate-out pointer-events-none"
        style={{ animationDuration: `${SWAP_MS}ms`, animationFillMode: "forwards" }}
      >
        <ClampedReasoning text={text} />
      </div>
      <p
        className="fade-in slide-in-from-left-4 animate-in absolute inset-x-0 top-0 text-sm leading-relaxed text-muted-foreground"
        style={{ animationDuration: `${SWAP_MS}ms`, animationFillMode: "backwards" }}
      >
        {summary}
      </p>
    </div>
  );
}
