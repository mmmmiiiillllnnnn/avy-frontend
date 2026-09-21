"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, FolderPlus, Pencil, Check, X, Plus } from "lucide-react";
import { FileTree, type FileTreeHandle } from "@/components/code/file-tree";
import { getThreadWorkspace, setThreadWorkspace } from "@/lib/code/code-api";
import type { RefObject } from "react";

export function CodeExplorer({
  roots,
  onRootsChange,
  threadId,
  onOpenFile,
  fileTreeRef,
}: {
  roots: string[];
  onRootsChange?: (roots: string[]) => void;
  threadId?: string;
  onOpenFile?: (path: string) => void;
  fileTreeRef?: RefObject<FileTreeHandle | null>;
}) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [pathInputOpen, setPathInputOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Только определяем, десктоп ли это (для кнопок выбора папок). Раньше здесь
    // же при пустом roots подтягивался desktop.getRoots() — ГЛОБАЛЬНЫЙ список
    // хоста (объединение ВСЕХ папок, что юзер когда-либо добавлял; он нужен
    // file-watcher'у, чтобы отдавать файлы любого треда). Из-за этого НОВЫЙ чат
    // при перезапуске приложения получал разом все папки и тут же привязывал их
    // к треду (эффект на [threadId], setThreadWorkspace add). Воркспейс — ПО
    // ТРЕДНО: page.tsx хранит {threadId → roots[]}, а сервер (getThreadWorkspace)
    // — источник правды; их и хватает для восстановления. Глобальный getRoots
    // сюда подмешивать нельзя — новый чат должен стартовать пустым.
    setIsDesktop(!!window.avyDesktop);
  }, []);

  // Папки, добавленные пока threadId был пустым (новый чат до первого сообщения).
  // Их нельзя было привязать к треде на сервере — держим здесь и доливаем, как
  // только id появится. Ref, а не state: не зависит от устаревшего замыкания и не
  // вызывает лишних ре-рендеров. Это и есть корень бага «репо → потом привет»:
  // без этого при пустом threadId привязка молча терялась и агент рыскал по джейлу.
  const pendingRoots = useRef<string[]>([]);

  // КРИТИЧНО: сообщаем хосту папки АКТИВНОЙ треды — вотчер следит РОВНО за ними,
  // и insideRoot() в main.js пускает файловые IPC (list-dir/read-file/...) к ним.
  // Это ЕДИНЫЙ канал синхронизации джейла вотчера с деревом. Полная ЗАМЕНА набора
  // (setActiveRoots), а не добавление: переключил треду → хост следует за ней, БЕЗ
  // накопления папок других тредов (раньше эффект лил addRoot по каждой папке и
  // глобальный джейл раздувался до /root, /Docker, OneDrive — вотчер поллил их все
  // и файлы появлялись «только после Refresh»). На хосте setActiveRoots идемпотентен
  // (тот же набор — без рестарта вотчера). Без этого при входе в старую сессию roots
  // восстановлены только во фронте, хост о них не знает, insideRoot отвергает путь
  // как outside_root, loadDir глотает ошибку в [] — и проект выглядит ПУСТЫМ.
  useEffect(() => {
    window.avyDesktop?.setActiveRoots?.(roots);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.join("|")]);

  // Синхронизация workspace треды с сервером (источник правды для промпта).
  // localStorage в page.tsx — лишь быстрый кэш для мгновенного UI.
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void getThreadWorkspace(threadId).then(({ dirs }) => {
      if (cancelled) return;
      // Доливаем отложенные папки (добавленные при пустом threadId) на сервер.
      const pending = pendingRoots.current;
      if (pending.length) {
        pendingRoots.current = [];
        for (const folder of pending) {
          if (!dirs.includes(folder)) void setThreadWorkspace(threadId, folder, "add");
        }
        return; // локальный список актуален (см. addRoot), сервер догоняем
      }
      if (dirs.length === 0 && roots.length > 0) {
        // Локально папки есть, на сервере пусто → привязываем их к треде.
        for (const folder of roots) void setThreadWorkspace(threadId, folder, "add");
      } else if (dirs.join("") !== roots.join("")) {
        // Существующая тред: серверный список — источник правды.
        onRootsChange?.(dirs);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  async function pickFolder() {
    const desktop = window.avyDesktop;
    if (!desktop) return;
    const folder = await desktop.pickFolder();
    if (!folder) return;
    void addRoot(folder);
  }

  async function addRoot(folder: string) {
    if (roots.includes(folder)) return;
    const next = [...roots, folder];
    // 1) Меняем roots треды — эффект на [roots] сам пошлёт setActiveRoots(next)
    //    хосту (джейл вотчера следует за деревом). Отдельный addRoot не нужен.
    onRootsChange?.(next);
    // 2) Привязываем папку к треде на сервере (источник правды промпта = джейл
    //    агента). Если threadId ещё пустой (новый чат до первого сообщения) —
    //    откладываем: эффект на [threadId] дольёт её, как только id появится. Так
    //    папка не теряется в сценарии «сначала репо, потом сообщение».
    if (threadId) void setThreadWorkspace(threadId, folder, "add");
    else pendingRoots.current = [...pendingRoots.current, folder];
  }

  function removeRoot(folder: string) {
    const next = roots.filter((r) => r !== folder);
    // Эффект на [roots] пошлёт setActiveRoots(next) хосту — отдельный removeRoot
    // не нужен. На сервере (джейл агента) отвязываем явно.
    onRootsChange?.(next);
    if (threadId) void setThreadWorkspace(threadId, folder, "remove");
  }

  function openPathInput(_mode: "add" | "replace" = "add", prefill = "") {
    setInputValue(prefill || "");
    setSuggestions([]);
    setPathInputOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function closePathInput() {
    setPathInputOpen(false);
    setSuggestions([]);
  }

  async function submitPath() {
    const p = inputValue.trim();
    if (!p) { closePathInput(); return; }
    const desktop = window.avyDesktop;
    if (desktop?.setRoot) {
      const res = await desktop.setRoot(p);
      if ("error" in res) {
        setInputValue(`Ошибка: ${res.error}`);
        return;
      }
    }
    void addRoot(p);
    closePathInput();
  }

  async function fetchSuggestions(val: string) {
    const desktop = window.avyDesktop;
    if (!desktop || !val) { setSuggestions([]); return; }
    const isUnix = val.startsWith("/");
    const isWin = /^[A-Za-z]:[/\\]/.test(val);
    if (!isUnix && !isWin) { setSuggestions([]); return; }
    const sep = isUnix ? "/" : "\\";
    const lastSep = Math.max(val.lastIndexOf("/"), val.lastIndexOf("\\"));
    const parentDir = lastSep > 0 ? val.slice(0, lastSep) || sep : sep;
    const prefix = val.slice(lastSep + 1).toLowerCase();
    const res = await desktop.listDir(parentDir);
    if ("error" in res) { setSuggestions([]); return; }
    const dirs = res.items
      .filter((e) => e.isDir && e.name.toLowerCase().startsWith(prefix))
      .map((e) => e.path)
      .slice(0, 8);
    setSuggestions(dirs);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInputValue(val);
    if (suggestTimeout.current) clearTimeout(suggestTimeout.current);
    suggestTimeout.current = setTimeout(() => void fetchSuggestions(val), 120);
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { void submitPath(); return; }
    if (e.key === "Escape") { closePathInput(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      const desktop = window.avyDesktop;
      if (desktop?.readClipboardText) {
        e.preventDefault();
        const text = await desktop.readClipboardText();
        if (text) { const t = text.trim(); setInputValue(t); void fetchSuggestions(t); }
      }
    }
  }

  function applySuggestion(p: string) {
    const sep = p.startsWith("/") ? "/" : "\\";
    const withSep = p.endsWith(sep) ? p : p + sep;
    setInputValue(withSep);
    setSuggestions([]);
    void fetchSuggestions(withSep);
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  if (!isDesktop) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        Проводник файлов доступен только в десктоп-приложении Avy.
      </div>
    );
  }

  // Inline path input
  if (pathInputOpen) {
    return (
      <div className="flex flex-col px-2 py-3 gap-1">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={inputValue}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="/home/user/project"
            spellCheck={false}
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <button type="button" onClick={() => void submitPath()} className="rounded p-1 text-emerald-600 hover:bg-accent" title="Добавить">
            <Check className="size-3.5" />
          </button>
          <button type="button" onClick={closePathInput} className="rounded p-1 text-muted-foreground hover:bg-accent" title="Отмена">
            <X className="size-3.5" />
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="rounded border bg-popover shadow-sm">
            {suggestions.map((s) => {
              const name = s.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? s;
              return (
                <button key={s} type="button" onClick={() => applySuggestion(s)}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-xs hover:bg-accent truncate">
                  <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                  {name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Пустой workspace
  if (roots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
        <FolderOpen className="size-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">Папка проекта не выбрана</p>
        <button type="button" onClick={pickFolder}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
          <FolderPlus className="size-3.5" /> Выбрать папку
        </button>
        <button type="button" onClick={() => openPathInput()}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
          <Pencil className="size-3.5" /> Ввести путь
        </button>
      </div>
    );
  }

  // Workspace с одной или несколькими папками
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 pb-1">
        <span className="flex-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium px-1">
          Workspace
        </span>
        <button type="button" onClick={pickFolder}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="Добавить папку (диалог)">
          <FolderPlus className="size-3.5" />
        </button>
        <button type="button" onClick={() => openPathInput()}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="Добавить папку (ввести путь)">
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* Одно дерево со всеми папками workspace */}
      <div className="min-h-0 flex-1">
        <FileTree
          ref={fileTreeRef ?? null}
          roots={roots}
          onOpenFile={(p) => onOpenFile?.(p)}
          onRemoveRoot={removeRoot}
        />
      </div>
    </div>
  );
}
