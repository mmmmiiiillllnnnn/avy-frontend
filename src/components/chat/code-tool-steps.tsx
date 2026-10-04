"use client";

import { memo, useState } from "react";
import { useConnectorLabels } from "@/lib/connector-registry";
import { ChevronRight, Loader2, FileText, Square, CheckSquare, Search, FolderSearch } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { EditFileDiff } from "@/components/chat/edit-diff";
import { SearchSources } from "@/components/chat/search-sources";
import { FetchedFile } from "@/components/chat/fetched-file";
import { describeTool } from "@/lib/tool-labels";
import { detectLocale } from "@/lib/locale";
import type { ThoughtStep } from "@/lib/chat-streams";

const locale = detectLocale();

/**
 * Имя MCP-тула приходит склеенным: `mcp__<server>__<tool>` (см.
 * apps/code-cli/src/agent/mcpMiddleware.ts). Сырое имя в ленте выглядит мусорно
 * («Mcp  Context7  query docs»), поэтому разбираем на сервер и тул и рисуем их
 * раздельно. Живёт ЗДЕСЬ, в кодерском компоненте: общий tool-labels.ts делят с
 * обычным чатом, его поведение менять не нужно.
 *
 * Имя сервера задаёт пользователь, в нём самом могут быть «_», поэтому режем по
 * ПОСЛЕДНЕМУ разделителю «__»: всё до него — сервер, после — тул.
 */
function parseMcpName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const sep = rest.lastIndexOf("__");
  if (sep <= 0) return { server: rest, tool: rest };
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

/**
 * Имя файла из пути — по ОБОИМ разделителям.
 *
 * `split("/")` не хватало: на native Windows (и для файлов проектной памяти в
 * userData) пути приходят с обратными слэшами — `C:\Users\…\факт.md` не резался
 * и в ленту уезжал весь абсолютный путь, хотя у остальных тулов видно только
 * имя. Хвостовой разделитель сбрасываем, чтобы `/a/b/` дало `b`, а не пустую
 * строку; если имени не осталось — отдаём путь как есть.
 */
