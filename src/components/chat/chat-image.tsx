"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { createPortal } from "react-dom";

// Картинка внутри ответа ассистента. В ленте показываем КОМПАКТНОЕ превью
// фиксированной высоты (не на весь экран): так лента остаётся короткой, а место
// под картинку зарезервировано заранее → нет «прыжков» лейаута при догрузке.
// По клику картинка раскрывается в полноэкранный лайтбокс (object-contain).
//
// loading="lazy"/decoding="async" сохраняем: на длинной сессии офскрин-картинки
// не тянутся и не декодируются заранее — это и держит память в узде.

// Высота превью в ленте. Картинка вписывается по object-contain: горизонтальные
// и вертикальные занимают один и тот же предсказуемый вертикальный размер.
const PREVIEW_MAX_HEIGHT = 280;

export function ChatImage({
  alt,
  src,
  // className от Streamdown (max-w-full rounded-lg) намеренно отбрасываем — у нас
  // своя обёртка и свои классы; чужой className конфликтовал бы с object-contain.
  className,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  void className;
  const [open, setOpen] = useState(false);
  // Плавное проявление: пока не загружена — прозрачна, контейнер уже держит место.
  const [loaded, setLoaded] = useState(false);

  // Esc закрывает лайтбокс; блокируем скролл фона, пока он открыт.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      {/* Картинка ВСЕГДА на отдельной строке (блок, flex), а не инлайн с текстом —
          иначе соседний текст съезжает по базовой линии. Streamdown оборачивает
          картинку в image-wrapper, а ParagraphOrFragment выкидывает <p> у такого
          параграфа (ChatImage несёт src → распознаётся как блок), поэтому <div>
          здесь не попадает внутрь <p> и не ломает гидрацию.
          Фикс. высота резервирует место ДО загрузки — контент под ней не скачет. */}
      <div
        className="my-2 flex w-fit max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted/40"
        style={{ height: PREVIEW_MAX_HEIGHT }}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={alt ?? ""}
          src={src}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className="h-full w-auto max-w-full object-contain transition-opacity duration-300"
          style={{ opacity: loaded ? 1 : 0 }}
          {...props}
        />
      </div>

      {/* Лайтбокс на весь экран — через портал, поверх всего. Клик по фону или по
          картинке закрывает. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={alt ?? ""}
              src={src}
              decoding="async"
              className="max-h-full max-w-full cursor-zoom-out rounded-lg object-contain shadow-2xl"
            />
          </div>,
          document.body,
        )}
    </>
  );
}
