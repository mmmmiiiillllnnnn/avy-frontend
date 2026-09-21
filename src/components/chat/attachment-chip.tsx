"use client";

import { X, FileText, FileType, File as FileIcon, AlertCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";
import { UploadRing } from "@/components/ui/progress-1";

/** Иконка по mime-типу (нет картинки-превью). */
export function iconForMime(mime: string): LucideIcon {
  if (mime === "application/pdf") return FileType;
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml"))
    return FileText;
  return FileIcon;
}

// Минимальная карта расширение -> mime для чипов (хватает, чтобы отличить
// картинку от прочего и выбрать иконку). Сервер отдаёт точный mime в /files.
const _EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  json: "application/json",
  xml: "application/xml",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

/** Угадать mime по расширению пути (для чипов из текста сообщения/истории). */
export function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return _EXT_MIME[ext] ?? "application/octet-stream";
}

/** Человекочитаемый размер. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ChipProps = {
  name: string;
  mime: string;
  /** Размер в байтах (для подписи). Необязателен в ленте. */
  size?: number;
  /** Сэмпл содержимого (первые символы) — для чипа вставленного текста. Если
   *  задан, показывается под именем вместо размера. */
  preview?: string;
  /** URL картинки для мини-превью (objectURL в композере / raw-URL в ленте). */
  thumbUrl?: string;
  /** Если задан — показываем крестик удаления (режим композера). */
  onRemove?: () => void;
  /** Статус загрузки в песочницу (композер): пока uploading — кольцо прогресса
   *  поверх превью, error — красный индикатор. done/undefined — обычный вид. */
  uploadStatus?: "uploading" | "done" | "error";
  /** Прогресс загрузки 0..1 (для кольца, при uploadStatus === "uploading"). */
  uploadProgress?: number;
  className?: string;
};

/**
 * Чип вложения: мини-превью (картинка) или иконка типа + имя/размер. Один и тот
 * же компонент в превью композера (с крестиком) и в пузыре пользователя (без).
 */
export function AttachmentChip({
  name,
  mime,
  size,
  preview,
  thumbUrl,
  onRemove,
  uploadStatus,
  uploadProgress = 0,
  className,
}: ChipProps) {
  const t = useT();
  const isImage = mime.startsWith("image/");
  const Icon = iconForMime(mime);
  // Чип вставленного текста: иконка + 2-3 строки превью содержимого (без имени).
  const isPasted = preview != null;
  const uploading = uploadStatus === "uploading";
  const uploadError = uploadStatus === "error";

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg border bg-background/60 py-1.5 pl-1.5 pr-2 text-left",
        isPasted && "max-w-[16rem]",
        className,
      )}
      title={isPasted ? preview : name}
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/50">
        {isImage && thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={name}
            loading="lazy"
            decoding="async"
            className={cn(
              "size-full object-cover transition-opacity",
              (uploading || uploadError) && "opacity-40",
            )}
          />
        ) : (
          <Icon
            className={cn(
              "size-4 text-muted-foreground transition-opacity",
              (uploading || uploadError) && "opacity-30",
            )}
          />
        )}
        {/* Пока грузится — кольцо прогресса поверх превью; ошибка — красный знак. */}
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <UploadRing value={uploadProgress} size={22} />
          </span>
        )}
        {uploadError && (
          <span className="absolute inset-0 flex items-center justify-center text-destructive">
            <AlertCircle className="size-4" />
          </span>
        )}
      </span>
      {isPasted ? (
        <span className="line-clamp-2 min-w-0 whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
          {preview}
        </span>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-[10rem] truncate text-xs font-medium">{name}</span>
          {size != null && (
            <span className="text-[10px] text-muted-foreground">
              {formatSize(size)}
            </span>
          )}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t.chat.removeAttachment(name)}
          className="ml-1 rounded p-0.5 text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
