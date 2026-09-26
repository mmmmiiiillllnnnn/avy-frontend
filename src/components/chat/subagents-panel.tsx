"use client";

import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { BotIcon } from "@/components/chat/bot-icon";
import { SubagentWindow } from "@/components/chat/tool-steps";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useLocale, useT } from "@/i18n/i18n-context";
import type { ChatMessage, SubagentRun } from "@/lib/chat-streams";
import { cn } from "@/lib/utils";
import {
  chainToolCount,
  descriptionOf,
  groupTaskChains,
  isContinuation,
  mergeChainRuns,
  pluralize,
  taskLiveAction,
  taskQuestion,
  taskStatus,
  taskTitle,
  taskType,
  type TaskStatus,
  type TaskStep,
} from "@/lib/task-card";

/**
 * Один субагент для списка — ОДИН АГЕНТ, а не один вызов task. Беседа с
 * субагентом (исходный вызов + продолжения с тем же `agent_id`: ответы на
 * вопросы, дозадания) — одна строка: заголовок и бриф от первого вызова,
 * статус и «что делает сейчас» — от последнего, шаги суммируются.
 */
export type SubagentEntry = {
  /** Адрес агента: id первого вызова (у фонового — background.agent_id). */
  key: string;
  /** Первый вызов — задача. */
  head: TaskStep;
  /** Последний вызов в беседе — текущее состояние агента. */
  last: TaskStep;
  /** Все вызовы беседы по порядку. */
  steps: TaskStep[];
  /** Заголовок задачи (фраза модели); пусто — панель подпишет нейтрально. */
  title: string;
  /** Тип субагента (subagent_type), напр. general-purpose. */
  type: string;
  status: TaskStatus;
  /** Ещё работает — для шиммера кнопки в шапке чата. */
  running: boolean;
  /** Лента работы субагента для окна (может быть пустой, пока не пришла). */
  run: SubagentRun | undefined;
};

/**
 * Собрать всех субагентов из ленты сообщений сессии, сгруппировав вызовы task
 * по адресу агента (task-card.groupTaskChains — те же цепочки, что у карточек).
 * Статус считает taskStatus по ПОСЛЕДНЕМУ вызову: у синхронного шага
 * «работает» только пока ход идёт и результата нет.
 */
export function collectSubagents(
  messages: ChatMessage[],
  isStreaming: boolean,
): SubagentEntry[] {
  const out: SubagentEntry[] = [];
  for (const [key, steps] of groupTaskChains(messages)) {
    const head = steps[0];
    const last = steps[steps.length - 1];
    const status = taskStatus(last, isStreaming);
    out.push({
      key,
      head,
      last,
      steps,
      title: taskTitle(head),
      type: taskType(head) || taskType(last),
      status,
      running: status === "running",
      // Лента за всю беседу (склейка вызовов с дедупликацией, см. mergeChainRuns).
      run: mergeChainRuns(steps),
    });
  }
  return out;
}

/** Секция панели по статусу: работают / ждут ответа / всё остальное. */
function sectionOf(status: TaskStatus): "running" | "waiting" | "done" {
  if (status === "running") return "running";
  if (status === "waiting") return "waiting";
  return "done";
}

const PANEL: Record<"ru" | "en", { empty: string; close: string }> = {
  ru: { empty: "Пока нет запущенных субагентов.", close: "Закрыть" },
  en: { empty: "No subagents launched yet.", close: "Close" },
};

const DOT: Record<TaskStatus, string> = {
  running: "bg-primary",
  waiting: "bg-amber-500",
  answered: "bg-amber-500/60",
  done: "bg-emerald-500",
  error: "bg-destructive",
  cancelled: "bg-muted-foreground/60",
  interrupted: "bg-muted-foreground/60",
};

/**
 * Правая панель со списком субагентов сессии. Три секции по статусу:
 * работающие сверху (с тем, что делают прямо сейчас), ждущие ответа (с текстом
 * вопроса), готовые внизу. Клик по строке открывает окно работы субагента
 * (SubagentWindow) — то же, что «Подробнее» на карточке в ленте; кнопка >
 * раскрывает бриф прямо в панели. Панель — сосед колонки чата (сдвигает её),
 * как панель файлов.
 */
