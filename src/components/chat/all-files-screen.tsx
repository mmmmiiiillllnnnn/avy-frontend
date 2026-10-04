"use client";

import * as React from "react";
import {
  MessageSquare,
  Trash2,
  Download,
} from "lucide-react";
import {
  listThreads,
  fetchSessionFiles,
  deleteSessionFiles,
  sessionFileRawUrl,
  type ThreadInfo,
  type SessionFile,
} from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { FileCard } from "@/components/chat/file-card";
import { FileViewer, usePanelWidth } from "@/components/chat/files-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { downloadFile } from "@/lib/download-file";
import { useT } from "@/i18n/i18n-context";

/** Что показываем в правой панели предпросмотра: файл + его сессия (файлы в
 * разделе из РАЗНЫХ сессий, поэтому нужен threadId рядом с файлом). */
export type PreviewTarget = { threadId: string; file: SessionFile };

/** Короткая дата сессии по локали (напр. «14 июл. 2026»). */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Правильная форма слова «файл» для числа: ru — one/few/many, en — one/many. */
function pluralFile(n: number, forms: { one: string; few: string; many: string }): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (mod10 === 1 && mod100 !== 11) word = forms.one;
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = forms.few;
  else word = forms.many;
  return `${n} ${word}`;
}

/**
 * Секция одной сессии: заголовок = название сессии, ниже — мозаика файлов.
 * Файлы грузятся ЛЕНИВО при попадании секции в видимую область (скролл), а не
 * все сразу — из S3-снапшота сессии. Секции всегда раскрыты (не аккордеон).
 */
