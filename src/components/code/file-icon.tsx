"use client";

import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  FileType,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

// Сопоставление расширения файла с иконкой (грубо, как VS Code по группам).
const EXT_ICON: Record<string, LucideIcon> = {
  // код
  py: FileCode, js: FileCode, jsx: FileCode, ts: FileCode, tsx: FileCode,
  go: FileCode, rs: FileCode, java: FileCode, c: FileCode, cpp: FileCode,
  h: FileCode, sh: FileCode, rb: FileCode, php: FileCode, sql: FileCode,
  // данные
  json: FileJson, yaml: FileJson, yml: FileJson, toml: FileJson,
  // текст/доки
  md: FileText, txt: FileText, csv: FileText, log: FileText,
  // картинки
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage,
  svg: FileImage, webp: FileImage, ico: FileImage,
  // прочее
  pdf: FileType, docx: FileType, xlsx: FileType, pptx: FileType,
};

export function fileIcon(name: string): LucideIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_ICON[ext] ?? File;
}

export function folderIcon(open: boolean): LucideIcon {
  return open ? FolderOpen : Folder;
}
