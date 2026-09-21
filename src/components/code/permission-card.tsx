"use client";

import { useEffect, useState } from "react";
import { ShieldQuestion, Check, X, ChevronRight, MessageSquare, Bot } from "lucide-react";
import { EditFileDiff } from "@/components/chat/edit-diff";
import type { PendingPermission } from "@/lib/code/code-chat-streams";

export function PermissionCard({
  pending,
  onDecision,
  busy,
  queueSize = 1,
}: {
  pending: PendingPermission;
  onDecision: (d: "approve" | "reject", comment?: string) => void;
  busy?: boolean;
  queueSize?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");

  // Защита от ДВОЙНОГО решения: после первого клика/Enter кнопки гаснут до
  // смены карточки (pending). Иначе второй клик (даблклик, зажатый Enter)
  // применил бы решение уже к СЛЕДУЮЩЕЙ карточке очереди — queue[0] сдвигается
  // синхронно при первом решении. Актуально теперь особенно: busy больше не
  // держит кнопки disabled всё время стрима (см. code-streams.ts).
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setSubmitted(false);
  }, [pending]);
  const locked = !!busy || submitted;
  const decide = (d: "approve" | "reject", c?: string) => {
    if (locked) return;
    setSubmitted(true);
    onDecision(d, c);
  };

  // Клавиатура (как у question-card / стоп по Esc): Enter — разрешить, Esc —
  // отклонить (жёстко = стоп). Активно, пока карточка видна и НЕ в режиме
  // комментария (там Enter/Esc обрабатывает textarea). Esc ловим на документе —
  // работает и когда фокус вне карточки. Enter — только когда фокус НЕ в поле
  // ввода, чтобы не перехватывать отправку сообщения из чат-инпута.
  useEffect(() => {
    if (showComment) return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (locked) return;
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTyping()) return; // не мешаем Enter'у отправлять сообщение из инпута
        e.preventDefault();
        setSubmitted(true);
        onDecision("approve");
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSubmitted(true);
        onDecision("reject", undefined); // жёсткое «Нет» = стоп
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showComment, locked, onDecision]);

  const { tool, args } = pending;
  const title = describeTool(tool);
  const path = typeof args.file_path === "string" ? args.file_path : null;
  const command = typeof args.command === "string" ? args.command : null;
  const content = typeof args.content === "string" ? args.content : null;
  const oldStr = typeof args.old_string === "string" ? args.old_string : null;
  const newStr = typeof args.new_string === "string" ? args.new_string : null;
  // Спавн сабагента (тула task): description — короткая подпись задачи (в шапке),
  // prompt — полный бриф, который уходит сабагенту на вход (в раскрытии). Так
  // видно и ЧТО за задача, и ЧТО именно получит сабагент, прежде чем разрешить.
  const taskDesc = typeof args.description === "string" ? args.description : null;
  const taskPrompt = typeof args.prompt === "string" ? args.prompt : null;
  // Карточка от ФОНОВОГО САБАГЕНТА (его рискованный тул bash/write/edit): баннер
  // «какой субагент» сверху — ответ уйдёт в резюм именно его графа (resolvePermission).
  const sub = pending.sub;
  // MCP-тул: превью — его аргументы (JSON), иначе пользователь одобряет вызов
  // вслепую, видя только имя. Пустые значения не показываем.
  const mcpArgs = parseMcpName(tool)
    ? Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== "")
    : [];
  const hasDiff = oldStr != null && newStr != null;
  const hasPreview =
    hasDiff || content != null || command != null || taskPrompt != null || mcpArgs.length > 0;

  function handleReject() {
    if (showComment) {
      // Уже в режиме комментария — отправляем с комментарием (или без если пустой)
      decide("reject", comment.trim() || undefined);
    } else {
      // Первый клик — просто Нет (без комментария = стоп)
      decide("reject", undefined);
    }
  }

  return (
    <div className="mx-4 mb-3 rounded-lg border border-border bg-background text-sm overflow-hidden shadow-md">
      {/* Баннер «от какого субагента» — только для карточек фоновых сабагентов. */}
      {sub && (
        <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Bot className="size-3.5 shrink-0" />
          <span className="truncate">
            Субагент {sub.type}
            {sub.description ? ` · ${sub.description}` : ""}
          </span>
        </div>
      )}
      {/* Заголовок — всегда виден, кликабелен если есть что раскрыть */}
      <div
        className={`flex items-center gap-2 p-3 ${hasPreview ? "cursor-pointer hover:bg-muted/60" : ""}`}
        onClick={() => hasPreview && setExpanded((v) => !v)}
      >
        <ShieldQuestion className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium flex-1 min-w-0">
          {title}
          {path && (
            <span className="ml-2 font-mono font-normal text-xs text-muted-foreground truncate">
              {/* по ОБОИМ разделителям: на native Windows пути приходят с "\" */}
              {path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path}
            </span>
          )}
          {taskDesc && (
            <span className="ml-2 font-normal text-xs text-muted-foreground truncate">
              {taskDesc}
            </span>
          )}
        </span>
        {queueSize > 1 && (
          <span className="text-xs text-muted-foreground shrink-0">
            ещё {queueSize - 1}
          </span>
        )}
        {hasPreview && (
          <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </div>

      {/* Раскрывающийся блок с превью */}
      {expanded && hasPreview && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {path && (
            <div className="mb-2 font-mono text-xs text-muted-foreground break-all">{path}</div>
          )}
          {hasDiff ? (
            <EditFileDiff oldString={oldStr!} newString={newStr!} />
          ) : command ? (
            // max-h + скролл: длинная многострочная команда (напр. коммит с
            // большим телом) не должна распирать карточку на весь экран —
            // как у content ниже. whitespace-pre-wrap + break-all: длинные
            // неразрывные строки переносятся, а не тянут горизонтально.
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-xs">
              {command}
            </pre>
          ) : content != null ? (
            <pre className="max-h-48 overflow-auto rounded border border-border bg-muted/60 p-2 font-mono text-xs">
              {content.length > 1200 ? content.slice(0, 1200) + "\n…" : content}
            </pre>
          ) : taskPrompt != null ? (
            // Полный бриф сабагенту (prompt на вход) — обычный текст, не моно-код:
            // читаемый перенос по словам, ограничение высоты как у command/content.
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-xs">
              {taskPrompt}
            </pre>
          ) : mcpArgs.length > 0 ? (
            // Аргументы MCP-тула парами «ключ: значение» — что именно уйдёт на
            // сторонний сервер, если разрешить.
            <div className="max-h-48 overflow-auto rounded bg-muted/60 p-2">
              {mcpArgs.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs leading-relaxed">
                  <span className="shrink-0 font-mono text-muted-foreground">{k}:</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words font-mono">
                    {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Поле комментария при отклонении с пояснением */}
      {showComment && (
        <div className="border-t border-border px-3 pt-2 pb-3">
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                decide("reject", comment.trim() || undefined);
              }
              if (e.key === "Escape") {
                setShowComment(false);
                setComment("");
              }
            }}
            placeholder="Что не так? Агент учтёт и переделает…"
            rows={2}
            className="w-full resize-none rounded border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-ring placeholder:text-muted-foreground/60"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={locked}
              onClick={() => decide("reject", comment.trim() || undefined)}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive disabled:opacity-50"
            >
              <X className="size-3.5" /> Отклонить
            </button>
            <button
              type="button"
              onClick={() => { setShowComment(false); setComment(""); }}
              className="inline-flex items-center px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Кнопки — всегда снизу (скрываем когда показано поле комментария) */}
      {!showComment && (
        <div className="flex gap-2 px-3 pb-3">
          <button
            type="button"
            disabled={locked}
            onClick={() => decide("approve")}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="size-3.5" /> Разрешить
            <kbd className="ml-0.5 rounded border border-white/30 px-1 text-[10px] leading-none opacity-80">↵</kbd>
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={handleReject}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <X className="size-3.5" /> Нет
            <kbd className="ml-0.5 rounded border border-border px-1 text-[10px] leading-none text-muted-foreground">Esc</kbd>
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => setShowComment(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Отклонить с комментарием"
          >
            <MessageSquare className="size-3.5" /> Нет + комментарий
          </button>
        </div>
      )}
    </div>
  );
}

function describeTool(tool: string): string {
  switch (tool) {
    case "write_file": return "Создать файл";
    case "edit_file": return "Изменить файл";
    case "bash": return "Выполнить команду";
    case "task": return "Запустить сабагента";
    default: {
      // MCP-тул подключённого сервера: `mcp__<server>__<tool>`. Сырое имя в
      // заголовке карточки нечитаемо, а решение пользователь принимает именно
      // по нему — показываем «Вызвать <тул> (<сервер>)».
      const mcp = parseMcpName(tool);
      if (mcp) return `Вызвать ${humanizeMcpTool(mcp.tool)} (${mcp.server})`;
      return tool;
    }
  }
}

/** Разбор `mcp__<server>__<tool>` (см. mcpMiddleware.ts). Имя сервера задаёт
 *  пользователь и может содержать «_», поэтому режем по ПОСЛЕДНЕМУ «__». */
function parseMcpName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const sep = rest.lastIndexOf("__");
  if (sep <= 0) return { server: rest, tool: rest };
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

/** `query-docs` → «query docs» (в заголовке карточки уже есть глагол «Вызвать»). */
function humanizeMcpTool(tool: string): string {
  return tool.replace(/[-_]+/g, " ").trim();
}