export function SubagentsPanel({
  entries,
  threadId,
  onClose,
}: {
  entries: SubagentEntry[];
  threadId: string;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const L = t.chat.task;
  // Открытая лента субагента (по key). Сам run достаём из entries на рендере,
  // чтобы окно показывало живую ленту при стриме, а не снимок на момент клика.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openEntry = useMemo(
    () => entries.find((e) => e.key === openKey),
    [entries, openKey],
  );
  // Раскрытые строки: бриф прямо в панели (toggle по кнопке >).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sections = useMemo(() => {
    const by = { running: [] as SubagentEntry[], waiting: [] as SubagentEntry[], done: [] as SubagentEntry[] };
    for (const e of entries) by[sectionOf(e.status)].push(e);
    // Готовые — свежие сверху: последний запущенный интереснее первого.
    by.done.reverse();
    return [
      { key: "running", label: L.sectionRunning, items: by.running, tone: "text-muted-foreground/70" },
      { key: "waiting", label: L.sectionWaiting, items: by.waiting, tone: "text-amber-700 dark:text-amber-400" },
      { key: "done", label: L.sectionDone, items: by.done, tone: "text-muted-foreground/70" },
    ].filter((s) => s.items.length > 0);
  }, [entries, L]);

  return (
    <div className="relative flex h-full w-80 shrink-0 flex-col overflow-hidden border-l border-border/60 text-sidebar-foreground">
      {/* h-14 — как центральный хэдер чата: заголовки на одной линии. Без
          border-b — по утверждённому макету шапка живёт на общей поверхности,
          линию рисует заголовок списка ниже. */}
      <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
        <BotIcon size={15} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {t.chat.subagents}
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground/60">
            {entries.length}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={PANEL[locale].close}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {PANEL[locale].empty}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pb-2">
          {sections.map((sec) => (
            <div key={sec.key}>
              <div
                className={cn(
                  "flex items-center gap-1.5 px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider",
                  sec.tone,
                )}
              >
                {sec.label}
                <span className="font-medium tabular-nums opacity-70">{sec.items.length}</span>
              </div>
              {sec.items.map((e) => {
                const isOpen = expanded.has(e.key);
                const brief = descriptionOf(e.head);
                return (
                  <div key={e.key}>
                    <div className="flex items-start transition-colors hover:bg-accent/40">
                      <button
                        type="button"
                        onClick={() => setOpenKey(e.key)}
                        className="grid min-w-0 flex-1 grid-cols-[8px_1fr] gap-x-2.5 py-2 pl-5 pr-2 text-left"
                      >
                        <span className={cn("mt-[7px] size-2 rounded-full", DOT[e.status])} />
                        <span className="min-w-0">
                          <span className="line-clamp-2 text-[13px] leading-snug text-foreground">
                            {/* Первый вызов беседы обычно и есть задача; если он
                                сам продолжение (исходный вызов вне загруженной
                                страницы истории) — подписываем как ответ. */}
                            {e.title || (isContinuation(e.head) ? L.continuationTitle : t.chat.agentTask)}
                          </span>
                          <SecondLine entry={e} locale={locale} />
                        </span>
                      </button>
                      {/* > : раскрыть бриф инлайн (не открывает окно). */}
                      {brief ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(e.key)}
                          aria-label={isOpen ? L.brief : L.brief}
                          aria-expanded={isOpen}
                          className="mr-2 mt-2 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-foreground"
                        >
                          <ChevronRight
                            className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                        </button>
                      ) : null}
                    </div>
                    {isOpen && brief ? (
                      <div className="pb-3 pl-[38px] pr-3">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                          {L.brief}
                        </span>
                        <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                          {brief}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {openEntry?.run ? (
        <SubagentWindow
          run={openEntry.run}
          running={openEntry.running}
          locale={locale}
          threadId={threadId}
          onClose={() => setOpenKey(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Вторая строка: тип и то, что важно в текущем состоянии — что делает сейчас
 * (работает), вопрос (ждёт), число шагов / статус (готово).
 */
function SecondLine({ entry, locale }: { entry: SubagentEntry; locale: "ru" | "en" }) {
  const t = useT();
  const L = t.chat.task;
  const { last, status } = entry;
  const live = status === "running" ? taskLiveAction(last, locale) : null;
  const question = status === "waiting" ? taskQuestion(last) : null;
  // Шаги — за всю беседу с агентом, а не за последний вызов.
  const count = chainToolCount(entry.steps);
  return (
    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
      {entry.type ? (
        <span className="rounded-full border border-border/70 bg-muted px-1.5 py-px font-mono text-[10px]">
          {entry.type}
        </span>
      ) : null}
      {last.background ? <span>{L.inBackground}</span> : null}
      {live ? (
        <Shimmer as="span" className="min-w-0 truncate" duration={1.5} accentColor="var(--color-primary)">
          {live}
        </Shimmer>
      ) : question ? (
        <span className="line-clamp-2 text-amber-700 dark:text-amber-400">{question.text}</span>
      ) : (
        <>
          <span>{L.status[status]}</span>
          {count > 0 ? <span>· {pluralize(count, L.steps, locale)}</span> : null}
        </>
      )}
    </span>
  );
}
