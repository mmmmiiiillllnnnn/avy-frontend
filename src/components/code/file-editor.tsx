"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Save, Loader2, AlertCircle, CheckCircle2, Copy, Check, Brain } from "lucide-react";
import { useTheme } from "next-themes";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView, GutterMarker, gutter, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { EditorSelection, StateField, StateEffect } from "@codemirror/state";
import { fileIcon } from "@/components/code/file-icon";

type SaveState = "idle" | "saving" | "saved" | "error";

// ── Git gutter ────────────────────────────────────────────────────────────────

type GitDiffLines = { added: Set<number>; removed: Set<number> };

const setGitDiff = StateEffect.define<GitDiffLines>();

const gitDiffField = StateField.define<GitDiffLines>({
  create: () => ({ added: new Set(), removed: new Set() }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitDiff)) return e.value;
    }
    return value;
  },
});

class GitGutterMarker extends GutterMarker {
  constructor(readonly kind: "added" | "removed") { super(); }
  toDOM() {
    const el = document.createElement("div");
    el.style.cssText = `
      width: 3px;
      height: 100%;
      border-radius: 0;
      background: ${this.kind === "added" ? "#4ec994" : "#f14c4c"};
      margin-left: 1px;
    `;
    return el;
  }
}

const addedMarker = new GitGutterMarker("added");
const removedMarker = new GitGutterMarker("removed");

function gitGutterExtension() {
  return [
    gitDiffField,
    gutter({
      class: "cm-git-gutter",
      lineMarker(view, line) {
        const diff = view.state.field(gitDiffField);
        const lineNo = view.state.doc.lineAt(line.from).number;
        if (diff.added.has(lineNo)) return addedMarker;
        if (diff.removed.has(lineNo)) return removedMarker;
        return null;
      },
      // Всегда держим gutter видимым (не схлопывается до 0px)
      lineMarkerChange: (update) => update.transactions.some(tr => tr.effects.some(e => e.is(setGitDiff))),
      initialSpacer: () => addedMarker,
    }),
  ];
}

// ── Git overview ruler (маркеры поверх scrollbar как в VS Code) ───────────────
// Рисуем canvas поверх нативного scrollbar: view.dom — корень редактора,
// канвас абсолютно позиционирован справа на ширину scrollbar.

const SCROLLBAR_W = 14; // ширина нативного scrollbar (px)

function buildOverviewRuler() {
  return ViewPlugin.fromClass(
    class {
      canvas: HTMLCanvasElement;

      constructor(view: EditorView) {
        this.canvas = document.createElement("canvas");
        this.canvas.style.cssText = `
          position: absolute;
          top: 0;
          right: 0;
          width: ${SCROLLBAR_W}px;
          pointer-events: none;
          z-index: 20;
        `;
        // view.dom — корень .cm-editor, он уже position:relative из CodeMirror
        view.dom.appendChild(this.canvas);
        this.draw(view);
      }

      update(update: ViewUpdate) {
        const changed = update.transactions.some(tr =>
          tr.effects.some(e => e.is(setGitDiff))
        );
        if (changed || update.geometryChanged || update.viewportChanged) {
          this.draw(update.view);
        }
      }

      draw(view: EditorView) {
        const canvas = this.canvas;
        const totalLines = view.state.doc.lines;
        const diff = view.state.field(gitDiffField);

        // Высота видимой области редактора (не всего документа)
        const domH = view.dom.clientHeight;
        canvas.style.height = `${domH}px`;
        canvas.width = SCROLLBAR_W;
        canvas.height = domH;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, SCROLLBAR_W, domH);

        if (diff.added.size === 0 && diff.removed.size === 0) return;

        const lineH = Math.max(2, Math.floor(domH / totalLines));

        const drawLine = (lineNo: number, color: string) => {
          const y = Math.floor(((lineNo - 1) / totalLines) * domH);
          ctx.fillStyle = color;
          ctx.fillRect(2, y, SCROLLBAR_W - 4, lineH);
        };

        for (const ln of diff.added) drawLine(ln, "#4ec994");
        for (const ln of diff.removed) drawLine(ln, "#f14c4c");
      }

      destroy() {
        this.canvas.remove();
      }
    }
  );
}

