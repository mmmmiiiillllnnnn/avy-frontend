"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  FileText,
  FileType,
  File as FileIcon,
  Trash2,
  Download,
  MoreVertical,
  type LucideIcon,
} from "lucide-react";
import type { SessionFile } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/download-file";
import { useT } from "@/i18n/i18n-context";

// Миниатюра PDF (браузерный рендер) — как в панели файлов сессии.
const PdfThumb = dynamic(
  () => import("@/components/chat/pdf-viewer").then((m) => m.PdfThumb),
  { ssr: false, loading: () => null },
);

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extLabel(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toUpperCase() : "";
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function iconFor(mime: string): LucideIcon {
  if (mime === "application/pdf") return FileType;
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml"))
    return FileText;
  return FileIcon;
}

/**
 * Единая карточка-плитка файла: превью сверху (картинка/первая страница PDF/
 * иконка) + имя/мета, а справа — кнопка «⋮» с меню «Скачать / Удалить». Правый
 * клик по карточке тоже открывает это меню.
 *
 * Переиспользуется и в разделе «Файлы» (файлы сессий), и в файлах регулярной
 * задачи — источник байтов и обработчик удаления приходят пропсами, поэтому
 * карточка не знает, сессия это или задача.
 *
 *  - href      — raw-URL файла (для превью-картинки, PDF-миниатюры и скачивания);
 *  - onOpen    — клик по карточке (открыть предпросмотр);
 *  - onDelete  — пункт «Удалить файл»;
 *  - active    — файл сейчас открыт в предпросмотре (подсветка);
 *  - busy      — идёт удаление (гасим карточку, блокируем пункт).
 */
export function FileCard({
  file,
  href,
  onOpen,
  onDelete,
  active = false,
  busy = false,
  dense = false,
}: {
  file: SessionFile;
  href: string;
  onOpen: () => void;
  onDelete: () => void;
  active?: boolean;
  busy?: boolean;
  /** Компактный вид (узкие плитки): более плоское превью и тесная подпись,
   *  чтобы в ограниченный по высоте блок влезало 2 ряда. */
  dense?: boolean;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const isImage = file.mime.startsWith("image/");
  const isPdf = file.mime === "application/pdf";
  const Icon = iconFor(file.mime);

  // Скачать: тот же raw-URL. На iOS уходит в системный «Поделиться», на
  // остальных — обычное сохранение файла (см. lib/download-file).
  const download = () => {
    void downloadFile(href, file.name, file.mime);
  };

  return (
    // Карточка открывает предпросмотр (не новую вкладку). Не <button>, а div
    // role="button": внутри лежит кнопка «⋮» (триггер меню), а button-в-button —
    // невалидный HTML. Enter/Space дублируют клик для доступности.
    <div
      role="button"
      tabIndex={0}
      title={file.path}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      // Правый клик — открыть меню (подавляем нативное). mousedown-capture правой
      // кнопки глушит outside-close base-ui (иначе меню закрывалось бы сразу).
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      onPointerDownCapture={(e) => {
        if (e.button === 2) e.stopPropagation();
      }}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-background/40 text-left transition-colors hover:border-foreground/30 hover:bg-sidebar-accent aria-expanded:border-foreground/30 aria-expanded:bg-sidebar-accent",
        active && "border-primary/50 bg-sidebar-accent ring-1 ring-primary/40",
        busy && "pointer-events-none opacity-50",
      )}
      aria-expanded={menuOpen}
    >
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden bg-muted/40",
          // dense: фикс-высота превью (не аспект), чтобы карточка могла тянуться
          // в ширину, заполняя блок, но НЕ росла в высоту (влезают 2 ряда).
          dense ? "h-16" : "aspect-[4/3]",
        )}
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={href} alt={file.name} loading="lazy" className="size-full object-cover" />
        ) : isPdf ? (
          <div className="size-full overflow-hidden [&_canvas]:size-full [&_canvas]:object-cover">
            <PdfThumb url={href} width={220} />
          </div>
        ) : (
          <Icon className={cn("text-muted-foreground", dense ? "size-6" : "size-8")} />
        )}
      </div>
      <div className={cn("flex items-center gap-1", dense ? "p-1.5" : "p-2")}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("truncate font-medium", dense ? "text-[11px] leading-tight" : "text-xs")}>
            {stripExt(file.name)}
          </span>
          <span className="text-[10px] leading-tight text-muted-foreground">
            {[extLabel(file.name), humanSize(file.size)].filter(Boolean).join(" · ")}
          </span>
        </div>

        {/* Меню действий файла: открывается кнопкой «⋮» (видимый триггер) ИЛИ
            правым кликом по карточке (общий menuOpen). */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={t.files.moreActions}
            title={t.files.moreActions}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] hover:bg-sidebar-border hover:text-foreground group-hover:opacity-100 aria-expanded:opacity-100 aria-expanded:bg-sidebar-border aria-expanded:text-foreground focus-visible:opacity-100"
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              className="gap-2"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                download();
              }}
            >
              <Download className="size-4" />
              {t.files.download}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="gap-2"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="size-4" />
              {t.files.deleteFile}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
