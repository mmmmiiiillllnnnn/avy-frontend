"use client";

/**
 * Панель «Настройки сессии» — сосед ленты, как «Файлы сессии».
 *
 * Пока в ней одно: память. Выключатель ИМЕННО ЭТОГО чата плюс список того, что
 * уже запомнено. Список тот же самый, что в настройках (общий MemoryGroups):
 * человеку не надо ходить в настройки, чтобы увидеть, с чем агент сейчас
 * работает, а удалив запись здесь, он удаляет её везде.
 *
 * Выключатель сессии ТРЁХПОЗИЦИОННЫЙ: «как в настройках» — это не то же самое,
 * что «нет». Выключив память глобально и включив обратно, человек не должен
 * обнаружить, что пометки на отдельных чатах слились с общей настройкой.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  fetchMemorySettings,
  fetchMyMemory,
  setThreadMemoryEnabled,
  type MemoryOwner,
} from "@/lib/api";
import { MemoryGroups } from "@/components/memory-list";
import { usePanelWidth } from "@/components/chat/files-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useT } from "@/i18n/i18n-context";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function SessionSettingsPanel({
  open,
  threadId,
  onClose,
}: {
  open: boolean;
  threadId: string;
  onClose: () => void;
}) {
  const t = useT();
  const { width, dragging, handlers } = usePanelWidth();
  const isMobile = useIsMobile();

  const [globalOn, setGlobalOn] = useState(true);
  // Тумблер этой сессии. Пока человек его не трогал, он повторяет общую
  // настройку: выключено в настройках — выключено и здесь.
  const [threadOn, setThreadOn] = useState(true);
  // Храним ВЛАДЕЛЬЦЕВ, а не плоский список фактов: слой пользователя и слой
  // пространства — разные вещи, и человеку важно видеть, что куда записано.
  const [owners, setOwners] = useState<MemoryOwner[]>([]);
  const [loading, setLoading] = useState(true);

  // Перечитываем на КАЖДОЕ открытие: пока панель была закрыта, агент мог
  // записать новое, а человек — поменять общую настройку в настройках.
  // Показанный один раз и больше не обновлённый список врал бы.
  //
  // setLoading(true) в теле эффекта не зовём (react-hooks/set-state-in-effect:
  // синхронный setState в эффекте даёт каскадный ререндер) — вместо этого
  // спиннер показываем только на ПЕРВОЙ загрузке, а обновление идёт незаметно:
  // на экране остаются прежние данные, пока не приедут свежие.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([fetchMemorySettings(threadId), fetchMyMemory(threadId)])
      .then(([settings, owners]) => {
        if (!alive) return;
        setGlobalOn(settings.enabled);
        // Пометки на сессии нет (null) -> берём общую настройку: выключено
        // в настройках значит выключено и здесь.
        setThreadOn(settings.thread_enabled ?? settings.enabled);
        setOwners(owners);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, threadId]);

  const toggle = (next: boolean) => {
    // Переключаем сразу: тумблер, который «думает», ощущается сломанным.
    setThreadOn(next);
    void setThreadMemoryEnabled(threadId, next).then(
      (ok) => !ok && setThreadOn(!next),
    );
  };

  const body = (contentWidth: number | string) => (
    <div
      style={{ width: contentWidth }}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      {/* h-14 — та же высота, что у центрального хэдера чата: заголовки лежат
          на одной линии. Без border-b — по макету линии рисуют только
          заголовки слоёв ниже, шапка «в воздухе» на общей поверхности. */}
      <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
        <span className="flex-1 truncate text-[13px] font-semibold">
          {t.chat.sessionSettings}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.settings.close}
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-3">
        <div className="flex flex-col gap-2">
          {/* Тумблер — строкой с подписью, без коробки: панель по макету не
              рисует контейнеров, структура — типографикой. */}
          <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-1">
            <div>
              <div className="text-[13px] text-foreground">{t.settings.memory}</div>
              <div className="text-[11px] text-muted-foreground/70">
                {t.settings.memoryThisChat}
              </div>
            </div>
            {/* Обычный тумблер. Когда память выключена целиком, включить её
                здесь нельзя — иначе сессия обходила бы общую настройку. */}
            <button
              type="button"
              role="switch"
              aria-checked={threadOn}
              disabled={!globalOn}
              onClick={() => toggle(!threadOn)}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                threadOn ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-background transition-all",
                  threadOn ? "left-[1.125rem]" : "left-0.5",
                )}
              />
            </button>
          </div>
          {/* Память выключена в настройках — объясняем, почему тумблер не
              нажимается: иначе он выглядит просто сломанным. */}
          {!globalOn && (
            <p className="px-5 text-xs text-muted-foreground">
              {t.settings.memoryOffHint}
            </p>
          )}
        </div>

        {loading ? (
          <div className="px-5 text-sm text-muted-foreground">
            {t.settings.loading}
          </div>
        ) : (
          <MemoryGroups
            owners={owners}
            dimmed={!threadOn}
            onForget={(id) =>
              setOwners((cur) =>
                cur.map((o) => ({ ...o, facts: o.facts.filter((f) => f.id !== id) })),
              )
            }
          />
        )}
      </div>

      {/* Сноска — кому виден каждый слой. Только когда слоёв правда два:
          без пространства объяснять нечего. */}
      {owners.some((o) => o.scope === "space" && o.facts.length > 0) && (
        <div className="shrink-0 border-t px-5 py-3 text-[11px] leading-relaxed text-muted-foreground/70">
          {t.settings.memoryLayersFootnote}
        </div>
      )}
    </div>
  );

  // На узком экране панель не может быть колонкой рядом с лентой — шторкой
  // поверх контента, как «Файлы сессии» и мобильный сайдбар.
  if (isMobile) {
    return (
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-md"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t.chat.sessionSettings}</SheetTitle>
            <SheetDescription>{t.chat.sessionSettings}</SheetDescription>
          </SheetHeader>
          {body("100%")}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={dragging ? { duration: 0 } : { duration: 0.22, ease: "easeInOut" }}
          className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border/60 text-sidebar-foreground"
        >
          <div
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            className="group absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize"
            role="separator"
            aria-orientation="vertical"
          >
            <div className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-foreground/20" />
          </div>
          {body(width)}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
