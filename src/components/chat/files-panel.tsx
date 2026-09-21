"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";

// Заглушка-«загрузка» для динамического импорта: отдельный компонент, чтобы
// внутри был доступен useT (хук нельзя звать в module-scope колбэке loading).
function PdfViewerLoading() {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      {t.files.loading}
    </div>
  );
}

// react-pdf тяжёлый и работает только в браузере — грузим динамически без SSR.
const PdfViewer = dynamic(
  () => import("@/components/chat/pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => <PdfViewerLoading />,
  },
);

// Миниатюра первой страницы PDF для карточки (тоже только в браузере).
const PdfThumb = dynamic(
  () => import("@/components/chat/pdf-viewer").then((m) => m.PdfThumb),
  { ssr: false, loading: () => null },
);

// Рендерер markdown из чата (Streamdown + подсветка кода/математика/mermaid).
// Тяжёлый — грузим динамически, только когда открыли .md-файл в предпросмотре.
const MessageResponse = dynamic(
  () => import("@/components/ai-elements/message").then((m) => m.MessageResponse),
  { ssr: false, loading: () => null },
);
import {
  FileText,
  FileType,
  File as FileIcon,
  RefreshCw,
  ChevronLeft,
  Download,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/download-file";
import {
  sessionFileRawUrl,
  type SessionFile,
} from "@/lib/api";
import {
  ZoomControls,
  useZoom,
  usePan,
  wheelZoom,
} from "@/components/chat/zoom-controls";
import { useT } from "@/i18n/i18n-context";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type FilesPanelProps = {
  open: boolean;
  threadId: string;
  files: SessionFile[];
  loading: boolean;
  onRefresh: () => void;
  /** Путь файла, который нужно открыть в предпросмотре (по клику «Открыть» на
   *  плашке файла в сообщении). Меняется с «маркером» — см. openRequest. */
  openRequest?: { threadId: string; path: string; nonce: number } | null;
  /** Закрыть панель (кнопка ✕ в шапке). */
  onClose: () => void;
};

// Минимальная ширина (px) = 22rem; максимум — доля окна (по умолчанию треть).
const MIN_WIDTH = 352; // 22rem
const STORAGE_KEY = "avy:files-panel-width";

function maxWidth(fraction: number): number {
  if (typeof window === "undefined") return 640;
  return Math.round(window.innerWidth * fraction);
}

function clampWidth(px: number, fraction: number): number {
  return Math.max(MIN_WIDTH, Math.min(px, maxWidth(fraction)));
}

/** Ширина панели с сохранением + drag-ресайзом левой границы.
 *
 * maxFraction — доля ширины окна, до которой можно раздвинуть панель (1/3 для
 * панели файлов сессии, 1/2 для предпросмотра в разделе «Файлы»). storageKey —
 * отдельный ключ на панель, чтобы их ширины не мешали друг другу. */
function usePanelWidth(maxFraction = 1 / 3, storageKey = STORAGE_KEY) {
  const [width, setWidth] = useState(MIN_WIDTH);

  // Восстанавливаем сохранённую ширину на клиенте (после маунта, чтобы не
  // ломать SSR-гидрацию и иметь доступ к window для clamp).
  useEffect(() => {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved) setWidth(clampWidth(saved, maxFraction));
  }, [maxFraction, storageKey]);

  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    // Панель прижата к правому краю: ширина = расстояние от курсора до края.
    setWidth(clampWidth(window.innerWidth - e.clientX, maxFraction));
  }, [maxFraction]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      localStorage.setItem(storageKey, String(width));
    },
    [width, storageKey],
  );

  return {
    width,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}

/** Группа файлов по типу для секций панели. Заголовок резолвится в компоненте
 *  через словарь (useT) — здесь только стабильный ключ группы. */
type GroupKey = "images" | "docs" | "other" | "downloads";
type Group = { key: GroupKey; files: SessionFile[] };