function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** `query-docs` / `query_docs` → «Query docs». */
function humanizeToolName(tool: string): string {
  return tool.replace(/[-_]+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
}

/** Красиво отформатировать JSON-подобное значение аргумента для показа. */
function formatArgValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Вывод MCP-тула — это почти всегда JSON-строка (протокол отдаёт content-блоки,
 * mcpMiddleware склеивает их текст). Если это распарсиваемый JSON — покажем с
 * отступами, иначе как есть.
 */
function prettifyOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

/** Подпись «N файл(ов)» с учётом локали и русского склонения. */
function filesCount(n: number): string {
  if (locale === "en") return `${n} ${n === 1 ? "file" : "files"}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "файл"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? "файла"
    : "файлов";
  return `${n} ${word}`;
}

export const CodeToolSteps = memo(function CodeToolSteps({
  steps,
  isRunning,
  threadId,
  onOpenFile,
  onOpenMemory,
}: {
  steps: ThoughtStep[];
  isRunning: boolean;
  threadId?: string;
  onOpenFile?: (path: string, searchText?: string, highlightLines?: { start: number; end?: number }) => void;
  /** Открыть файл проектной памяти (плашка remember). Отдельно от onOpenFile:
   *  память лежит вне workspace и читается своим каналом (readMemoryFile). */
  onOpenMemory?: (path: string) => void;
}) {
  const toolSteps = steps.filter((s) => s.kind === "tool");
  if (toolSteps.length === 0) return null;

  return (
    <div className="flex flex-col divide-y divide-border/20">
      {toolSteps.map((step, i) => {
        if (step.kind !== "tool") return null;
        const isLast = i === toolSteps.length - 1;
        const active = isRunning && isLast;
        return (
          <CodeToolStep
            key={step.id ?? i}
            step={step}
            active={active}
            threadId={threadId}
            onOpenFile={onOpenFile}
            onOpenMemory={onOpenMemory}
          />
        );
      })}
    </div>
  );
});

const CodeToolStep = memo(function CodeToolStep({
  step,
  active,
  threadId,
  onOpenFile,
  onOpenMemory,
}: {
  step: Extract<ThoughtStep, { kind: "tool" }>;
  active: boolean;
  threadId?: string;
  onOpenFile?: (path: string, searchText?: string, highlightLines?: { start: number; end?: number }) => void;
  onOpenMemory?: (path: string) => void;
}) {
  // Названия инструментов коннекторов приходят с каталогом — перерисовать по приходу.
  useConnectorLabels();
  const [expanded, setExpanded] = useState(() => step.name === "bash");
  const { title } = describeTool(step.name, step.args, locale);
  const streaming = step.state === "streaming";
  const result = step.result;
  const hasOutput = result !== undefined;
  const isEdit = step.name === "edit_file";
  const isWrite = step.name === "write_file";
  const isRead = step.name === "read_file";
  const isLs = step.name === "ls";
  const isGrep = step.name === "grep";
  const isGlob = step.name === "glob";
  const isSearch = step.name === "web_search";
  const isFetch = step.name === "web_fetch";
  const isBash = step.name === "bash";
  const isTask = step.name === "task";
  const isWriteTodos = step.name === "write_todos";
  const isRemember = step.name === "remember";
  // Тул подключённого MCP-сервера (mcp__<server>__<tool>) — null для обычных.
  const mcp = parseMcpName(step.name);
  // Спавн сабагента (тула task): короткая подпись задачи (description) в плашке +
  // полный бриф (prompt) аккуратным блоком под ней. Сам ход сабагента в чат НЕ
  // идёт — он виден в панели «Фоновые задачи».
  const taskDesc = isTask ? String(step.args?.description ?? "") : "";
  const taskPrompt = isTask ? String(step.args?.prompt ?? "") : "";
  const filePath = typeof step.args?.file_path === "string" ? step.args.file_path
    : typeof step.args?.path === "string" ? step.args.path : null;
  const oldString = isEdit ? String(step.args?.old_string ?? "") : "";
  const newString = isEdit ? String(step.args?.new_string ?? "") : "";
  const writeContent = isWrite ? String(step.args?.content ?? "") : "";
  const bashCommand = isBash ? String(step.args?.command ?? "") : "";
  const todos = isWriteTodos && Array.isArray(step.args?.todos) ? step.args.todos : [];
  const hasDiff = isEdit && (oldString || newString);
  const isRejectedOutput = hasOutput && !result.ok && result.output.startsWith("User rejected");
  const hasContent = hasDiff || (hasOutput && !isRejectedOutput && result.output.trim().length > 0);
  
  // Для read_file: извлекаем offset и limit для отображения диапазона строк
  const offset = isRead && typeof step.args?.offset === "number" ? step.args.offset : 0;
  const limit = isRead && typeof step.args?.limit === "number" ? step.args.limit : undefined;
  const hasLineRange = isRead && limit !== undefined;
  const lineStart = offset + 1; // offset 0-indexed, показываем 1-indexed
  const lineEnd = limit !== undefined ? offset + limit : undefined;

  const status: "running" | "ok" | "error" | "pending" =
    active && !hasOutput ? "running"
    : hasOutput ? (result.ok ? "ok" : "error")
    : "pending";

  // write_file — заголовок со ссылкой + контент стримится
  if (isWrite && (writeContent || streaming)) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span>{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}:</span>
          {filePath && onOpenFile && (
            <button
              type="button"
              onClick={() => onOpenFile(filePath)}
              className="inline-flex cursor-pointer items-center gap-1 font-mono text-xs text-primary hover:underline truncate max-w-[260px]"
            >
              <FileText className="size-3 shrink-0" />
              {baseName(filePath)}
            </button>
          )}
        </div>
        {writeContent && (
          <pre className="mt-0.5 mb-1 w-full rounded border border-border/60 bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
            {writeContent}
          </pre>
        )}
      </div>
    );
  }

  // edit_file — заголовок со ссылкой + диф сразу виден
  if (isEdit && hasDiff) {
    return (
      <div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span>{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}:</span>
          {filePath && onOpenFile && (
            <button
              type="button"
              onClick={() => onOpenFile(filePath, newString)}
              className="inline-flex cursor-pointer items-center gap-1 font-mono text-xs text-primary hover:underline truncate max-w-[260px]"
            >
              <FileText className="size-3 shrink-0" />
              {baseName(filePath)}
            </button>
          )}
        </div>
        <div className="mt-0.5 mb-1">
          <EditFileDiff oldString={oldString} newString={newString} />
        </div>
      </div>
    );
  }

  // read_file — ссылка на файл
  if (isRead && filePath && onOpenFile) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px">
        {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
        <span>{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}:</span>
        <button
          type="button"
          onClick={() => onOpenFile(filePath, undefined, hasLineRange ? { start: lineStart, end: lineEnd } : undefined)}
          className="inline-flex cursor-pointer items-center gap-1 font-mono text-xs text-primary hover:underline"
        >
          <FileText className="size-3 shrink-0" />
          <span className="truncate max-w-[200px]">{baseName(filePath)}</span>
          {hasLineRange && <span className="text-muted-foreground shrink-0">(lines {lineStart}-{lineEnd})</span>}
        </button>
      </div>
    );
  }

  // write_todos — список задач с чекбоксами
  if (isWriteTodos && todos.length > 0) {
    return (
      <div className="py-1">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1.5">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span className="leading-none">{streaming ? <Shimmer as="span" duration={1.5}>План</Shimmer> : "План"}</span>
        </div>
        <div className="space-y-1 ml-1">
          {todos.map((todo: { content: string; status: string }, idx: number) => {
            const isCompleted = todo.status === "completed";
            const isInProgress = todo.status === "in_progress";
            return (
              <div key={idx} className="flex items-center gap-2 text-xs">
                {isCompleted ? (
                  <CheckSquare className="size-3.5 shrink-0 text-green-600" />
                ) : isInProgress ? (
                  <Loader2 className="size-3.5 shrink-0 text-blue-600 animate-spin" />
                ) : (
                  <Square className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={`leading-none ${isCompleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {todo.content}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // bash — команда и вывод в отдельном блоке
  if (isBash && bashCommand) {
    return (
      <div className="group min-w-0">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-px">
          {status === "running" && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
          <span className={`flex-1 truncate ${status === "error" && !isRejectedOutput ? "text-destructive" : ""}`}>
            {streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}
          </span>
        </div>

        <div className="mb-1 mt-0.5 space-y-1 w-full">
            {/* Команда */}
            <div className="w-full rounded border border-border/60 bg-muted/40 px-2 py-1.5">
              <div className="font-mono text-[11px] text-foreground/90 break-words">
                <span className="text-muted-foreground">$</span> {bashCommand}
              </div>
            </div>
            
            {/* Вывод */}
            {hasOutput && result && !isRejectedOutput && (
              <pre className={`w-full rounded border px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                result.ok
                  ? "border-border/60 bg-muted/40 text-foreground/80"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}>
                {result.output.trim() || "(no output)"}
                {result.truncated && (
                  <span className="block mt-1 text-muted-foreground">… (вывод обрезан)</span>
                )}
              </pre>
            )}
        </div>

        {hasOutput && !hasContent && status === "ok" && (
          <p className="mx-2 mb-0.5 text-[10px] text-muted-foreground italic">
            Bash completed with no output
          </p>
        )}
      </div>
    );
  }

  // task — спавн сабагента. Плашка «Задача <короткое описание>» + аккуратный блок
  // с полным брифом (prompt), который уходит сабагенту на вход. Своей иконки НЕ
  // рисуем — слева уже стоит голова агента (chat-code-bubble: TOOL_ICONS_MAP.task
  // = Bot). Ход сабагента в чат не идёт — он виден в панели «Фоновые задачи».
  if (isTask) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px min-w-0">
          <span className="shrink-0">{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}</span>
          {taskDesc && <span className="truncate font-medium text-foreground/80">{taskDesc}</span>}
        </div>
        {taskPrompt && (
          <div className="mt-1.5 mb-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
            <p className="scroll-hover-visible max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/70">
              {taskPrompt}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ls — список файлов/папок читаемо
  if (isLs) {
    const lsPath = typeof step.args?.path === "string" ? step.args.path : null;
    // result.output — plain text, одна запись на строку, папки с "/" на конце
    // (см. apps/code-cli/src/agent/tools.ts:ls) — "(empty directory)" при пустой
    // папке, "Error: ..." при ошибке; оба случая просто не дают записей.
    const entries: { name: string; path: string; isDir: boolean }[] = [];
    if (result?.output && !result.output.startsWith("Error:") && result.output !== "(empty directory)") {
      for (const line of result.output.split("\n")) {
        const p = line.trim();
        if (!p) continue;
        const isDir = p.endsWith("/");
        const path = isDir ? p.slice(0, -1) : p;
        entries.push({ path, name: baseName(path), isDir });
      }
    }
    const dirs = entries.filter((e) => e.isDir);
    const files = entries.filter((e) => !e.isDir);
    return (
      <div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span>{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}</span>
          {lsPath && <span className="font-mono text-xs text-muted-foreground/60 truncate max-w-[260px]">{baseName(lsPath)}</span>}
        </div>
        {entries.length > 0 && (
          <div className="mt-1 mb-1 rounded border border-border/60 bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
            {dirs.map((e) => (
              <div key={e.path} className="text-primary">
                📁 {e.name}/
              </div>
            ))}
            {files.map((e) => (
              <div key={e.path} className="text-foreground/75">
                {e.name}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // grep / glob — паттерн в заголовке + результаты списком кликабельных файлов.
  // grep (см. _format_grep_results) зависит от output_mode:
  //   files_with_matches (по умолч.): абсолютные пути по строкам;
  //   count:   "path: N" по строкам;
  //   content: "path:" затем строки "  N: текст".
  // glob — Python-repr список путей: ['a.js', 'b.js'] (см. _create_glob_tool →
  //   str(list[path])). Пути могут быть относительными (имя файла) — тогда
  //   докручиваем базовый каталог из args.path, чтобы клик открывал файл.
  if (isGrep || isGlob) {
    const pattern = typeof step.args?.pattern === "string" ? step.args.pattern : "";
    const globBase = isGlob && typeof step.args?.path === "string" ? step.args.path : "";
    // У glob режима нет — всегда список путей. grep клик подсвечивает текст в
    // файле (ищем по содержимому); glob — просто открывает файл.
    const mode = isGrep && typeof step.args?.output_mode === "string" ? step.args.output_mode : "files_with_matches";
    const raw = (result?.output ?? "").trim();
    const noMatches = raw === "" || raw === "No matches found" || raw === "No files found" || raw === "[]";
    const HeaderIcon = isGlob ? FolderSearch : Search;

    // Собрать полный путь к файлу glob: если путь относительный (без ведущего
    // слэша) и есть базовый каталог — склеиваем, иначе берём как есть.
    const resolveGlob = (p: string): string => {
      if (!globBase || p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return p;
      return `${globBase.replace(/\/+$/, "")}/${p}`;
    };

    // Парсим в список { path, count?, lines?: {n, text}[] }.
    const files: { path: string; count?: number; lines?: { n: number; text: string }[] }[] = [];
    if (!noMatches) {
      if (isGlob) {
        // Python-repr список: ['a.js', 'b.js']. Пробуем JSON (кавычки '→"),
        // иначе — вытаскиваем строки в кавычках регуляркой.
        let names: string[] = [];
        try {
          const j = JSON.parse(raw.replace(/'/g, '"'));
          if (Array.isArray(j)) names = j.map(String);
        } catch {
          names = Array.from(raw.matchAll(/'([^']*)'|"([^"]*)"/g)).map((m) => m[1] ?? m[2]);
        }
        for (const n of names) {
          if (n) files.push({ path: resolveGlob(n) });
        }
      } else if (mode === "content") {
        let cur: (typeof files)[number] | null = null;
        for (const ln of raw.split("\n")) {
          const m = ln.match(/^\s{2}(\d+):\s?(.*)$/); // "  12: текст"
          if (m && cur) {
            cur.lines!.push({ n: parseInt(m[1], 10), text: m[2] });
          } else if (ln.endsWith(":")) {
            cur = { path: ln.slice(0, -1), lines: [] };
            files.push(cur);
          }
        }
      } else if (mode === "count") {
        for (const ln of raw.split("\n")) {
          const idx = ln.lastIndexOf(": ");
          if (idx < 0) continue;
          const n = parseInt(ln.slice(idx + 2), 10);
          files.push({ path: ln.slice(0, idx), count: Number.isFinite(n) ? n : undefined });
        }
      } else {
        for (const ln of raw.split("\n")) {
          if (ln.trim()) files.push({ path: ln.trim() });
        }
      }
    }

    return (
      <div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <HeaderIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span>{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}</span>
          {pattern && (
            <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-foreground/80 truncate max-w-[280px]">
              {pattern}
            </code>
          )}
          {hasOutput && (
            <span className="text-xs text-muted-foreground/60 shrink-0">
              {noMatches ? (locale === "en" ? "no matches" : "ничего не найдено") : filesCount(files.length)}
            </span>
          )}
        </div>
        {files.length > 0 && (
          <div className="mt-1 mb-1 rounded border border-border/60 bg-muted/30 px-1 py-1">
            {files.map((f) => {
              // grep: клик открывает файл и подсвечивает совпадение.
              // glob: клик просто открывает файл (без подсветки текста).
              const row = (
                <>
                  <FileText className="size-3 shrink-0 text-muted-foreground/60" />
                  <span className="font-mono text-[11px] text-primary shrink-0">
                    {baseName(f.path)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground/50 truncate">
                    {f.path}
                  </span>
                  {f.count !== undefined && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">{f.count}</span>
                  )}
                </>
              );
              return (
                <div key={f.path}>
                  {onOpenFile ? (
                    <button
                      type="button"
                      onClick={() => onOpenFile(f.path, isGrep ? (pattern || undefined) : undefined)}
                      className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted/60 [&>span:nth-child(2)]:hover:underline"
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex w-full items-center gap-1.5 px-1.5 py-0.5">
                      {row}
                    </div>
                  )}
                  {f.lines && f.lines.length > 0 && (
                    <div className="ml-5 mb-0.5 border-l border-border/40 pl-2">
                      {f.lines.map((l, li) => (
                        <div key={li} className="flex gap-2 font-mono text-[10px] leading-relaxed">
                          <span className="shrink-0 text-muted-foreground/40 tabular-nums">{l.n}</span>
                          <span className="truncate text-foreground/70">{l.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // MCP-тул (mcp__<server>__<tool>) — чужой инструмент подключённого сервера.
  // Показываем: бейдж сервера + человеческое имя тула, аргументы парами
  // «ключ: значение» и вывод (JSON — с отступами). Раскрывается по клику, как
  // bash: по умолчанию свёрнут, чтобы длинный JSON не распирал ленту.
  if (mcp) {
    const argEntries = Object.entries(step.args ?? {}).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    const output = hasOutput && !isRejectedOutput ? prettifyOutput(result.output) : "";
    const canExpand = argEntries.length > 0 || output.length > 0;
    return (
      <div className="min-w-0">
        <div
          className={`flex items-center gap-2 text-sm text-muted-foreground py-px ${
            canExpand ? "cursor-pointer hover:text-foreground" : ""
          }`}
          onClick={() => canExpand && setExpanded((v) => !v)}
        >
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          {/* Иконку-вилку рисует внешняя строка шага (chat-code-bubble:
              TOOL_ICONS_MAP), здесь своя не нужна — иначе две подряд. */}
          <span className={`min-w-0 truncate ${status === "error" && !isRejectedOutput ? "text-destructive" : ""}`}>
            {streaming ? (
              <Shimmer as="span" duration={1.5}>{humanizeToolName(mcp.tool)}</Shimmer>
            ) : (
              humanizeToolName(mcp.tool)
            )}
          </span>
          <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80">
            {mcp.server}
          </span>
          {canExpand && (
            <ChevronRight className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
          )}
        </div>

        {expanded && canExpand && (
          <div className="mt-1 mb-1 space-y-1">
            {argEntries.length > 0 && (
              <div className="rounded border border-border/60 bg-muted/30 px-2.5 py-1.5">
                {argEntries.map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-[11px] leading-relaxed">
                    <span className="shrink-0 font-mono text-muted-foreground/70">{k}:</span>
                    <span className="min-w-0 whitespace-pre-wrap break-words font-mono text-foreground/80">
                      {formatArgValue(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {result && output && (
              <pre
                className={`scroll-hover-visible max-h-64 overflow-auto rounded border px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                  result.ok
                    ? "border-border/60 bg-muted/40 text-foreground/80"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                {output}
                {result.truncated && (
                  <span className="block mt-1 text-muted-foreground">… (вывод обрезан)</span>
                )}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  // remember — запись в проектную память. Показываем СУТЬ (что именно
  // сохранено), а не служебную строку «Saved memory '...'»: description — то,
  // что попадёт в индекс и что агент увидит в следующей сессии, content — сам
  // факт. Путь к файлу кликабельный: открывается на чтение в том же вьюере, что
  // и файлы проекта (onOpenMemory → readMemoryFile, отдельный канал — память
  // лежит вне workspace, штатный readFile её не отдаёт).
  if (isRemember) {
    const isDelete = String(step.args?.operation ?? "write") === "delete";
    const slug = String(step.args?.slug ?? "");
    const memDescription = String(step.args?.description ?? "");
    const memContent = String(step.args?.content ?? "");
    const memType = String(step.args?.type ?? "");
    // Путь тула возвращает строкой «Path: <abs>» (rememberTool.ts) — он нужен
    // UI, не модели. Берём его оттуда, чтобы не гадать о раскладке каталогов.
    const pathMatch = hasOutput && result.ok ? result.output.match(/^Path:\s*(.+)$/m) : null;
    const memPath = pathMatch?.[1]?.trim() || null;
    const failed = hasOutput && !result.ok;
    // Ошибку показываем как есть: в тексте сказано, почему факт не сохранился
    // (слишком большой, невалидный слаг, хранилище не сконфигурировано).
    const errorText = failed ? result.output.trim() : "";

    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px min-w-0">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span className="shrink-0">
            {streaming ? (
              <Shimmer as="span" duration={1.5}>{title}</Shimmer>
            ) : isDelete ? (
              locale === "en" ? "Forgetting" : "Забываю"
            ) : (
              title
            )}
          </span>
          {slug && (
            <code className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/70">
              {slug}
            </code>
          )}
          {memType && !isDelete && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60">{memType}</span>
          )}
        </div>

        {!isDelete && (memDescription || memContent) && (
          <div className="mt-1 mb-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            {memDescription && (
              <p className="text-xs font-medium leading-relaxed text-foreground/85">
                {memDescription}
              </p>
            )}
            {memContent && (
              <p className="scroll-hover-visible mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/65">
                {memContent}
              </p>
            )}
            {memPath && onOpenMemory && (
              <button
                type="button"
                onClick={() => onOpenMemory(memPath)}
                className="mt-1.5 inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] text-primary hover:underline"
              >
                <FileText className="size-3 shrink-0" />
                <span className="truncate max-w-[280px]">{memPath.split(/[\\/]/).pop()}</span>
              </button>
            )}
          </div>
        )}

        {failed && errorText && (
          <pre className="mt-1 mb-1 w-full rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-destructive whitespace-pre-wrap break-words">
            {errorText}
          </pre>
        )}
      </div>
    );
  }

  // web_search — заголовок + источники (переиспользуем компонент чата).
  if (isSearch) {
    const query = typeof step.args?.query === "string" ? step.args.query : "";
    return (
      <div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span>{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}</span>
        </div>
        {(query || step.sources?.length) ? (
          <div className="mt-0.5 mb-1">
            <SearchSources sources={step.sources ?? []} query={query} />
          </div>
        ) : null}
      </div>
    );
  }

  // web_fetch — заголовок + скачанный файл (переиспользуем компонент чата).
  if (isFetch) {
    return (
      <div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-px">
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span>{streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}</span>
        </div>
        {step.file && threadId ? (
          <div className="mt-0.5 mb-1">
            <FetchedFile file={step.file} threadId={threadId} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="group">
      <div
        className={`flex items-center gap-2 text-sm text-muted-foreground transition-colors ${
          hasContent ? "cursor-pointer hover:text-foreground" : ""
        }`}
        onClick={() => hasContent && setExpanded((v) => !v)}
      >
        {status === "running" && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className={`flex-1 truncate ${status === "error" ? "text-destructive" : ""}`}>
          {streaming ? <Shimmer as="span" duration={1.5}>{title}</Shimmer> : title}
        </span>
        {hasContent && (
          <ChevronRight className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </div>

      {expanded && hasContent && (
        <div className="mb-1 mt-0.5">
          {result ? (
            <pre className={`scroll-hover-visible max-h-64 overflow-auto rounded border px-2 py-1.5 font-mono text-[11px] leading-relaxed ${
              result.ok
                ? "border-border/60 bg-muted/40 text-foreground/80"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            }`}>
              {result.output.trim() || "(no output)"}
              {result.truncated && (
                <span className="block mt-1 text-muted-foreground">… (вывод обрезан)</span>
              )}
            </pre>
          ) : null}
        </div>
      )}

      {hasOutput && !hasContent && status === "ok" && (
        <p className="mx-2 mb-0.5 text-[10px] text-muted-foreground italic">
          Bash completed with no output
        </p>
      )}
    </div>
  );
});
