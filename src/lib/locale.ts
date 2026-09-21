/**
 * Тип локали интерфейса и автоопределение языка из браузера.
 *
 * ru-* → "ru", всё остальное → "en". Полноценные словари и ручное переключение
 * живут в i18n-context.tsx (LocaleProvider + useLocale/useT); этот файл — базовый
 * примитив, который читают и провайдер, и лёгкие места (tool-labels).
 */
export type Locale = "ru" | "en";

export const LOCALE_STORAGE_KEY = "avy-locale";

export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("ru") ? "ru" : "en";
}

/**
 * Стартовая локаль с учётом сохранённого выбора пользователя (localStorage),
 * иначе — язык браузера. Безопасно на сервере (вернёт "en").
 */
export function initialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (saved === "ru" || saved === "en") return saved;
  return detectLocale();
}
