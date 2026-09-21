"use client";

import * as React from "react";
import type { SessionFile } from "@/lib/api";

/**
 * Канал от плашки файла (FileChip, рендерится глубоко внутри Streamdown в тексте
 * сообщения) до ChatWorkspace, который управляет правой панелью «Файлы».
 *
 * - openInPanel(path): открыть панель и показать предпросмотр конкретного файла.
 * - sizeFor(path): размер файла из уже загруженного списка сессии (для меты на
 *   плашке), если файл там есть — в markdown-ссылке размера нет.
 *
 * Пробросить колбэк через пропсы Streamdown нельзя (он не форвардит произвольные
 * пропсы в кастомные компоненты), поэтому — через контекст.
 */
export type FileChipApi = {
  openInPanel: (path: string) => void;
  sizeFor: (path: string) => number | undefined;
  /** Прямая raw-ссылка на файл (для скачивания) — плашка не знает threadId. */
  rawUrl: (path: string) => string;
};

const FileChipContext = React.createContext<FileChipApi | null>(null);

export function FileChipProvider({
  value,
  children,
}: {
  value: FileChipApi;
  children: React.ReactNode;
}) {
  return <FileChipContext.Provider value={value}>{children}</FileChipContext.Provider>;
}

export function useFileChip(): FileChipApi | null {
  return React.useContext(FileChipContext);
}

/** Индекс размеров по path из списка файлов сессии — для sizeFor. */
export function sizeIndex(files: SessionFile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of files) m.set(f.path, f.size);
  return m;
}
