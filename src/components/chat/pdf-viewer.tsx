"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ZoomControls,
  useZoom,
  usePan,
  wheelZoom,
} from "@/components/chat/zoom-controls";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";

// Worker pdf.js из локального пакета (Next/webpack копирует его как asset).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/**
 * Миниатюра PDF: рендерит ТОЛЬКО первую страницу как картинку-превью для карточки
 * в панели файлов. Без зума/пана/текстового слоя — лёгкий режим. Worker pdf.js
 * настраивается этим же модулем (выше), поэтому отдельной инициализации не нужно.
 */
export function PdfThumb({ url, width }: { url: string; width: number }) {
  const [error, setError] = useState(false);
  // withCredentials: pdf.js тянет файл своим загрузчиком (мимо нашего fetch),
  // а /files/raw требует сессионную cookie. Без этого кросс-origin запрос идёт
  // без cookie → 401. Объект мемоизируем: react-pdf по смене ссылки на `file`
  // перезагружает PDF.
  const file = useMemo(() => ({ url, withCredentials: true }), [url]);
  if (error) return null;
  return (
    <Document
      file={file}
      onLoadError={() => setError(true)}
      loading={null}
      error={null}
      className="contents"
    >
      <Page
        pageNumber={1}
        width={width}
        renderAnnotationLayer={false}
        renderTextLayer={false}
        className="[&_canvas]:!h-auto [&_canvas]:!w-full"
      />
    </Document>
  );
}

/**
 * Рендер PDF через pdf.js (react-pdf): страницы — наши DOM-элементы, поэтому их
 * можно стилизовать (тени, отступы, фон) в духе панели, без браузерного тулбара.
 *
 * Зум сделан через CSS `transform: scale()`, а НЕ через смену ширины страниц:
 * смена `width` заставляла pdf.js перерисовывать canvas каждой страницы (мигание
 * и рывки). transform — чисто композитная операция (GPU), без перерисовки. Сами
 * страницы рендерятся один раз с базовой шириной (по контейнеру). Внешний
 * sizer-блок занимает место уже масштабированного контента (base × scale), чтобы
 * scroll-контейнер знал реальные размеры и зум держался от центра (useZoom).
 */
export function PdfViewer({ url }: { url: string }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [baseWidth, setBaseWidth] = useState(0);
  const [baseHeight, setBaseHeight] = useState(0);
  const [error, setError] = useState(false);
  // withCredentials: см. PdfThumb — без cookie /files/raw отдаёт 401.
  const file = useMemo(() => ({ url, withCredentials: true }), [url]);
  // Передаём контейнер, чтобы зум держался от центра видимой области.
  const zoom = useZoom(containerRef);
  // При зуме > 1 контент шире/выше контейнера → можно таскать «хватанием».
  const pan = usePan(containerRef, zoom.scale > 1);

  // Базовая ширина страниц = ширина контейнера минус паддинги (зум=1.0).
  // Высоту масштабируемого блока меряем после рендера страниц (для sizer'а).
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBaseWidth(Math.max(0, el.clientWidth - 24));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // После того как страницы отрисованы, фиксируем натуральную высоту контента
  // (при scale=1), чтобы sizer мог зарезервировать base × scale по вертикали.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBaseHeight(el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ZoomControls zoom={zoom} />
      <div
        ref={containerRef}
        onWheel={wheelZoom(zoom)}
        {...pan.handlers}
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-muted/30 p-3",
          pan.cursor,
        )}
      >
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t.files.pdfRenderFailed}
          </div>
        ) : (
          // Sizer резервирует место под масштабированный контент (base × scale),
          // mx-auto центрирует его по горизонтали, когда он уже контейнера.
          <div
            className="mx-auto"
            style={{
              width: baseWidth ? baseWidth * zoom.scale : undefined,
              height: baseHeight ? baseHeight * zoom.scale : undefined,
            }}
          >
            {/* Масштабируем обёртку: transform-origin top-left, чтобы scaled-блок
                лёг ровно в sizer (0,0). Перерисовки canvas нет — только compose. */}
            <div
              ref={contentRef}
              style={{
                width: baseWidth || undefined,
                transform: `scale(${zoom.scale})`,
                transformOrigin: "top left",
              }}
            >
              <Document
                file={file}
                onLoadSuccess={({ numPages }) => setPageCount(numPages)}
                onLoadError={() => setError(true)}
                loading={
                  <div className="flex h-full items-center justify-center py-8 text-sm text-muted-foreground">
                    {t.files.loading}
                  </div>
                }
                className="flex flex-col items-center gap-3"
              >
                {baseWidth > 0 &&
                  Array.from({ length: pageCount }, (_, i) => (
                    <Page
                      key={i}
                      pageNumber={i + 1}
                      width={baseWidth}
                      className="overflow-hidden rounded-md shadow-sm ring-1 ring-border"
                      renderAnnotationLayer={false}
                      // Текстовый слой выключен: react-pdf 10.4.1 читает
                      // streamTextContent по API pdfjs 5.x, а мы форсим pdfjs 6.x
                      // (ради поддержки ShadingType 1 — см. overrides в package.json).
                      // В 6.x стрим-API текста другой → ошибка "value of readableStream".
                      // Для превью в панели выделение текста не нужно; canvas-рендер
                      // (картинка) работает независимо и корректно.
                      renderTextLayer={false}
                    />
                  ))}
              </Document>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
