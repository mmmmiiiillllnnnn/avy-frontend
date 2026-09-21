"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  CircleSlash,
  Square,
  Play,
  Trash2,
  ChevronDown,
  Bot,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";
import type { BgTask } from "@/lib/code/code-chat-streams";

/** Как часто обновлять живой лог running-задачи (мс). */
const LOG_POLL_MS = 1500;

// Ширина панели с сохранением между сессиями + drag-ресайзом левой границы —
// тот же паттерн, что у FilesPanel (см. web/src/components/chat/files-panel.tsx).
const MIN_WIDTH = 352; // 22rem
const STORAGE_KEY = "avy:bg-tasks-panel-width";

function maxWidth(): number {
  if (typeof window === "undefined") return 640;
  return Math.round(window.innerWidth / 3);
}

function clampWidth(px: number): number {
  return Math.max(MIN_WIDTH, Math.min(px, maxWidth()));
}

function usePanelWidth() {
  const [width, setWidth] = useState(MIN_WIDTH);

  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved) setWidth(clampWidth(saved));
  }, []);

  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    setWidth(clampWidth(window.innerWidth - e.clientX));
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      localStorage.setItem(STORAGE_KEY, String(width));
    },
    [width],
  );

  return {
    width,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}

/**
 * Правая панель «Фоновые задачи» — НЕ модальная, живёт в потоке layout рядом с
 * лентой (тот же паттерн, что FilesPanel). Открывается кнопкой в шапке чата,
 * остаётся доступной даже когда задач нет, закрывается только явно (крестик) —
 * не сворачивается сама и не зависит от того, есть ли активные задачи.
 */
