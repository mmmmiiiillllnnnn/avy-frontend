"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Виртуализация ленты «выгрузкой офскрина с сохранением высоты».
 *
 * Длинная сессия держит в DOM ВСЕ сообщения: их markdown-деревья (Streamdown
 * перепарсивает каждое) и `<img>` (декодированные битмапы). Память растёт и комп
 * начинает тормозить. Классический оконный виртуализатор тут не годится: лента
 * живёт внутри `use-stick-to-bottom`, который меряет высоту контента через
 * ResizeObserver и сам управляет scrollTop. Спейсер-виртуализатор сбил бы эти
 * измерения и сломал автоскролл.
 *
 * Решение, не трогающее скролл: каждый ряд сам следит, далеко ли он за вьюпортом
 * (IntersectionObserver с буфером сверху/снизу). Уехал далеко — заменяем тяжёлое
 * содержимое пустым `<div>` ТОЙ ЖЕ высоты, что была измерена перед выгрузкой.
 * Высота контента не меняется → stick-to-bottom и позиция скролла остаются
 * корректными, а из памяти уходят markdown и картинки далёких сообщений. Ряд
 * снова во вьюпорте (буфер) → монтируем содержимое обратно.
 *
 * `keepMounted` (активный/стримящийся ряд) — никогда не выгружаем: его контент
 * меняется каждый кадр, а высота не зафиксирована.
 */
export function OffscreenCull({
  children,
  keepMounted = false,
  /** Запас вокруг вьюпорта, в пределах которого ряд считается «рядом» и держится
   *  смонтированным (px). Должен быть больше экрана, чтобы при обычной прокрутке
   *  пользователь не видел разгруженных рядов. */
  rootMargin = "1200px",
}: {
  children: ReactNode;
  keepMounted?: boolean;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Высота плейсхолдера при выгрузке (px) или null, если ряд показан. Одно
  // состояние вместо пары «видим/высота»: null → рендерим содержимое, число →
  // отдаём пустой div этой высоты. Высоту замораживаем В МОМЕНТ ухода из буфера,
  // чтобы плейсхолдер занял ровно столько же и скролл не прыгнул.
  const [culledHeight, setCulledHeight] = useState<number | null>(null);

  useEffect(() => {
    // Пока ряд защищён от выгрузки — наблюдатель не нужен (плейсхолдер всё равно
    // не рисуется: culled учитывает keepMounted). Сняли защиту → эффект
    // перезапустится, подключит IntersectionObserver, и тот выставит актуальную
    // высоту/видимость. Поэтому здесь просто выходим, без setState в теле эффекта.
    if (keepMounted) return;
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setCulledHeight(null);
        } else {
          const h = el.getBoundingClientRect().height;
          setCulledHeight((prev) => (h > 0 ? h : prev));
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [keepMounted, rootMargin]);

  const culled = !keepMounted && culledHeight != null;

  return (
    <div ref={ref} style={culled ? { height: culledHeight } : undefined}>
      {culled ? null : children}
    </div>
  );
}
