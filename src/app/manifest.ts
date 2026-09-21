import type { MetadataRoute } from "next";

/**
 * Манифест PWA: без него телефон предложит обычный ярлык на сайт, а не
 * установку приложения.
 *
 * display: "standalone" — запуск без адресной строки. Отсюда же требование к
 * safe-area в вёрстке: браузерной обвязки нет, и контент упирается прямо в
 * статус-бар (см. viewportFit в layout.tsx).
 *
 * background_color — фон системного splash-экрана, ПОКА идёт загрузка. Берём
 * тёмный фон темы: белый мигал бы вспышкой у большинства пользователей.
 *
 * Иконка maskable — отдельным файлом: Android обрезает икону по своей форме и
 * съедает до 20% с краёв, поэтому знак там ужат в безопасную зону. Обычную
 * иконку так уродовать нельзя — она показывается целиком.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Avy Chat",
    short_name: "Avy",
    description: "AI ассистент",
    start_url: "/",
    display: "standalone",
    // Фон тёмной темы («медный монохром» — см. globals.css).
    background_color: "#121212",
    theme_color: "#121212",
    orientation: "portrait",
    lang: "ru",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