function groupFiles(files: SessionFile[]): Group[] {
  const images: SessionFile[] = [];
  const docs: SessionFile[] = [];
  const other: SessionFile[] = [];
  // Скачанное web_fetch'ем (/downloads) — отдельным разделом «Загрузки», ниже
  // результатов. Различаем по пути, а не по типу (это про происхождение файла).
  const downloads: SessionFile[] = [];
  for (const f of files) {
    if (f.path.startsWith("/downloads/")) downloads.push(f);
    else if (f.mime.startsWith("image/")) images.push(f);
    else if (isDoc(f.mime)) docs.push(f);
    else other.push(f);
  }
  return [
    { key: "images" as const, files: images },
    { key: "docs" as const, files: docs },
    { key: "other" as const, files: other },
    { key: "downloads" as const, files: downloads },
  ].filter((g) => g.files.length > 0);
}

function isDoc(mime: string): boolean {
  return (
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("word") ||
    mime.includes("officedocument") ||
    mime.includes("opendocument")
  );
}

// MIME по расширению — для предпросмотра файла, которого ещё нет в загруженном
// списке сессии (открыт по клику на плашку в сообщении сразу после генерации).
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
  json: "application/json", xml: "application/xml", csv: "text/csv",
  html: "text/html", css: "text/css", js: "text/javascript", ts: "text/plain",
  py: "text/x-python", sh: "text/x-sh", yaml: "text/yaml", yml: "text/yaml",
};

function fileFromPath(path: string): SessionFile {
  const name = path.split("/").pop() || path;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return {
    path,
    name,
    size: 0,
    mtime: 0,
    mime: MIME_BY_EXT[ext] ?? "application/octet-stream",
  };
}

/**
 * Правая панель «Файлы» — НЕ модальная: живёт в потоке layout рядом с лентой,
 * чат остаётся активным. Файлы — карточками-превью в сетке 2 колонки, сгруппи-
 * рованы по типу. Клик по карточке открывает файл в новой вкладке.
 */
