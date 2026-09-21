"use client";

import {
  FileText,
  FileType,
  FileImage,
  File as FileIcon,
  Eye,
  Download,
} from "lucide-react";
import type { ReactNode } from "react";
import { useFileChip } from "@/components/chat/file-chip-context";
import { fileTypeIcon } from "@/components/chat/file-type-icons";
import { downloadFile } from "@/lib/download-file";
import { useT } from "@/i18n/i18n-context";

/** Человекочитаемый размер. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Расширение файла в нижнем регистре (без точки). */
function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Имя без расширения (формат показываем отдельно в мете). */
function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

/** Растровая/векторная картинка по имени файла — то, что `<img>` покажет.
 *  Всё прочее (pdf, docx, html…) в `<img>` даёт пустую рамку. */
export function isImageFileName(name: string): boolean {
  const i = name.lastIndexOf(".");
  return i > 0 && IMAGE_EXT.has(name.slice(i + 1).toLowerCase());
}
const TEXT_EXT = new Set([
  "txt", "md", "json", "xml", "yaml", "yml", "toml", "csv", "log",
  "js", "ts", "tsx", "jsx", "py", "sh", "html", "css",
]);

// Монохромный fallback (lucide), когда для расширения нет цветной бренд-иконки.
// Возвращаем готовый JSX-элемент (не компонент в переменной) — присваивание
// компонента Capitalized-переменной в рендере ловит react-hooks/static-components.
function fallbackIcon(e: string): ReactNode {
  const cls = "size-5 text-primary";
  if (IMAGE_EXT.has(e)) return <FileImage className={cls} />;
  if (e === "pdf") return <FileType className={cls} />;
  if (TEXT_EXT.has(e)) return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}

/** Декод возможного percent-encoding в имени (кириллица из URL-путей). */
function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * Плашка файла в тексте сообщения — замена «голой» ссылки на файл сессии.
 * Иконка-квадрат + имя + тип·размер, справа явные кнопки «Открыть» (предпросмотр
 * в правой панели) и «Скачать» (прямое скачивание, не открытие браузером).
 *
 * Действия берёт из FileChipContext (панелью управляет ChatWorkspace). Без
 * провайдера (теоретически) — деградирует до обычной ссылки-скачивания.
 */
export function FileChip({ path, name }: { path: string; name: string }) {
  const t = useT();
  const api = useFileChip();
  const e = ext(name);
  // Имя БЕЗ расширения — формат показываем отдельно в мете снизу, чтобы не
  // дублировать. Кириллицу декодируем (percent-encoding из URL-путей).
  const displayName = stripExt(decodeName(name));
  // Цветная бренд-иконка типа (vscode-icons) по расширению; для неизвестных —
  // монохромный lucide-fallback.
  const brand = fileTypeIcon(e);
  const size = api?.sizeFor(path);
  const rawUrl = api?.rawUrl(path);
  // Мета: ФОРМАТ · размер (размер — из списка сессии, в markdown-ссылке его нет).
  const meta = [e.toUpperCase(), size != null ? humanSize(size) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    // inline-flex, а не flex: плашка живёт в текстовом потоке — модель пишет
    // пункт целиком, `- [файл](/outputs/x) — описание`. Блочный flex занимал
    // всю ширину и разрывал пункт на три строки: маркер, карточка, описание.
    // align-middle — описание рядом идёт по центру карточки, а не по её верху.
    <span className="my-1 inline-flex max-w-full items-center gap-3 rounded-xl border bg-background p-2.5 align-middle not-prose">
      {brand ? (
        // Брендовый логотип (vscode-icons) несёт свои цвета и форму — показываем
        // его НАПРЯМУЮ, без квадрата-подложки, и крупнее.
        <svg
          viewBox={`0 0 ${brand.w} ${brand.h}`}
          className="size-10 shrink-0"
          role="img"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: brand.body }}
        />
      ) : (
        // Монохромный lucide-fallback — на мягкой primary-подложке (нужен фон,
        // иначе одноцветная иконка теряется).
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          {fallbackIcon(e)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
        {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => api?.openInPanel(path)}
          title={t.files.open}
          aria-label={t.files.open}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Eye className="size-4" />
        </button>
        <button
          type="button"
          // Без FileChipContext rawUrl не построить — кнопку гасим (раньше на её
          // месте была <a> без href, которая молча ничего не делала).
          disabled={!rawUrl}
          onClick={() => rawUrl && void downloadFile(rawUrl, decodeName(name))}
          title={t.files.download}
          aria-label={t.files.download}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Download className="size-4" />
        </button>
      </span>
    </span>
  );
}
