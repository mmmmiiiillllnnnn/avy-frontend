"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { initialLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { DICTIONARIES, type Dictionary } from "@/i18n/dictionary";

/**
 * Клиентский провайдер локали интерфейса чата.
 *
 * Чат — клиентский SPA (роуты без сегмента [lang]), поэтому язык держим в
 * React-контексте + localStorage, а не в URL. Стартовая локаль — сохранённый
 * выбор пользователя, иначе язык браузера (см. initialLocale).
 *
 * Компоненты читают словарь через useT() и текущую локаль/сеттер через
 * useLocale(). Тулзовые подписи (tool-labels) принимают Locale параметром —
 * им тоже отдаём locale из этого контекста.
 */

type LocaleValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Dictionary;
};

const LocaleContext = createContext<LocaleValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Сервер и первый клиентский рендер должны совпасть → стартуем с "en" и
  // синхронизируем реальную локаль в эффекте после монтирования (как next-themes
  // делает с темой). Иначе hydration mismatch на пользователях с ru-браузером.
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(initialLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
    } catch {
      // localStorage недоступен (приватный режим) — просто не персистим.
    }
    // <html lang> для доступности/SEO; не критично, но корректно.
    document.documentElement.lang = l;
  }, []);

  return (
    <LocaleContext.Provider
      value={{ locale, setLocale, t: DICTIONARIES[locale] }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}

/** Текущий словарь интерфейса. */
export function useT(): Dictionary {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used within LocaleProvider");
  return ctx.t;
}
