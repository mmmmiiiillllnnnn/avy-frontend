"use client";

import * as React from "react";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import {
  Settings,
  LogOut,
  Moon,
  Sun,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { SidebarFooter } from "@/components/ui/sidebar";
import { useAuth } from "@/components/auth/auth-provider";
import { SettingsDialog } from "@/components/settings-dialog";
import { useLocale, useT } from "@/i18n/i18n-context";
import type { Locale } from "@/lib/locale";

type MenuEntry = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect?: () => void;
  /** Счётчик справа. 0 — не показываем. Сейчас ни один пункт его не ставит
   *  (обратная связь уехала в свою кнопку), но поле общее для пунктов меню. */
  badge?: number;
};

/** Инициалы для аватара: первые буквы имени (и фамилии, если есть). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Аватар с инициалами (без зависимости на radix-avatar).
 *
 *  ЗДЕСЬ ИМЕННО ИНИЦИАЛЫ, а не логотип: знак продукта стоит в шапке сайдбара,
 *  и второй такой же внизу был бы той же маркой дважды в одной колонке. Эта
 *  плашка отвечает на другой вопрос — под кем ты работаешь.
 *
 *  Заливка НЕЙТРАЛЬНАЯ, не бренд-цвет: рыжий кружок внизу перекликался с
 *  логотипом сверху, и взгляд читал два акцента в одной колонке как парные.
 *  Аватар — не марка, ему хватает тихого фона. */
function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        className ?? "size-7 text-[11px]",
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Тумблер темы (визуальный switch). `on` = тёмная активна. Ползунок ездит
 * влево/вправо, под ним проступает иконка целевого состояния (Sun слева —
 * светлая, Moon справа — тёмная). Сам по себе не кликабелен — клик ловит
 * родительская строка-кнопка (role="switch").
 */
function ThemeSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-input",
      )}
    >
      {/* Иконки-подсказки по краям трека. */}
      <Sun className="absolute left-1 size-3 text-primary-foreground/70" />
      <Moon className="absolute right-1 size-3 text-muted-foreground" />
      {/* Бегунок. */}
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className={cn(
          "z-10 size-4 rounded-full bg-background shadow-sm",
          on ? "ml-auto mr-0.5" : "ml-0.5",
        )}
      />
    </span>
  );
}

/**
 * Сегментированный переключатель языка RU/EN. Активный сегмент подсвечен
 * бренд-цветом; клик по сегменту ставит локаль (и не закрывает меню — событие
 * не всплывает до строки). Компактный, под стиль тумблера темы.
 */
function LangSwitch({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (l: Locale) => void;
}) {
  const opts: Locale[] = ["ru", "en"];
  return (
    <span className="relative inline-flex shrink-0 items-center rounded-full bg-input p-0.5 text-[11px] font-medium">
      {opts.map((opt) => {
        const active = locale === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(opt);
            }}
            className={cn(
              "relative z-10 rounded-full px-2 py-0.5 uppercase transition-colors",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="lang-switch-active"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="absolute inset-0 -z-10 rounded-full bg-primary"
              />
            )}
            {opt}
          </button>
        );
      })}
    </span>
  );
}

/**
 * Нижний блок сайдбара: плашка пользователя (аватар + имя и почта под ним) и
 * По клику на плашку вверх выезжает
 * меню: Настройки, Тема, Язык, Выход.
 *
 * Имя и почта стоят на самой плашке, а не в шапке меню, — видно, под каким
 * аккаунтом работаешь, не открывая его. Шеврона нет: кликабельность показывает
 * подсветка на ховере.
 */
