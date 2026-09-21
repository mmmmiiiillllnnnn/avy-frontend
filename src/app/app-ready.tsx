"use client";

import { useEffect } from "react";

/**
 * Снимает заставку загрузки: ставит на <html> класс, по которому она гаснет
 * (см. #app-splash в globals.css).
 *
 * Класс на КОРНЕ, а не состояние React вокруг самой заставки: та отрисована
 * инлайном в layout до гидрации, и включать её в дерево React значило бы
 * потерять единственный смысл — быть на экране раньше, чем приложение
 * смонтируется.
 *
 * requestAnimationFrame — чтобы браузер успел показать кадр с заставкой хотя бы
 * раз. Без него на быстрой машине она мигает: ставится и снимается в пределах
 * одного кадра, и получается вспышка вместо плавного появления.
 */
export function AppReady() {
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      document.documentElement.classList.add("app-ready"),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  return null;
}