function SessionSection({
  thread,
  onOpenSession,
  onOpenPreview,
  previewPath,
}: {
  thread: ThreadInfo;
  onOpenSession: (id: string) => void;
  /** Открыть файл этой сессии в правой панели предпросмотра. */
  onOpenPreview: (threadId: string, file: SessionFile) => void;
  /** Путь файла, открытого сейчас в предпросмотре (для подсветки карточки),
   *  либо null, если предпросмотр не из этой сессии. */
  previewPath: string | null;
}) {
  const t = useT();
  const ref = React.useRef<HTMLElement>(null);
  const [files, setFiles] = React.useState<SessionFile[] | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  // Идёт удаление (одного файла или всех) — блокируем кнопки, чтобы не слать
  // повторные запросы. Множество путей «в процессе» гасит их карточки.
  const [deletingAll, setDeletingAll] = React.useState(false);
  const [deletingPaths, setDeletingPaths] = React.useState<Set<string>>(new Set());
  // Открыт ли наш попап подтверждения «удалить все» (вместо браузерного confirm).
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const title = thread.title || t.chat.newChat;

  React.useEffect(() => {
    const el = ref.current;
    if (!el || loaded) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loaded) {
          setLoaded(true);
          io.disconnect();
          fetchSessionFiles(thread.id, "outputs").then((f) => setFiles(f));
        }
      },
      { rootMargin: "300px" }, // подгружаем чуть заранее, до появления в кадре
    );
    io.observe(el);
    return () => io.disconnect();
  }, [thread.id, loaded]);

  // Удалить один файл: оптимистично убираем его из мозаики после успеха бэка.
  const handleDeleteOne = React.useCallback(
    async (path: string) => {
      setDeletingPaths((prev) => new Set(prev).add(path));
      try {
        await deleteSessionFiles(thread.id, [path], "outputs");
        setFiles((prev) => (prev ? prev.filter((f) => f.path !== path) : prev));
      } catch {
        // Не удалось — снимаем блокировку карточки, список не трогаем.
      } finally {
        setDeletingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [thread.id],
  );

  // Удалить все файлы сессии — подтверждение через наш попап (Modal). Пустой
  // paths → бэк чистит всю область outputs. После успеха список пуст → секция
  // скрывается (см. ниже).
  const doDeleteAll = React.useCallback(async () => {
    setConfirmOpen(false);
    setDeletingAll(true);
    try {
      await deleteSessionFiles(thread.id, undefined, "outputs");
      setFiles([]);
    } catch {
      // no-op: оставляем список как есть.
    } finally {
      setDeletingAll(false);
    }
  }, [thread.id]);

  // Сессию без файлов не показываем совсем. Но пока файлы не загружены
  // (files === null), нужен видимый placeholder с высотой — иначе
  // IntersectionObserver не сработает и ленивая загрузка не запустится.
  if (files !== null && files.length === 0) return null;

  return (
    <section ref={ref}>
      {files === null ? (
        // Плейсхолдер до загрузки — держит высоту, чтобы IO успел сработать.
        <div className="py-6 text-center text-xs text-muted-foreground">{t.files.loading}</div>
      ) : (
        <>
          {/* Заголовок сессии: иконка диалога + название (кликабельно → переход
              в сессию), справа дата/счётчик и кнопка «удалить все» (по ховеру).
              border-b на всей строке-обёртке → линия ровная и симметричная. */}
          <div className="group/head mb-2 flex items-center gap-2 border-b pb-2">
            <button
              type="button"
              onClick={() => onOpenSession(thread.id)}
              className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <MessageSquare className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                {title}
              </span>
            </button>
            <span className="shrink-0 text-xs text-muted-foreground">
              {[shortDate(thread.updated_at), pluralFile(files.length, t.files.fileForms)]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {/* «Удалить все» — видна постоянно (приглушённо), ярче на ховере.
                Открывает наш попап подтверждения, а не браузерный confirm. */}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={deletingAll}
              title={t.files.deleteAll}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
              <span>{deletingAll ? t.files.deleting : t.files.deleteAll}</span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {files.map((f) => (
              <FileCard
                key={f.path}
                file={f}
                href={sessionFileRawUrl(thread.id, f.path)}
                onOpen={() => onOpenPreview(thread.id, f)}
                active={previewPath === f.path}
                onDelete={() => handleDeleteOne(f.path)}
                busy={deletingAll || deletingPaths.has(f.path)}
              />
            ))}
          </div>

          {/* Попап подтверждения «удалить все» — в стиле приложения (Modal),
              а не браузерный confirm. */}
          <Modal
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            title={t.files.deleteAll}
          >
            <p className="text-sm text-muted-foreground">{t.files.deleteAllConfirm}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t.files.cancel}
              </button>
              <button
                type="button"
                onClick={doDeleteAll}
                className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {t.files.deleteAll}
              </button>
            </div>
          </Modal>
        </>
      )}
    </section>
  );
}

/**
 * Правая панель предпросмотра одного файла в разделе «Файлы». Переиспользует
 * FileViewer (картинка/PDF/текст) и usePanelWidth из панели файлов сессии, но:
 *  - показывает ТОЛЬКО предпросмотр (список — сам раздел слева, не здесь);
 *  - раздвигается до ПОЛОВИНЫ экрана (maxFraction = 1/2), своя ширина в LS.
 * Прижата к правому краю, ресайз — за левую границу.
 *
 * Рендерится НА УРОВНЕ воркспейса (сосед колонки хедер+тело), а не внутри
 * AllFilesScreen — чтобы, как панель файлов сессии, сдвигать и хедер, и тело.
 */
export function FilePreviewPanel({
  target,
  onClose,
}: {
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  const t = useT();
  const { width, dragging, handlers } = usePanelWidth(1 / 2, "avy:all-files-preview-width");
  const isMobile = useIsMobile();

  // Шапка и вьювер — общие для обоих видов.
  const body = (w: number | string) =>
    target && (
      <div style={{ width: w }} className="flex h-full min-h-0 flex-1 flex-col">
        {/* Шапка: имя файла + скачать + закрыть. */}
        {/* h-14 — как центральный хэдер чата: заголовки на одной линии.
            Без border-b — шапка на общей поверхности (утверждённый макет). */}
        <div className="flex h-14 shrink-0 items-center gap-1.5 pl-5 pr-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {target.file.name}
          </span>
          <button
            type="button"
            onClick={() =>
              void downloadFile(
                sessionFileRawUrl(target.threadId, target.file.path),
                target.file.name,
                target.file.mime,
              )
            }
            aria-label={t.files.download}
            title={t.files.download}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.files.closePanel}
            title={t.files.closePanel}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* key по пути — при смене файла ремонтируем вьювер (сброс зума/скролла). */}
        <FileViewer key={target.file.path} file={target.file} threadId={target.threadId} />
      </div>
    );

  // МОБИЛЬНЫЙ ВИД — шторкой ПОВЕРХ раздела, как панель файлов сессии
  // (files-panel.tsx) и мобильный сайдбар. Колонкой в потоке она отжимала
  // сетку файлов в полоску шириной в пару букв.
  if (isMobile) {
    return (
      <Sheet open={target !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent
          side="right"
          // Свой крестик Sheet не рисуем — он уже есть в шапке.
          showCloseButton={false}
          className="w-full gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-md"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{target?.file.name ?? t.files.closePanel}</SheetTitle>
            <SheetDescription>{target?.file.name ?? ""}</SheetDescription>
          </SheetHeader>
          {body("100%")}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {target && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={dragging ? { duration: 0 } : { duration: 0.22, ease: "easeInOut" }}
          className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border/60 text-sidebar-foreground"
        >
          {/* Ручка ресайза на левой границе (тонкая линия по ховеру). */}
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
          {body(width)}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/**
 * Полноэкранный раздел «Файлы» — тело области чата (хедер чата остаётся). Файлы
 * ВСЕХ сессий, сгруппированные секциями по сессиям (заголовок = название сессии),
 * мозаикой. Файлы каждой секции подгружаются лениво при скролле.
 */
export function AllFilesScreen({
  onOpenSession,
  onOpenPreview,
  preview,
}: {
  onOpenSession: (id: string) => void;
  /** Открыть файл в правой панели предпросмотра (панель живёт в воркспейсе). */
  onOpenPreview: (threadId: string, file: SessionFile) => void;
  /** Текущий предпросмотр (для подсветки активной карточки), либо null. */
  preview: PreviewTarget | null;
}) {
  const t = useT();
  const [threads, setThreads] = React.useState<ThreadInfo[] | null>(null);

  React.useEffect(() => {
    listThreads("chat").then((ts) => setThreads(ts));
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      {threads === null ? (
        <div className="py-8 text-center text-sm text-muted-foreground">{t.files.loading}</div>
      ) : threads.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">{t.files.noResults}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {threads.map((thr) => (
            <SessionSection
              key={thr.id}
              thread={thr}
              onOpenSession={onOpenSession}
              onOpenPreview={onOpenPreview}
              previewPath={preview?.threadId === thr.id ? preview.file.path : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
