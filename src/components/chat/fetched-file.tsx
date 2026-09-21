"use client";

import { FileText, FileImage, FileType } from "lucide-react";
import { sessionFileRawUrl } from "@/lib/api";
import { useFileChip } from "@/components/chat/file-chip-context";
import type { FetchedFile as FetchedFileData } from "@/lib/chat-streams";

/** Человекочитаемый размер файла. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(ct: string): boolean {
  return ct.startsWith("image/");
}

/** Иконка по типу скачанного файла. */
function fileIcon(ct: string) {
  if (isImage(ct)) return FileImage;
  if (ct === "application/pdf") return FileType;
  return FileText;
}

/**
 * Карточка файла, скачанного web_fetch — в том же стиле, что блок источников.
 * Для картинок показываем миниатюру (через raw-эндпоинт песочницы), для прочего
 * — иконка + имя + тип/размер. Несворачиваемая.
 */
export function FetchedFile({
  file,
  threadId,
}: {
  file: FetchedFileData;
  threadId: string;
}) {
  const name = file.path.split("/").pop() || file.path;
  const rawUrl = sessionFileRawUrl(threadId, file.path);
  const Icon = fileIcon(file.content_type);
  // Открываем в правой панели предпросмотра (как плашки файлов в тексте), а не
  // в новой вкладке. openInPanel сам берёт активный тред — а FetchedFile всегда
  // рендерится в открытом чате, так что это тот же threadId.
  const api = useFileChip();

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background p-1">
      <button
        type="button"
        onClick={() => api?.openInPanel(file.path)}
        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/60"
      >
        {isImage(file.content_type) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rawUrl}
            alt={name}
            loading="lazy"
            decoding="async"
            className="size-12 shrink-0 rounded-md border border-border object-cover"
          />
        ) : (
          <Icon className="size-8 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-foreground">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {file.content_type} · {humanSize(file.bytes)}
          </span>
        </span>
      </button>
    </div>
  );
}

/**
 * Компактная карточка скачанного файла для ЖИВОГО превью (свёрнутый блок): та же
 * суть, что у FetchedFile, но одной строкой без рамки — в узком окне полная
 * карточка с бордюром и mt-2 распирала бы ленту. Картинка — мини-превью, прочее
 * — иконка. URL в превью не показываем: у человека он читается как шум.
 */
export function MiniFetchedFile({
  file,
  threadId,
}: {
  file: FetchedFileData;
  threadId: string;
}) {
  const name = file.path.split("/").pop() || file.path;
  const rawUrl = sessionFileRawUrl(threadId, file.path);
  const Icon = fileIcon(file.content_type);
  return (
    <div className="mt-1 flex items-center gap-2 text-sm leading-relaxed text-muted-foreground">
      {isImage(file.content_type) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={rawUrl}
          alt={name}
          loading="lazy"
          decoding="async"
          className="size-8 shrink-0 rounded-md border border-border/60 bg-muted object-cover"
        />
      ) : (
        <Icon className="size-4 shrink-0 text-muted-foreground/70" />
      )}
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </div>
  );
}
