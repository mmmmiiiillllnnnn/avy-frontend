"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { fileIcon } from "@/components/code/file-icon";

// Расширение → язык для подсветки в fence Streamdown.
const EXT_LANG: Record<string, string> = {
  py: "python", js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
  go: "go", rs: "rust", java: "java", c: "c", cpp: "cpp", h: "c",
  sh: "bash", rb: "ruby", php: "php", sql: "sql",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", html: "html", css: "css", xml: "xml",
};

function langOf(name: string): string {
  return EXT_LANG[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

/**
 * Просмотр файла поверх ленты чата (Avy Code). Читает содержимое через
 * window.avyDesktop.readFile, рендерит с подсветкой (Streamdown как код-блок).
 * Markdown-файлы показываем как есть (рендер разметки), остальные — как код.
 */
export function FileViewer({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = path.split(/[\\/]/).pop() ?? path;
  const Icon = fileIcon(name);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    const desktop = window.avyDesktop;
    if (!desktop) {
      setError("Просмотр доступен только в десктоп-приложении.");
      return;
    }
    desktop.readFile(path).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setError(
          res.error === "too_large"
            ? "Файл слишком большой для просмотра."
            : "Не удалось открыть файл.",
        );
      } else {
        setContent(res.content);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const isMarkdown = ext === "md";
  const lang = langOf(name);

  // Для кода оборачиваем в fence — Streamdown даст подсветку и кнопку копирования.
  const rendered =
    content == null
      ? ""
      : isMarkdown
        ? content
        : "```" + lang + "\n" + content + "\n```";

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>
          {name}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="Закрыть"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : content == null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загрузка…
          </div>
        ) : (
          <MessageResponse className="mx-auto max-w-3xl text-sm">
            {rendered}
          </MessageResponse>
        )}
      </div>
    </div>
  );
}
