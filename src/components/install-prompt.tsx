"use client";

import * as React from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { useT } from "@/i18n/i18n-context";
import { useIsDesktop } from "@/hooks/use-is-desktop";

/** Сколько не показывать приглашение после отказа. */
const SNOOZE_DAYS = 30;
const SNOOZE_KEY = "avy:install-dismissed-at";

/** Событие Chrome/Edge: даёт отложить системный диалог установки и вызвать его
 *  в удобный момент. В Safari его нет — там ставят вручную через «Поделиться». */
type InstallEvent = Event & { prompt: () => Promise<void> };

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return at > 0 && Date.now() - at < SNOOZE_DAYS * 86400_000;
  } catch {
    return false;
  }
}

/** Уже запущены как установленное приложение. */
function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS до сих пор сообщает об этом своим нестандартным полем.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Регистрация service worker + приглашение установить приложение.
 *
 * SW нужен не ради оффлайна (см. public/sw.js), а потому что без него Chrome
 * не считает сайт устанавливаемым и не даёт beforeinstallprompt.
 *
 * Приглашение показываем ОДИН раз и с отсрочкой на месяц после отказа: баннер
 * «установите приложение» на каждом заходе — верный способ, чтобы его начали
 * закрывать не глядя.
 */
export function InstallPrompt() {
  const t = useT();
  const isDesktop = useIsDesktop();
  const [event, setEvent] = React.useState<InstallEvent | null>(null);
  const [showIosHint, setShowIosHint] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);

  // Регистрация SW. В Electron не нужна — там и так приложение.
  React.useEffect(() => {
    if (isDesktop || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Регистрация могла не пройти (http без localhost, приватный режим).
      // Это не повод ломать приложение: без SW просто не будет установки.
    });
  }, [isDesktop]);

  React.useEffect(() => {
    if (isDesktop || standalone() || snoozed()) return;

    const onPrompt = (e: Event) => {
      // Отменяем стандартный баннер, чтобы показать свой в нужный момент.
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Safari события не шлёт — предлагаем ручной путь. С задержкой: приглашение
    // в первую секунду знакомства с продуктом закрывают не читая.
    const timer = isIos() ? window.setTimeout(() => setShowIosHint(true), 20_000) : 0;

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (timer) clearTimeout(timer);
    };
  }, [isDesktop]);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      // Приватный режим — просто не запомним отказ.
    }
  };

  const install = async () => {
    if (!event) return;
    setHidden(true);
    await event.prompt();
    // Показывать баннер снова после системного диалога незачем: человек уже
    // ответил, а решение браузер запомнил сам.
    setEvent(null);
  };

  if (hidden || (!event && !showIosHint)) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[110] mx-auto max-w-md rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xl sm:inset-x-auto sm:right-4 sm:bottom-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Download className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t.install.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {event ? t.install.body : t.install.iosBody}
          </p>

          {/* iOS: системного диалога нет — показываем, что нажать. */}
          {!event && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Share className="size-3.5 shrink-0" />
              <span>{t.install.iosStep1}</span>
              <SquarePlus className="size-3.5 shrink-0" />
              <span>{t.install.iosStep2}</span>
            </p>
          )}

          {event && (
            <button
              type="button"
              onClick={install}
              className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              {t.install.action}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t.install.later}
          title={t.install.later}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
