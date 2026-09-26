"use client";

import { Bot, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n/i18n-context";
import type { Dictionary } from "@/i18n/dictionary";

export type Mode = {
  id: string;
  /** Ключ в словаре sidebar — метка резолвится по текущей локали. */
  labelKey: keyof Dictionary["sidebar"];
  /** Ключ описания (подпись под названием в карточке). */
  descKey: keyof Dictionary["sidebar"];
  icon: LucideIcon;
  /** Режим ещё не сделан: показываем, но выбрать нельзя. */
  soon?: boolean;
};

// Режимы приложения. От выбранного режима зависит наполнение тела сайдбара
// (см. AppSidebar) И режим агента (см. ChatWorkspace -> useChat.mode).
// В локальной сборке режим один — ассистент (кодера здесь нет).
export const MODES: Mode[] = [
  { id: "ai-assistant", labelKey: "modeAssistant", descKey: "modeAssistantDesc", icon: Bot },
  // «Студия контента» временно убрана из списка. Показывать режим, которого
  // ещё нет, имеет смысл, когда он на подходе; пока он просто занимал строку
  // с подписью «скоро». Записи словаря (modeStudio/modeStudioDesc) и иконка
  // Clapperboard оставлены — вернуть её значит раскомментировать запись.
];

/**
 * Шапка сайдбара — марка продукта текстом: название текущего режима («Avy
 * Chat»), крупный wordmark без знака, без подложки, без приписки и без
 * выпадающего списка (решение владельца 26.09: «плашка и выпадашка не
 * нужны»). Режим здесь только ПОКАЗЫВАЕТСЯ — выбирать его негде и незачем.
 */
export function SidebarModes({ value }: { value: string }) {
  const t = useT();
  const current = MODES.find((m) => m.id === value) ?? MODES[0]!;
  // Делим по первому пробелу: марка жирным, второе слово светлым начертанием —
  // контраст веса вместо контраста цвета. Правило держится для любого режима и
  // локали. Шрифт — бренд-блока (--font-brand). Левый край текста — на 16px
  // от края панели, как иконки пунктов (8px контейнера шапки + px-2 здесь).
  const [first, ...rest] = t.sidebar[current.labelKey].split(" ");
  return (
    <div className="flex h-9 min-w-0 items-center px-2">
      <span className="min-w-0 truncate whitespace-nowrap font-[family-name:var(--font-brand)] text-[22px] leading-none tracking-[-0.02em] text-brand-ink">
        <span className="font-bold">{first}</span>
        {rest.length > 0 ? (
          <>
            {" "}
            <span className="font-light text-brand-ink/80">{rest.join(" ")}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
