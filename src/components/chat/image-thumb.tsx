"use client";

// Миниатюра прочитанной картинки и распознавание таких шагов.
//
// Отдельный модуль, а не часть thinking-panel: то же самое нужно раскрытой
// ленте (tool-steps), а она уже импортирует thinking-panel — обратный импорт
// замкнул бы цикл. Так же в своё время был вынесен tool-icons.

import { memo } from "react";
import { sessionFileRawUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ThoughtStep } from "@/lib/chat-streams";

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
]);

/** Шаг чтения тула (сужение ThoughtStep). */
type ToolStep = Extract<ThoughtStep, { kind: "tool" }>;

/** Путь к файлу из аргументов read_file (или ""). */
export function imagePath(s: ToolStep): string {
  const a = s.args ?? {};
  return String(a.file_path ?? a.path ?? "");
}

/**
 * Это чтение КАРТИНКИ? (read_file с картиночным расширением).
 *
 * Проверку `state === "streaming"` тут держать НЕЛЬЗЯ: пока путь дозревает,
 * шаг рисовался строкой «Читаю файл /outputs/photo.png», и только после
 * дозревания подменялся миниатюрой — пользователь видел сначала путь, потом
 * картинку. Расширение известно ещё в недописанном пути, поэтому решаем сразу
 * и показываем только превью.
 */
export function isImageRead(s: ThoughtStep): s is ToolStep {
  if (s.kind !== "tool" || s.name !== "read_file") return false;
  const p = imagePath(s);
  const i = p.lastIndexOf(".");
  return i > 0 && IMAGE_EXT.has(p.slice(i + 1).toLowerCase());
}

/** Миниатюра прочитанной картинки — под именем файла, своим шагом ленты. */
export const ImageThumb = memo(function ImageThumb({
  path,
  threadId,
  className,
}: {
  path: string;
  threadId: string;
  className?: string;
}) {
  const name = path.split("/").pop() || path;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sessionFileRawUrl(threadId, path)}
      alt={name}
      title={name}
      loading="lazy"
      decoding="async"
      className={cn(
        "fade-in-0 zoom-in-95 animate-in h-16 w-auto max-w-full rounded-md border border-border/60 bg-muted object-cover",
        className,
      )}
    />
  );
});
