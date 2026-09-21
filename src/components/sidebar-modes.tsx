"use client";

import * as React from "react";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import {
  Check,
  Bot,
  Code2,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";
import { useIsDesktop } from "@/hooks/use-is-desktop";
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
// avy-code — кодинг-режим: работа с локальными файлами через avy-host.
export const MODES: Mode[] = [
  { id: "ai-assistant", labelKey: "modeAssistant", descKey: "modeAssistantDesc", icon: Bot },
  { id: "avy-code", labelKey: "modeCode", descKey: "modeCodeDesc", icon: Code2 },
  // «Студия контента» временно убрана из списка. Показывать режим, которого
  // ещё нет, имеет смысл, когда он на подходе; пока он просто занимал строку
  // с подписью «скоро». Записи словаря (modeStudio/modeStudioDesc) и иконка
  // Clapperboard оставлены — вернуть её значит раскомментировать запись.
];

// Режимы, работающие только в десктоп-оболочке (через локальный avy-host,
// которого в браузере нет).
//
// РАНЬШЕ мы их просто ПРЯТАЛИ в web. Это скрывало от пользователя, что такой
// режим вообще существует: человек не знал, что стоит поставить приложение.
// Теперь показываем всегда, но в браузере блокируем с подписью «только в
// приложении» — отказ объяснённый, а не пустое место.
const DESKTOP_ONLY_MODES = new Set(["avy-code"]);

/**
 * Главный селектор режимов (вверху сайдбара). Триггер — название текущего
 * режима на постоянной подложке; по клику вниз выезжает список карточек с
 * названием и описанием каждого. Выбор поднимается наверх (onChange) — от него
 * зависит тело сайдбара. Выделение — в токенах сайдбара (primary/accent), не
 * «чёрное».
 */
export function SidebarModes({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const t = useT();
  const isDesktop = useIsDesktop();

  // Показываем ВСЕ режимы, недоступные — выключенными с объяснением. Причины
  // две и они разные: режим ещё не сделан (soon) либо требует десктоп-оболочки
  // (в браузере нет avy-host). На сервере/первом рендере isDesktop=false —
  // до гидрации avy-code будет выглядеть заблокированным, это безопаснее
  // обратного (мелькнуть доступным и отключиться).
  const modes = React.useMemo(
    () =>
      MODES.map((m) => ({
        ...m,
        locked: m.soon || (!isDesktop && DESKTOP_ONLY_MODES.has(m.id)),
        // Подпись отличается: «скоро» — про нас, «только в приложении» — про
        // то, что пользователь может сделать сам.
        lockNote: m.soon ? t.sidebar.soon : t.sidebar.desktopOnly,
      })),
    [isDesktop, t],
  );

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // Выбранный режим мог стать недоступным: avy-code остался в стейте с десктопа,
  // а открыли в браузере. Раньше от этого спасала фильтрация списка — теперь
  // режим показывается всегда, поэтому возвращаем на дефолтный явно, иначе
  // человек застрянет в неработающем режиме.
  const active = modes.find((m) => m.id === value);
  React.useEffect(() => {
    if (active?.locked) onChange(MODES[0].id);
  }, [active?.locked, onChange]);

  const current = (active && !active.locked ? active : modes[0])!;

  return (
    <MotionConfig reducedMotion="user">
      {/* БЕЗ px-2. Отступ до содержимого набирается ровно так же, как у пунктов
          меню ниже: 8px даёт контейнер (SidebarHeader p-2 — у пунктов это
          SidebarGroup p-2), ещё 8px — сама кнопка. Свой px-2 здесь добавлял
          третьи 8px, и логотип стоял на 24px против 16px у иконок пунктов —
          та самая несимметрия. */}
      {/* Логотип — СНАРУЖИ кнопки, отдельным соседом: он марка продукта, а не
          часть переключателя, и кликом по нему режим меняться не должен.
          Подложка поэтому лежит только под текстовым блоком.

          ВЫРАВНИВАНИЕ — ПО ЦЕНТРУ ИКОНОК, НЕ ПО КРАЮ БЛОКА. Иконка пункта
          16px стоит на оси 24px от края сайдбара (8px SidebarGroup + 8px
          кнопки + 8px половина иконки). Логотип 28px, половина 14 — его левый
          край идёт на 24-14 = 10px, то есть ml-0.5 (+2px) к 8px контейнера.
          Совпадение ЛЕВЫХ КРАЕВ разводило бы центры на 6px: знак крупнее
          иконки и висел бы правее их оси. Сдвиг именно ВПРАВО — влево знак
          вылезал за край панели.

          Высоту диктует текст (название + описание); логотип 28px в неё
          вписывается и не растит строку. */}
      <div ref={rootRef} className="relative flex items-center gap-2">
        {/* ЗАМЕРЕНО В БРАУЗЕРЕ, не выведено из классов. Иконка пункта меню
            стоит на 16px от края панели (8px SidebarGroup + 8px кнопки), а
            контейнер шапки даёт только свои 8px — отсюда ml-2 (+8px), и левые
            края совпадают. Знак 36px — ровно высота соседней плашки, чтобы
            не торчать за её верх и низ (замерено, не выведено из классов). */}
        <span className="ml-2 flex shrink-0 items-center">
          <Logo size={37.5} />
        </span>
        {/* Триггер: название и описание режима на ПОСТОЯННОЙ подложке.
            · Надписи «Avy Chat» рядом с логотипом больше нет — её место занял
              сам режим, он так и называется, и повторять то же слово дважды
              незачем.
            · Подложка не только на ховере, а всегда: она объявляет плашку
              отдельным уровнем — заголовком, а не первым пунктом списка, — и
              делает это без лишней разделительной линии. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            // ПОДЛОЖКА ПОСТОЯННАЯ, не на ховере: она объявляет плашку
            // отдельным уровнем — заголовком, а не первым пунктом списка, —
            // и делает это без рамки, то есть без лишней графики в шапке.
            // Ховер даёт заливку светлее, а не темнее: при постоянном фоне
            // обратная реакция читается лучше.
            // РАДИУС ПОДОБРАН ГЛАЗОМ ПОД ЛОГОТИП, а не взят токеном и не
            // посчитан. Плашка стоит со знаком вплотную, и одинаковая
            // скруглённость читается как одна деталь, разная — как две.
            //
            // Тут был rounded-lg с комментарием «общий токен --radius = 9px,
            // под логотип». Два расхождения с фактом, оба замерены в браузере:
            //   · rounded-lg даёт НЕ 9px, а 12px. Tailwind v4 кладёт свой
            //     дефолт --radius: .75rem в :root, и наше объявление
            //     0.609rem в том же :root его не перебивает.
            //   · 26% от стороны (9.75px — арифметика из rx=6.24 при
            //     viewBox 24) тоже не подходит: при равных числах плашка
            //     выглядит ОСТРЕЕ знака.
            //
            // Второе — не ошибка замера, а разные кривые. У знака это SVG rx,
            // то есть squircle: скругление начинается раньше и идёт плавнее.
            // CSS border-radius — дуга окружности, ей для той же мягкости
            // нужно примерно на 13% больше. Отсюда 11px: сравнивались 9.75 /
            // 11 / 12 на скриншоте в 4x, 11 совпадает со знаком.
            //
            // h-[37.5px] — высота логотипа. Текст в одну строку набирает
            // меньше, и без явной высоты плашка проседала до 30.7 против 37.5
            // у знака (замерено в браузере).
            "flex h-[37.5px] min-w-0 flex-1 items-center gap-2 rounded-[11px] bg-sidebar-accent px-2 text-left outline-none transition-colors",
            "hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          )}
        >
          {/* Название | описание — в одну строку, прижато влево.

              Название набрано СТИЛЕМ БРЕНД-БЛОКА (font-brand, text-base,
              semibold, brand-ink, второе слово приглушено) — тем же, каким
              рядом с логотипом стояла надпись «Avy Chat».

              Описанию отдана вся оставшаяся ширина: влезает — идёт строкой,
              не влезает — переносится по словам. min-w-0 обязателен, иначе
              flex не даёт тексту переноситься и плашка распирает сайдбар. */}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 whitespace-nowrap font-[family-name:var(--font-brand)] text-base font-semibold tracking-tight text-brand-ink">
              {(() => {
                // Марка основным цветом, второе слово приглушённым — как в
                // бренд-блоке («Avy» + «Chat»). Делим по первому пробелу,
                // поэтому правило держится для любого режима и локали.
                const [first, ...rest] = t.sidebar[current.labelKey].split(" ");
                return rest.length === 0 ? first : (
                  <>
                    {first} <span className="text-brand-ink/55">{rest.join(" ")}</span>
                  </>
                );
              })()}
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground/50">|</span>
            <span className="min-w-0 flex-1 text-[9px] leading-[1.15] text-muted-foreground">
              {t.sidebar[current.descKey]}
            </span>
          </span>
        </button>

        {/* Список карточек — вниз под триггером. */}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -4 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={{ transformOrigin: "top" }}
              // По всей ширине контейнера — вместе с колонкой логотипа: список
              // относится к шапке целиком, и обрезать его по кнопке значило бы
              // оставить слева пустую полосу.
              className="absolute inset-x-0 top-full z-50 mt-2 flex flex-col gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/8"
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            >
              {modes.map((mode) => {
                const selected = mode.id === value;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    disabled={mode.locked}
                    title={mode.locked ? mode.lockNote : undefined}
                    onClick={() => {
                      onChange(mode.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-1.5 text-left outline-none transition-colors",
                      selected
                        ? "border-sidebar-border bg-sidebar-accent"
                        : "border-transparent hover:bg-sidebar-accent/60",
                      // Недоступный режим остаётся видимым и читаемым: он
                      // показывает, что такое есть. Гасим только интерактивность.
                      mode.locked && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <span className="grid flex-1 leading-tight">
                      <span className="truncate text-[13px] font-medium">
                        {t.sidebar[mode.labelKey]}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {t.sidebar[mode.descKey]}
                      </span>
                    </span>
                    {/* У недоступного — причина вместо галочки: «скоро» или
                        «только в приложении». Выбранным он быть не может. */}
                    {mode.locked ? (
                      <span className="shrink-0 text-[10px] whitespace-nowrap text-muted-foreground">
                        {mode.lockNote}
                      </span>
                    ) : (
                      selected && <Check className="size-3.5 shrink-0 text-sidebar-primary" />
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