export function BackgroundTasksPanel({
  open,
  threadId,
  tasks,
  onKill,
  onRemove,
  onRestart,
  onClose,
}: {
  open: boolean;
  threadId: string;
  tasks: BgTask[];
  onKill: (pid: number) => void;
  onRemove: (id: string) => void;
  onRestart: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { width, dragging, handlers } = usePanelWidth();

  // Порядок: сначала работающие (за ними следят живьём), затем — по времени
  // старта, свежие сверху. Так последние логи (в т.ч. серверов) всегда наверху.
  const ordered = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const ar = a.status === "running" ? 1 : 0;
      const br = b.status === "running" ? 1 : 0;
      if (ar !== br) return br - ar;
      return b.startedAt - a.startedAt;
    });
  }, [tasks]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={dragging ? { duration: 0 } : { duration: 0.22, ease: "easeInOut" }}
          className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border/60 text-sidebar-foreground"
        >
          <div
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            className="group absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize"
            role="separator"
            aria-orientation="vertical"
          >
            <div className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-foreground/20" />
          </div>
          <div style={{ width }} className="flex h-full min-h-0 flex-1 flex-col">
            {/* h-14 — как центральный хэдер чата: заголовки на одной линии.
                Без border-b — шапка на общей поверхности (утверждённый макет). */}
            <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {t.bgTasks.title}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.bgTasks.closePanel}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {tasks.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {t.bgTasks.empty}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {ordered.map((task) => (
                  <BgTaskRow
                    key={task.id}
                    threadId={threadId}
                    task={task}
                    onKill={onKill}
                    onRemove={onRemove}
                    onRestart={onRestart}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function BgTaskRow({
  threadId,
  task,
  onKill,
  onRemove,
  onRestart,
}: {
  threadId: string;
  task: BgTask;
  onKill: (pid: number) => void;
  onRemove: (id: string) => void;
  onRestart: (id: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [log, setLog] = useState<string>("");
  const [logError, setLogError] = useState<string | null>(null);

  // Живой лог: читаем logPath через мост. Пока задача идёт и строка раскрыта —
  // опрашиваем периодически; после завершения читаем один раз (финальный лог).
  // Для сабагента лог-файла нет: его живой транскрипт приходит прямо в task
  // (bg_task-события), рендерим его ниже без опроса — поэтому эффект пропускаем.
  useEffect(() => {
    if (!expanded || task.kind === "subagent") return;
    const bridge = window.avyDesktop?.codeAgent;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!bridge) {
        if (!cancelled) setLogError(t.bgTasks.desktopOnly);
        return;
      }
      const res = await bridge.readTmpFile(threadId, task.logPath);
      if (cancelled) return;
      if ("content" in res) {
        setLog(res.content);
        setLogError(null);
      } else if ("error" in res) {
        setLogError(t.bgTasks.logUnavailable);
      }
      if (!cancelled && task.status === "running") {
        timer = setTimeout(tick, LOG_POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, threadId, task.logPath, task.status, task.kind]);

  const StatusIcon =
    task.status === "running"
      ? Loader2
      : task.status === "finished"
        ? CheckCircle2
        : task.status === "stopped"
          ? CircleSlash
          : XCircle;
  const statusColor =
    task.status === "finished"
      ? "text-emerald-500"
      : task.status === "failed"
        ? "text-destructive"
        : "text-muted-foreground"; // running / stopped — нейтрально

  // Субагент (тула task): фоновый прогон агента, не bash-команда. Отличаем в UI:
  // иконка-бот, подпись «субагент <тип>», без exit-кода и без «Запустить снова»
  // (перезапуск как bash бессмыслен — это агент, а не команда).
  const isSub = task.kind === "subagent";
  const statusWord =
    task.status === "running"
      ? t.bgTasks.running
      : task.status === "finished"
        ? t.bgTasks.finished
        : task.status === "stopped"
          ? t.bgTasks.stopped
          : t.bgTasks.failed;

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div className="flex items-center gap-2 py-2 pl-5 pr-3 transition-colors hover:bg-accent/40">
        <StatusIcon
          className={cn("size-3.5 shrink-0", statusColor, task.status === "running" && "animate-spin")}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
          title={task.command}
        >
          <span className="flex items-center gap-1 truncate font-mono text-xs">
            {isSub && <Bot className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{task.command}</span>
          </span>
          <span className="text-[11px] text-muted-foreground">
            {isSub
              ? `${t.bgTasks.subagent} ${task.subagentType ?? ""} · ${statusWord}`
              : task.status === "running"
                ? `${t.bgTasks.running}${task.pid != null ? ` · pid ${task.pid}` : ""}`
                : task.status === "finished"
                  ? `${t.bgTasks.finished} · exit ${task.exitCode ?? 0}`
                  : task.status === "stopped"
                    ? t.bgTasks.stopped
                    : `${t.bgTasks.failed} · exit ${task.exitCode ?? "?"}`}
          </span>
        </button>
        {task.status === "running" ? (
          task.pid != null && (
            <button
              type="button"
              onClick={() => onKill(task.pid!)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t.bgTasks.stop}
            >
              <Square className="size-3" /> {t.bgTasks.stop}
            </button>
          )
        ) : (
          // Завершённая задача: перезапустить ту же команду / убрать из истории.
          // Для сабагента «Запустить снова» не показываем (перезапуск как bash-
          // команды бессмыслен — это прогон агента, а не shell-команда).
          <>
            {!isSub && (
              <button
                type="button"
                onClick={() => onRestart(task.id)}
                aria-label={t.bgTasks.rerun}
                title={t.bgTasks.rerun}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Play className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(task.id)}
              aria-label={t.bgTasks.remove}
              title={t.bgTasks.remove}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 cursor-pointer text-muted-foreground transition-transform",
            !expanded && "-rotate-90",
          )}
          onClick={() => setExpanded((v) => !v)}
        />
      </div>
      {expanded && (
        <div className="py-2 pl-5 pr-3">
          {isSub ? (
            // Сабагент: живой транскрипт хода (текст + инструменты) приходит прямо
            // в task.transcript через bg_task-события — рендерим как есть, растёт
            // по мере хода. Лог-файла у сабагента нет (в чат его ход не идёт).
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">
              {task.transcript?.trim() || t.bgTasks.noOutput}
            </pre>
          ) : logError ? (
            <div className="text-xs text-muted-foreground">{logError}</div>
          ) : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/80">
              {log || t.bgTasks.noOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