const EXT_LANG: Record<string, () => ReturnType<typeof python>> = {
  py: python,
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  java,
  rs: rust,
  go,
  sql,
  html,
  css,
  json,
  xml,
  md: markdown,
  markdown,
  c: cpp,
  cpp,
  h: cpp,
  hpp: cpp,
  php,
  yaml,
  yml: yaml,
};

function langFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const factory = EXT_LANG[ext];
  return factory ? [factory()] : [];
}

/**
 * Полноценный файловый редактор (Avy Code). CodeMirror с подсветкой синтаксиса,
 * редактирование и сохранение через window.avyDesktop.writeFile → IPC → диск.
 * Поддерживает Ctrl+S / Cmd+S для быстрого сохранения.
 */
/** Файл лежит в tmp-каталогах агента (виртуальные /downloads или /tmp)? Такой
 *  путь не читается штатным avyDesktop.readFile (тот джейлит по workspace и не
 *  знает маппинг) — идём через code-agent мост, который знает threadId+каталог. */
function isTmpPath(p: string): boolean {
  const n = p.replace(/\\/g, "/");
  return n === "/downloads" || n.startsWith("/downloads/") || n === "/tmp" || n.startsWith("/tmp/");
}

/**
 * Файл проектной памяти (agent/memoryStore.ts)? Такие лежат в userData
 * (<...>/code-memory/<projectKey>/*.md) — ВНЕ корней workspace, поэтому штатный
 * avyDesktop.readFile отдаёт outside_root. Читаем их отдельным каналом
 * (codeAgent.readMemoryFile), который джейлит по каталогу памяти.
 *
 * Опознаём по сегменту каталога, а не по полному префиксу: userData различается
 * на Windows/macOS/Linux, а имя каталога задаётся нами (MEMORY_DIR_NAME).
 */
function isMemoryPath(p: string): boolean {
  return p.replace(/\\/g, "/").includes("/code-memory/");
}

