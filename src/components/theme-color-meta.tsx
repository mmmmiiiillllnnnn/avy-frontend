"use client";

import * as React from "react";
import { useTheme } from "next-themes";

// Держит <meta name="theme-color"> в тон фону приложения, чтобы «подложка»
// браузера на мобиле (адресная строка Safari, области safe-area, фон при
// оверскролле) совпадала с фоном контента и МЕНЯЛАСЬ вместе с темой.
//
// theme-color — статичный мета-тег, а тему переключает next-themes на клиенте
// (класс .light/.dark на <html>). Поэтому обновляем content тега из JS: берём
// РЕАЛЬНЫЙ computed --background (источник цвета один — CSS-токен; поменяем
// палитру — theme-color поедет за ней автоматически).
export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    // Ждём кадр: класс темы уже проставлен next-themes, computed-значение
    // --background актуально для текущей схемы.
    const id = requestAnimationFrame(() => {
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
      if (!bg) return;
      let meta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]',
      );
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      meta.content = bg;
    });
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

  return null;
}