export function SidebarUser() {
  const [open, setOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const t = useT();
  const { locale, setLocale } = useLocale();

  // Пользователь — из сессии (cookie). На защищённых страницах он всегда есть
  // (AuthGate не пускает без него), но на всякий случай даём дефолты.
  const { user, logout } = useAuth();

  // Пункты меню (метки из словаря).
  const MENU: MenuEntry[] = [
    {
      id: "settings",
      label: t.sidebar.settings,
      icon: Settings,
      onSelect: () => setSettingsOpen(true),
    },
    // Обратной связи здесь БОЛЬШЕ НЕТ — она стала отдельной кнопкой рядом с
    // плашкой: за ответом приходят тогда, когда он пришёл, и держать
    // единственный канал до нас за двумя кликами значит его прятать.
    // Пункт «Админка» убран: панель переехала в Avy Team (team.avylab.ru).
    // Оставлять кнопку значило бы вести админов в 404.
  ];
  const name = user?.name || t.sidebar.userFallback;
  const email = user?.email || "";

  // Тема: next-themes. resolvedTheme учитывает системную (auto). До монтирования
  // тема неизвестна (SSR) — показываем нейтрально, чтобы не было гидрационного
  // рассинхрона иконки.
  const { resolvedTheme, setTheme } = useTheme();
  // mounted-гард против гидрационного рассинхрона: на сервере тема неизвестна.
  // Ставим флаг в микротаске (не синхронно в теле эффекта — иначе каскадный
  // ре-рендер: react-hooks/set-state-in-effect).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  // Клик вне плашки/меню — закрыть.
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

  // border-t — нижняя граница скролл-зоны списка сессий (парная верхней в
  // SidebarSessions): список уезжает под неё, плашка пользователя — статика.
  return (
    <SidebarFooter className="border-t border-sidebar-border">
      <MotionConfig reducedMotion="user">
        <div ref={rootRef} className="relative">
          {/* Меню — над плашкой (выезжает вверх). Простое раскрытие (fade+scale),
              компактные пункты h-8. */}
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 4 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                style={{ transformOrigin: "bottom" }}
                className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/8"
                onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              >
                {/* Шапки с именем и почтой здесь БОЛЬШЕ НЕТ: она повторяла бы
                    плашку, над которой меню и раскрывается, — те же имя и почта
                    в паре пикселей ниже. Раньше это был единственный способ их
                    увидеть, теперь они на виду всегда. */}
                {MENU.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        item.onSelect?.();
                        setOpen(false);
                      }}
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors hover:bg-accent"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {!!item.badge && (
                        <span className="flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* Тема — toggle со свитчем справа; клик НЕ закрывает меню. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDark}
                  aria-label={t.sidebar.darkTheme}
                  onClick={toggleTheme}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors hover:bg-accent"
                >
                  <Sun className="size-4 text-muted-foreground" />
                  <span className="flex-1 text-left">{t.sidebar.theme}</span>
                  <ThemeSwitch on={mounted && isDark} />
                </button>

                {/* Язык — segmented RU/EN; клик по сегменту НЕ закрывает меню. */}
                <div
                  role="group"
                  aria-label={t.sidebar.language}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm"
                >
                  <Globe className="size-4 text-muted-foreground" />
                  <span className="flex-1 text-left">{t.sidebar.language}</span>
                  <LangSwitch locale={locale} onChange={setLocale} />
                </div>

                <div className="my-1 h-px bg-border" />

                {/* Выход. */}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void logout();
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors hover:bg-accent"
                >
                  <LogOut className="size-4 text-muted-foreground" />
                  {t.sidebar.logout}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Плашка и кнопка связи — соседи в одной строке, не вложены друг в
              друга: это два разных действия, и вкладывать кнопку в кнопку
              нельзя (невалидная разметка, а клик пришлось бы гасить вручную). */}
          <div className="flex items-stretch gap-1">
            {/* Триггер — знак + имя и почта под ним. Почта стояла только в шапке
                меню, то есть была не видна, пока его не откроешь; под именем она
                отвечает на вопрос «под каким аккаунтом я сижу» сразу.

                БЕЗ ШЕВРОНА: две стрелки читались как технический значок. Что
                строка кликабельна, показывает подсветка на ховере — ровно как у
                переключателя режимов сверху. */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="menu"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                open && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Avatar name={name} />
              <span className="grid min-w-0 flex-1 leading-none">
                <span className="truncate text-[13px] font-medium">{name}</span>
                {email && (
                  <span className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {email}
                  </span>
                )}
              </span>
            </button>

          </div>
        </div>
      </MotionConfig>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SidebarFooter>
  );
}