export function FilesPanel({
  open,
  threadId,
  files,
  loading,
  onRefresh,
  openRequest,
  onClose,
}: FilesPanelProps) {
  const t = useT();
  const groups = groupFiles(files);
  // Подписи групп берём из словаря по стабильному ключу группы.
  const groupTitle: Record<GroupKey, string> = {
    images: t.files.images,
    docs: t.files.documents,
    other: t.files.other,
    downloads: t.files.downloads,
  };
  const { width, dragging, handlers } = usePanelWidth();
  const [selected, setSelected] = useState<SessionFile | null>(null);
  // На узком экране панель не может быть колонкой рядом с лентой: на неё просто
  // нет места, чат сжимался в нечитаемую полосу. Показываем шторкой поверх
  // контента — ровно как мобильный сайдбар (он тоже Sheet, см. ui/sidebar.tsx).
  const isMobile = useIsMobile();

  // Внешний запрос «открыть файл X» (клик «Открыть» на плашке в сообщении):
  // находим файл в списке сессии; если его там ещё нет — собираем минимальный
  // SessionFile из пути (mime по расширению), чтобы предпросмотр всё равно
  // открылся. Реагируем на nonce, чтобы повторный клик по тому же файлу
  // переоткрывал его.
  const openNonce = openRequest?.nonce;
  // Синхронизируем предпросмотр с внешним императивным запросом (клик «Открыть» на
  // плашке файла в сообщении); реагируем ТОЛЬКО на nonce, поэтому files/openRequest
  // намеренно не в deps (иначе переоткрывал бы файл на каждом обновлении списка).
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!openRequest) return;
    const found = files.find((f) => f.path === openRequest.path);
    setSelected(found ?? fileFromPath(openRequest.path));
  }, [openNonce]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Содержимое панели — ОДНО на оба вида, ширину задаёт вызывающая сторона.
  // Дублировать разметку в двух ветках нельзя: она разойдётся при первой же
  // правке (на десктопе поправят, на мобильном забудут).
  const panelBody = (contentWidth: number | string) => (
            <div
              style={{ width: contentWidth }}
              className="flex h-full min-h-0 flex-1 flex-col"
            >
              {/* Шапка: в режиме просмотра — «назад» + имя + скачать. */}
              {/* h-14 — как центральный хэдер чата: заголовки на одной линии.
                  Без border-b — по утверждённому макету линии рисуют только
                  заголовки секций, шапка живёт на общей поверхности. */}
              <div className="flex h-14 shrink-0 items-center gap-1.5 px-3">
                {selected ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      aria-label={t.files.backToList}
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {selected.name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void downloadFile(
                          sessionFileRawUrl(threadId, selected.path),
                          selected.name,
                          selected.mime,
                        )
                      }
                      aria-label={t.files.download}
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    >
                      <Download className="size-4" />
                    </button>
                  </>
                ) : (
                  <>
                    {/* Единый список файлов сессии (результаты агента + загрузки).
                        Рабочая директория агента (/work) здесь не показывается. */}
                    <span className="flex-1 truncate pl-2 text-[13px] font-semibold">
                      {t.files.sessionFiles}
                    </span>
                    <button
                      type="button"
                      onClick={onRefresh}
                      aria-label={t.files.refresh}
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    >
                      <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label={t.files.closePanel}
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </>
                )}
              </div>

              {selected ? (
                <FileViewer file={selected} threadId={threadId} />
              ) : files.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                  {loading ? t.files.loading : t.files.noResults}
                </div>
              ) : (
                <div className="min-h-0 flex-1 space-y-5 overflow-auto pb-4">
                  {/* Секция — как слой в настройках сессии: капс-заголовок со
                      счётчиком и тонкая линия во всю ширину панели. */}
                  {groups.map((g) => (
                    <section key={g.key}>
                      <div className="flex items-baseline gap-2 px-5 pb-1.5">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {groupTitle[g.key]}
                        </h3>
                        <span className="text-[11px] tabular-nums text-muted-foreground/60">
                          {g.files.length}
                        </span>
                      </div>
                      <div className="mb-2.5 h-px bg-border/60" />
                      <div className="grid grid-cols-2 gap-2 px-4">
                        {g.files.map((f) => (
                          <FileCard
                            key={f.path}
                            file={f}
                            href={sessionFileRawUrl(threadId, f.path)}
                            onOpen={() => setSelected(f)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
  );

  // МОБИЛЬНЫЙ ВИД. Раньше панель и здесь была колонкой в потоке layout —
  // она отжимала ленту, и на узком экране чат превращался в нечитаемую
  // полосу. Показываем шторкой ПОВЕРХ контента, ровно как мобильный сайдбар
  // (он тоже Sheet, см. ui/sidebar.tsx): чат остаётся на месте, шторка
  // закрывается свайпом, кликом по подложке или крестиком.
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent
          side="right"
          // Свой крестик Sheet НЕ рисуем: у панели он уже есть в шапке, и два
          // накладывались друг на друга в правом верхнем углу — выглядело как
          // «двоится», а при наведении подсветка одного перекрывала второй.
          showCloseButton={false}
          className="w-full gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-md"
        >
          {/* Заголовок скрыт визуально, но нужен для доступности: без него
              Radix ругается на диалог без имени. */}
          <SheetHeader className="sr-only">
            <SheetTitle>{t.files.sessionFiles}</SheetTitle>
            <SheetDescription>{t.files.sessionFiles}</SheetDescription>
          </SheetHeader>
          {panelBody("100%")}
        </SheetContent>
      </Sheet>
    );
  }


  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          // tween для open/close; во время ресайза анимацию ширины отключаем,
          // чтобы панель шла строго за курсором без инерции.
          transition={
            dragging
              ? { duration: 0 }
              : { duration: 0.22, ease: "easeInOut" }
          }
          className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border/60 text-sidebar-foreground"
        >
          {/* Ручка ресайза на левой границе панели. */}
          {/* Зона захвата шире для удобства, видимая подсветка — тонкая линия
              у самого края (group-hover), чтобы не было широкой плашки. */}
          <div
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            className="group absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize"
            role="separator"
            aria-orientation="vertical"
          >
            <div className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-foreground/20" />
          </div>
          {panelBody(width)}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** Карточка-превью одного файла. Клик открывает просмотр внутри панели. */
function FileCard({
  file,
  href,
  onOpen,
}: {
  file: SessionFile;
  href: string;
  onOpen: () => void;
}) {
  const isImage = file.mime.startsWith("image/");
  const isPdf = file.mime === "application/pdf";
  const Icon = iconFor(file.mime);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={file.path}
      className="group flex flex-col overflow-hidden rounded-lg border bg-background/40 text-left transition-colors hover:border-foreground/30 hover:bg-sidebar-accent"
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={href}
            alt={file.name}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : isPdf ? (
          // Первая страница PDF как превью; если рендер не удался — внутри null,
          // и видна подложка bg-muted (без иконки — это редкий случай).
          <div className="size-full overflow-hidden [&_canvas]:size-full [&_canvas]:object-cover">
            <PdfThumb url={href} width={220} />
          </div>
        ) : (
          <Icon className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        <span className="truncate text-xs font-medium">{stripExt(file.name)}</span>
        <span className="text-[10px] text-muted-foreground">
          {[extLabel(file.name), formatSize(file.size)].filter(Boolean).join(" · ")}
        </span>
      </div>
    </button>
  );
}

/**
 * Просмотрщик файла внутри панели по типу:
 * изображение -> <img>, PDF -> <iframe>, текст/код -> загруженный текст в <pre>,
 * остальное -> иконка + скачать.
 */
export { usePanelWidth };

/** Просмотрщик одного файла (картинка/PDF/текст, иначе — предложение скачать).
 * Экспортируется для переиспользования в панели предпросмотра раздела «Файлы» и
 * в файлах регулярных задач.
 *
 * rawUrl — опциональный override источника байтов. По умолчанию строим URL файла
 * сессии (sessionFileRawUrl по threadId); задачи передают свой taskFileRawUrl,
 * т.к. их файлы лежат под другим эндпоинтом. threadId остаётся обязательным для
 * дефолтного случая (и как ключ ремонта). */
export function FileViewer({
  file,
  threadId,
  rawUrl,
}: {
  file: SessionFile;
  threadId: string;
  rawUrl?: string;
}) {
  const t = useT();
  const url = rawUrl ?? sessionFileRawUrl(threadId, file.path);

  if (file.mime.startsWith("image/")) {
    return <ImageViewer url={url} name={file.name} />;
  }

  if (file.mime === "application/pdf") {
    return <PdfViewer url={url} />;
  }

  // Markdown — по умолчанию рендерим как в чате (Streamdown); переключатель
  // сверху даёт посмотреть сырой текст (Plain). Определяем по mime ИЛИ
  // расширению (.md/.markdown), т.к. mime по расширению не всегда даёт markdown.
  if (isMarkdown(file)) {
    return <MarkdownOrPlainViewer url={url} />;
  }

  // Word (.docx) — конвертируем в markdown на клиенте и показываем как .md.
  if (isWord(file)) {
    return <WordViewer url={url} />;
  }

  if (isTextMime(file.mime)) {
    return <TextViewer url={url} />;
  }

  // Неизвестный/бинарный тип — показать нечего, предложить скачать.
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <FileIcon className="size-10" />
      <p className="text-sm">{t.files.previewUnavailable}</p>
      <button
        type="button"
        onClick={() => void downloadFile(url, file.name, file.mime)}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-sidebar-accent"
      >
        <Download className="size-4" /> {t.files.download}
      </button>
    </div>
  );
}

/**
 * Просмотр изображения с зумом и панорамированием: масштаб через ширину (кнопки
 * или Ctrl/⌘+колесо), контейнер скроллится, когда картинка больше окна. Когда
 * увеличено — картинку можно «хватать» и таскать (usePan двигает scroll).
 */
function ImageViewer({ url, name }: { url: string; name: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Контейнер в useZoom → зум держится от центра видимой области.
  const zoom = useZoom(scrollRef);
  const pan = usePan(scrollRef, zoom.scale > 1);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ZoomControls zoom={zoom} />
      <div
        ref={scrollRef}
        onWheel={wheelZoom(zoom)}
        {...pan.handlers}
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-background/40 p-3",
          pan.cursor,
        )}
      >
        {/* Обёртка с mx-auto центрирует картинку, когда она уже контейнера, но
            (в отличие от justify-center) не «съедает» левый оверфлоу при зуме —
            иначе влево скроллить нельзя. w-fit ужимает обёртку под картинку. */}
        <div className="mx-auto w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name}
            draggable={false}
            style={{ width: `${zoom.scale * 100}%` }}
            className="max-w-none select-none rounded-md object-contain"
          />
        </div>
      </div>
    </div>
  );
}

/** Загрузить текстовый файл и показать как есть в <pre>. */
function TextViewer({ url }: { url: string }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(false);
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {t.files.loadFailed}
      </div>
    );
  }
  if (text === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {t.files.loading}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background/40">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

/** Markdown-файл (.md/.markdown или text/markdown) — рендерим как в чате. */
function isMarkdown(file: SessionFile): boolean {
  if (file.mime === "text/markdown" || file.mime === "text/x-markdown") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".md") || name.endsWith(".markdown");
}

/** Word .docx (OOXML) — конвертируем в markdown на клиенте. Старый .doc (бинарный)
 *  mammoth НЕ читает, поэтому его сюда не относим (уйдёт в «Скачать»). */
function isWord(file: SessionFile): boolean {
  return (
    file.mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

/** Бейджи-переключатель «Markdown / Текст» — висят ПОВЕРХ документа (абсолютно
 *  в правом верхнем углу), без строки-разделителя. Лёгкий backdrop-blur, чтобы
 *  читались над текстом; z-10 — над содержимым, но кликаются. */
function ModeToggle({ plain, onChange }: { plain: boolean; onChange: (plain: boolean) => void }) {
  const t = useT();
  const modes: { id: "md" | "plain"; label: string }[] = [
    { id: "md", label: t.files.viewRendered },
    { id: "plain", label: t.files.viewPlain },
  ];
  const current = plain ? "plain" : "md";
  return (
    <span className="absolute top-2 right-2 z-10 inline-flex items-center rounded-full bg-muted/80 p-0.5 text-xs font-medium shadow-sm backdrop-blur">
      {modes.map((m) => {
        const active = current === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id === "plain")}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </span>
  );
}

/** Рендер markdown-строки: как в чате — MessageResponse без обёрток/CSS поверх
 *  Streamdown (любые «улучшайзинги» ломали раскладку списков). Только p-4. */
function MarkdownRender({ md }: { md: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background/40">
      {/* pt-12 — чтобы первая строка не заезжала под плавающие бейджи в углу. */}
      <div className="px-4 pt-12 pb-4">
        <MessageResponse>{md}</MessageResponse>
      </div>
    </div>
  );
}

/** Сырой текст в <pre> (режим «Текст» для .md и сконвертированного .docx). */
function PlainText({ text }: { text: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background/40">
      {/* pt-12 — под плавающие бейджи переключателя в правом верхнем углу. */}
      <pre className="whitespace-pre-wrap break-words px-3 pt-12 pb-3 font-mono text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

/** Центрированное сообщение состояния (загрузка/ошибка). */
function ViewerStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Просмотр markdown с переключателем «Markdown» (рендер, дефолт) / «Текст» (сырой
 * .md). Переключатель живёт в общем FileViewer — работает и в панели сессии, и в
 * разделе «Файлы» без дублирования. Текст тянем один раз, режим переключаем локально.
 */
function MarkdownOrPlainViewer({ url }: { url: string }) {
  const t = useT();
  const [plain, setPlain] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(false);
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((md) => alive && setText(md))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ModeToggle plain={plain} onChange={setPlain} />
      {error ? (
        <ViewerStatus>{t.files.loadFailed}</ViewerStatus>
      ) : text === null ? (
        <ViewerStatus>{t.files.loading}</ViewerStatus>
      ) : plain ? (
        <PlainText text={text} />
      ) : (
        <MarkdownRender md={text} />
      )}
    </div>
  );
}

/**
 * Просмотр .docx: конвертируем в markdown НА КЛИЕНТЕ (mammoth: docx→HTML,
 * turndown: HTML→md) и показываем тем же рендером, что и .md, с переключателем
 * Markdown/Текст. Обе либы грузятся динамически — только когда открыли ворд, —
 * чтобы не толстел общий бандл. Конвертация синхронная и лёгкая для обычных
 * документов; для больших — спиннер во время загрузки.
 */
function WordViewer({ url }: { url: string }) {
  const t = useT();
  const [plain, setPlain] = useState(false);
  const [md, setMd] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setMd(null);
    setError(false);
    (async () => {
      try {
        // Импортируем корневой "mammoth": Next/webpack по полю `browser` в
        // package.json сам подменяет Node-специфику на браузерную сборку, а типы
        // при этом подтягиваются (у подпути mammoth.browser их нет).
        const [{ default: mammoth }, { default: TurndownService }, buf] =
          await Promise.all([
            import("mammoth"),
            import("turndown"),
            fetch(url).then((r) =>
              r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))),
            ),
          ]);
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
        const turndown = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });
        if (alive) setMd(turndown.turndown(html));
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ModeToggle plain={plain} onChange={setPlain} />
      {error ? (
        <ViewerStatus>{t.files.loadFailed}</ViewerStatus>
      ) : md === null ? (
        <ViewerStatus>{t.files.loading}</ViewerStatus>
      ) : plain ? (
        <PlainText text={md} />
      ) : (
        <MarkdownRender md={md} />
      )}
    </div>
  );
}

/** Текстовый/код-файл — показываем в просмотрщике как текст. */
/** Бинарные контейнеры OOXML (pptx/xlsx/docx) — это ZIP-архивы, а НЕ текст.
 *
 * Ловушка: их mime содержит подстроку "xml" внутри `openxmlformats`
 * (application/vnd.openxmlformats-officedocument.presentationml.presentation),
 * поэтому проверка `mime.includes("xml")` ниже считала их текстовыми. Открытие
 * pptx в предпросмотре тянуло весь архив в TextViewer и вешало вкладку —
 * мегабайты бинаря в DOM, залипал даже ввод в чате. */
function isOoxmlBinary(mime: string): boolean {
  return mime.includes("officedocument") || mime.includes("openxmlformats");
}

function isTextMime(mime: string): boolean {
  if (isOoxmlBinary(mime)) return false;
  return (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript") ||
    mime.includes("yaml") ||
    mime.includes("toml") ||
    mime.includes("x-sh") ||
    mime.includes("x-python")
  );
}

function iconFor(mime: string): LucideIcon {
  if (mime === "application/pdf") return FileType;
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml"))
    return FileText;
  return FileIcon;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Расширение файла (верхний регистр, для меты). Пусто, если расширения нет. */
function extLabel(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toUpperCase() : "";
}

/** Имя без расширения (формат выносим в мету). */
function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