export function FileEditor({
  path,
  threadId,
  searchText,
  highlightLines,
  onClose,
  onSave,
}: {
  path: string;
  threadId?: string;
  searchText?: string;
  highlightLines?: { start: number; end?: number };
  onClose: () => void;
  onSave?: (path: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);

  const originalRef = useRef<string>("");
  const contentRef = useRef<string>("");
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const searchTextRef = useRef<string | undefined>(searchText);
  const highlightLinesRef = useRef<{ start: number; end?: number } | undefined>(highlightLines);
  const gitDiffRef = useRef<GitDiffLines>({ added: new Set(), removed: new Set() });

  useEffect(() => {
    searchTextRef.current = searchText;
    highlightLinesRef.current = highlightLines;
  }, [searchText, highlightLines]);

  const name = path.split(/[\\/]/).pop() ?? path;
  const Icon = fileIcon(name);

  // Копировать полный путь файла. navigator.clipboard в Electron без HTTPS
  // недоступен — идём через IPC, с web-фолбэком (как в file-tree).
  const copyPath = useCallback(() => {
    if (window.avyDesktop?.writeClipboardText) {
      void window.avyDesktop.writeClipboardText(path);
    } else {
      void navigator.clipboard?.writeText(path);
    }
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1500);
  }, [path]);

  // Загрузка git diff для gutter — диспатчим сразу в view когда он готов
  useEffect(() => {
    const desktop = window.avyDesktop;
    if (!desktop?.gitDiffFile) return;
    // tmp-файлы (/downloads, /tmp) и файлы памяти (userData) не в репозитории —
    // git diff для них бессмыслен.
    if (isTmpPath(path) || isMemoryPath(path)) return;
    let cancelled = false;
    desktop.gitDiffFile(path).then((res) => {
      console.log("[git-gutter]", path, res);
      if (cancelled || "error" in res) return;
      const diff: GitDiffLines = {
        added: new Set(res.added),
        removed: new Set(res.removed),
      };
      gitDiffRef.current = diff;
      // rAF гарантирует что CodeMirror view уже смонтирован после рендера контента
      requestAnimationFrame(() => {
        const view = cmRef.current?.view;
        if (view) view.dispatch({ effects: setGitDiff.of(diff) });
      });
    });
    return () => { cancelled = true; };
  }, [path]);

  // Загрузка файла
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setLoadError(null);
    setIsDirty(false);
    setSaveState("idle");

    const desktop = window.avyDesktop;
    if (!desktop) {
      setLoadError("Редактор доступен только в десктоп-приложении.");
      return;
    }

    // tmp-файлы агента (/downloads, /tmp) читаются через code-agent мост — он
    // знает threadId и маппинг виртуального префикса на реальный os.tmpdir().
    // Штатный readFile их не найдёт (джейл по workspace).
    // Файл проектной памяти — свой канал (память лежит в userData, вне
    // workspace, штатный readFile вернул бы outside_root). Только чтение:
    // память ведёт агент (тула remember вместе с индексом), ручная правка
    // разошлась бы с индексом AVY.md.
    if (isMemoryPath(path)) {
      const bridge = desktop.codeAgent;
      if (!bridge?.readMemoryFile || !threadId) {
        setLoadError("Не удалось открыть файл памяти.");
        return;
      }
      bridge.readMemoryFile(threadId, path).then((res) => {
        if (cancelled) return;
        if ("content" in res) {
          originalRef.current = res.content;
          contentRef.current = res.content;
          setContent(res.content);
        } else {
          setLoadError("Не удалось открыть файл памяти.");
        }
      });
      return () => {
        cancelled = true;
      };
    }

    if (isTmpPath(path)) {
      const bridge = desktop.codeAgent;
      if (!bridge || !threadId) {
        setLoadError("Не удалось открыть файл.");
        return;
      }
      bridge.readTmpFile(threadId, path).then((res) => {
        if (cancelled) return;
        if ("content" in res) {
          originalRef.current = res.content;
          contentRef.current = res.content;
          setContent(res.content);
        } else if ("dataUrl" in res) {
          // Картинка: редактор её не рендерит, но показываем факт + превью нельзя
          // в CodeMirror — сообщаем, что это изображение (открывается как файл).
          setLoadError("Это изображение — откройте его как файл в системе.");
        } else if ("binary" in res) {
          setLoadError("Бинарный файл — предпросмотр недоступен.");
        } else {
          setLoadError("Не удалось открыть файл.");
        }
      });
      return () => {
        cancelled = true;
      };
    }

    desktop.readFile(path).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setLoadError(
          res.error === "too_large"
            ? "Файл слишком большой для редактирования (> 2 МБ)."
            : "Не удалось открыть файл.",
        );
      } else {
        originalRef.current = res.content;
        contentRef.current = res.content;
        setContent(res.content);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, threadId]);

  const handleChange = useCallback((value: string) => {
    contentRef.current = value;
    setIsDirty(value !== originalRef.current);
  }, []);

  // Память — только чтение: её ведёт агент (тула remember пишет факт ВМЕСТЕ со
  // строкой индекса). Ручная правка файла разошлась бы с индексом AVY.md, а править
  // индекс из UI — отдельный механизм, которого нет. Пользователь читает.
  const readOnly = isMemoryPath(path);

  const save = useCallback(async () => {
    const desktop = window.avyDesktop;
    if (!desktop || saveState === "saving" || readOnly) return;
    setSaveState("saving");
    const res = await desktop.writeFile(path, contentRef.current);
    if ("error" in res) {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    } else {
      originalRef.current = contentRef.current;
      setIsDirty(false);
      setSaveState("saved");
      onSave?.(path);
      setTimeout(() => setSaveState("idle"), 1500);
    }
  }, [path, saveState, readOnly]);

  // Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const applyHighlight = useCallback((view: EditorView, docText: string) => {
    // Применяем git diff к только что созданному view (если diff уже загрузился)
    if (gitDiffRef.current.added.size > 0 || gitDiffRef.current.removed.size > 0) {
      view.dispatch({ effects: setGitDiff.of(gitDiffRef.current) });
    }
    // Приоритет: searchText (для edit_file) > highlightLines (для read_file)
    const needle = searchTextRef.current;
    const lines = highlightLinesRef.current;
    
    if (needle) {
      // Поиск текста (edit_file)
      const idx = docText.indexOf(needle);
      if (idx === -1) return;
      const to = idx + needle.length;
      view.dispatch({
        selection: EditorSelection.range(idx, to),
        effects: EditorView.scrollIntoView(idx, { y: "center" }),
      });
      view.focus();
    } else if (lines) {
      // Переход к строкам (read_file)
      const linesArray = docText.split("\n");
      const startLine = Math.max(0, lines.start - 1); // 1-indexed -> 0-indexed
      const endLine = lines.end !== undefined ? Math.min(lines.end, linesArray.length) : startLine + 1;
      
      // Вычисляем позиции в документе
      let startPos = 0;
      for (let i = 0; i < startLine; i++) {
        startPos += linesArray[i].length + 1; // +1 для \n
      }
      
      let endPos = startPos;
      for (let i = startLine; i < endLine; i++) {
        endPos += linesArray[i].length + (i < endLine - 1 ? 1 : 0); // +1 для \n, кроме последней строки
      }
      
      view.dispatch({
        selection: EditorSelection.range(startPos, endPos),
        effects: EditorView.scrollIntoView(startPos, { y: "center" }),
      });
      view.focus();
    }
  }, []);

  const extensions = [
    ...langFor(name),
    EditorView.lineWrapping,
    ...gitGutterExtension(),
    buildOverviewRuler(),
  ];

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>
          {name}
          {isDirty && <span className="ml-1 text-muted-foreground">•</span>}
        </span>

        {/* Статус сохранения */}
        {saveState === "saving" && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
        {saveState === "saved" && (
          <CheckCircle2 className="size-4 text-emerald-500" />
        )}
        {saveState === "error" && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="size-3.5" /> Ошибка сохранения
          </span>
        )}

        {/* Копировать путь файла */}
        <button
          type="button"
          onClick={copyPath}
          title={path}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
            text-muted-foreground border border-transparent hover:bg-accent hover:text-foreground"
        >
          {copiedPath ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          {copiedPath ? "Скопировано" : "Копировать путь"}
        </button>

        {/* Кнопка Save — кроме памяти: её ведёт агент, руками не правим. */}
        {readOnly ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Brain className="size-3.5" /> Память агента · только чтение
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!isDirty || saveState === "saving" || content === null}
            title="Сохранить (Ctrl+S)"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
              border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="size-3.5" /> Сохранить
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="Закрыть"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loadError ? (
          <p className="p-4 text-sm text-muted-foreground">{loadError}</p>
        ) : content === null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загрузка…
          </div>
        ) : (
          <CodeMirror
            ref={cmRef}
            value={content}
            extensions={extensions}
            theme={isDark ? oneDark : undefined}
            // Память — только чтение (её ведёт агент). editable=false оставляет
            // выделение/копирование и подсветку, но запрещает ввод.
            editable={!readOnly}
            onChange={handleChange}
            onCreateEditor={(view) => applyHighlight(view, view.state.doc.toString())}
            height="100%"
            style={{ height: "100%", fontSize: "13px" }}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              indentOnInput: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
