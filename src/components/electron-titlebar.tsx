"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";

export const TITLEBAR_HEIGHT = 36;

// Ширина области нативных кнопок, которую ОС рисует поверх нашего титлбара
// справа (Windows). Резервируем это место под кнопки, чтобы наш контент в них
// не залезал. Примерно 3×46px caption-кнопок Windows.
const WIN_CONTROLS_WIDTH = 138;
// Слева на macOS — «светофоры». Резервируем место под них.
const MAC_TRAFFIC_WIDTH = 78;

/**
 * Кастомный титлбар поверх НАТИВНОЙ caption-области окна.
 *
 * Перетаскивание, превью Aero Snap, Snap Layouts и нативные кнопки
 * (свернуть/развернуть/закрыть) обрабатывает САМА ОС — окно создаётся с
 * titleBarStyle:"hidden" + titleBarOverlay (см. apps/desktop/src/main.js).
 * Никакого JS-перетаскивания: вся полоса помечена -webkit-app-region:drag,
 * и ОС хит-тестит её нативно.
 *
 * - Windows: ОС рисует кнопки справа (через overlay). Свои не рисуем, лишь
 *   резервируем под них место.
 * - macOS: ОС рисует «светофоры» слева. Резервируем место слева.
 * - Linux: overlay не везде доступен — рисуем КАСТОМНЫЕ кнопки сами.
 */
export function ElectronTitlebar() {
  // Рендерим титлбар только после монтирования на клиенте — на сервере и при
  // первом client-рендере возвращаем null, чтобы избежать рассинхрона гидрации
  // (в браузере window.avyDesktop отсутствует → титлбар вообще не появляется).
  const [mounted, setMounted] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const desktop = typeof window !== "undefined" ? window.avyDesktop : undefined;
    if (!desktop) return;
    // mounted-гард против гидрационного рассинхрона. Ставим в rAF, а не
    // синхронно в теле эффекта — иначе каскадный ре-рендер
    // (react-hooks/set-state-in-effect).
    const raf = requestAnimationFrame(() => setMounted(true));
    // Класс на <html> включает CSS-override высот (globals.css): h-svh/min-h-svh
    // урезаются на высоту титлбара, чтобы контент не вылезал за экран.
    document.documentElement.classList.add("electron");

    // Следим за maximize-состоянием (для иконки кнопки на Linux).
    desktop.isWindowMaximized?.().then((v) => setIsMaximized(!!v));
    const unsub = desktop.onMaximizedChange?.((v) => setIsMaximized(v));

    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("electron");
      unsub?.();
    };
  }, []);

  // Синхронизируем цвет нативных кнопок overlay с РЕАЛЬНОЙ темой приложения.
  // Считываем вычисленные CSS-цвета (--background / --foreground) с самой полосы
  // и отдаём их в Electron. При смене темы (next-themes меняет класс на <html>)
  // MutationObserver триггерит пересчёт — кнопки перекрашиваются на лету.
  useEffect(() => {
    const desktop = typeof window !== "undefined" ? window.avyDesktop : undefined;
    if (!desktop?.setTitlebarOverlay || !mounted) return;

    const sync = () => {
      const el = barRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      // backgroundColor полосы = --background темы; color = --foreground.
      const color = cs.backgroundColor;
      const symbolColor = cs.color;
      if (color) desktop.setTitlebarOverlay?.({ color, symbolColor });
    };

    sync();
    // Реагируем на смену темы (класс/стиль на <html>).
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => obs.disconnect();
  }, [mounted]);

  const desktop = typeof window !== "undefined" ? window.avyDesktop : undefined;
  if (!mounted || !desktop) return null;
  const platform = desktop.platform ?? "linux";

  const isWin = platform === "win32";
  const isMac = platform === "darwin";

  return (
    <div
      ref={barRef}
      // Разделитель между титлбаром и контентом рисуем НЕ бордером самой полосы,
      // а отдельным абсолютным элементом снизу (см. ниже): border-b полосы на
      // Windows обрывался на стыке с нативной областью overlay-кнопок. relative —
      // якорь для этого абсолютного разделителя.
      className="titlebar-drag relative flex items-stretch justify-between shrink-0 bg-background select-none"
      style={{
        height: TITLEBAR_HEIGHT,
        // Сдвигаем содержимое из-под нативных кнопок ОС.
        paddingLeft: isMac ? MAC_TRAFFIC_WIDTH : undefined,
        paddingRight: isWin ? WIN_CONTROLS_WIDTH : undefined,
      }}
    >
      {/* Малозаметная разделительная линия между титлбаром и контентом. Отдельный
          абсолютный элемент на всю ширину окна (а не border-b полосы) — иначе на
          Windows линия обрывалась на стыке с нативными overlay-кнопками. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border/60"
      />
      {/* Перетаскиваемая зона. Весь титлбар — drag (класс на корне), поэтому
          тут просто растягиваем пустое пространство под содержимое заголовка. */}
      <div className="flex-1 h-full" />

      {/* Кастомные кнопки управления окном — только Linux (на Win/macOS их
          рисует ОС). Помечаем no-drag, чтобы по ним можно было кликать. */}
      {!isWin && !isMac && (
        <div className="titlebar-no-drag flex items-stretch h-full">
          <button
            type="button"
            aria-label="Свернуть"
            onClick={() => desktop?.minimizeWindow?.()}
            className="flex items-center justify-center w-11 h-full text-foreground/50 hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "Восстановить" : "Развернуть"}
            onClick={() => desktop?.maximizeWindow?.()}
            className="flex items-center justify-center w-11 h-full text-foreground/50 hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            {isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}
          </button>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={() => desktop?.closeWindow?.()}
            className="flex items-center justify-center w-11 h-full text-foreground/50 hover:bg-destructive hover:text-white transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
