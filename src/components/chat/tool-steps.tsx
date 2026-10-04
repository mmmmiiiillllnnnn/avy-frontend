"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useConnectorLabels } from "@/lib/connector-registry";
import { createPortal } from "react-dom";
import { ChevronRight, Sparkles, Bot, X } from "lucide-react";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import {
  TimelineNode,
  type TimelineNodeStatus,
} from "@/components/chat/thought-timeline";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { SearchSources } from "@/components/chat/search-sources";
import { WeatherWidget } from "@/components/chat/weather-widget";
import { FetchedFile } from "@/components/chat/fetched-file";
import { AskUserStep } from "@/components/chat/ask-user-step";
import { BotIcon } from "@/components/chat/bot-icon";
import { ImageThumb, imagePath, isImageRead } from "@/components/chat/image-thumb";
import type { Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/i18n/i18n-context";
import { contentArgsText, describeTool, type ToolStatus } from "@/lib/tool-labels";
import { toolIcon } from "@/lib/tool-icons";
import { ReasoningSummarySwap } from "@/components/chat/reasoning-clamp";
import type { SubagentRun, ThoughtStep } from "@/hooks/use-chat";
import { chatStreams } from "@/lib/chat-streams";
import {
  chainEvents,
  chainToolCount,
  descriptionOf,
  formatElapsed,
  isContinuation,
  mergeChainRuns,
  pluralize,
  taskLiveAction,
  taskQuestion,
  taskResultLine,
  taskStatus,
  taskTitle,
  taskType,
  type TaskEvent,
  type TaskStatus,
} from "@/lib/task-card";
import { useHiddenTaskSteps, useTaskChain } from "@/components/chat/task-chains-context";

/** Заголовок цепочки: «работает» (с shimmer) и «готово». */
const HEADER: Record<Locale, { running: string; done: string }> = {
  ru: { running: "Думаю…", done: "Рассуждения" },
  en: { running: "Thinking…", done: "Reasoning" },
};

/**
 * Заголовок цепочки во время хода = действие текущего (последнего) шага:
 * reasoning → «Агент рассуждает…», тул → его действие («Ищу в интернете» и т.п.).
 * Так свёрнутая цепочка сама показывает, чем агент занят прямо сейчас.
 */
function currentStepLabel(steps: ThoughtStep[], locale: Locale): string {
  const last = steps[steps.length - 1];
  if (!last || last.kind === "reasoning") return HEADER[locale].running;
  return describeTool(last.name, last.args, locale).title;
}

/** Шаг вызова тула (сужение ThoughtStep). */
type ToolStep = Extract<ThoughtStep, { kind: "tool" }>;

/** Это шаг постановки задачи агенту (task). */
function isTaskStep(s: ThoughtStep): s is ToolStep {
  return s.kind === "tool" && s.name === "task";
}

/**
 * Шаг task, который выносим ИЗ цепочки карточкой: аргументы дозрели. Пока они
 * стримятся, шаг остаётся В цепочке («Запускаю агента» с бегущим брифом в
 * живой панели): `agent_id` модель пишет в аргументах после description, и до
 * его прихода продолжение (ответ субагенту, дозадание) неотличимо от новой
 * задачи — карточка «новой задачи» мигала и сливалась с целевой.
 */
function isTaskCardStep(s: ThoughtStep): s is ToolStep {
  return isTaskStep(s) && s.state !== "streaming";
}

/** Готовый результат get_weather — виджет тоже выносим наружу: текст тулы
 *  пользователю не показывается, вся информация только в нём. Вызовы без
 *  weather (action="search" или ещё не завершённый) остаются в цепочке. */
function isWeatherStep(s: ThoughtStep): s is ToolStep {
  return s.kind === "tool" && s.name === "get_weather" && !!s.weather;
}

/**
 * Сегмент ленты: либо кусок цепочки рассуждений (reasoning + обычные тулы), либо
 * отдельный шаг «задача агенту». Порядок сегментов = порядок шагов, чтобы task
 * стоял ровно там, где агент его поставил, а не был свален в конец.
 */
type ChainSegment =
  | { kind: "chain"; steps: ThoughtStep[] }
  | { kind: "task"; step: ToolStep }
  | { kind: "weather"; step: ToolStep };

/** Разбить плоский список шагов на сегменты: подряд идущие не-task — в цепочку,
 *  каждый task — отдельным сегментом (между цепочками). */
function splitChainSteps(steps: ThoughtStep[]): ChainSegment[] {
  const out: ChainSegment[] = [];
  let buf: ThoughtStep[] = [];
  const flush = () => {
    if (buf.length) {
      out.push({ kind: "chain", steps: buf });
      buf = [];
    }
  };
  for (const s of steps) {
    if (isTaskCardStep(s)) {
      flush();
      out.push({ kind: "task", step: s });
    } else if (isWeatherStep(s)) {
      flush();
      out.push({ kind: "weather", step: s });
    } else {
      buf.push(s);
    }
  }
  flush();
  return out;
}

/**
 * Лента одной chain-части сообщения: цепочка рассуждений + вынесенные наружу
 * задачи агенту (task). Task — это ЗАДАЧА, поставленная агенту, а не рассуждение,
 * поэтому показывается отдельным блоком «Задача для агента» вне свёрнутого
 * chain-of-thought, в том месте ленты, где агент её поставил.
 *
 * `isRunning`/`finalized` относятся ко всей части; «работает» переносим только на
 * ПОСЛЕДНИЙ сегмент (текущий шаг — в нём).
 */
export function ThoughtStream({
  steps,
  isRunning = false,
  finalized = false,
  threadId,
  className = "",
  hideStepIcons = false,
}: {
  steps: ThoughtStep[];
  isRunning?: boolean;
  finalized?: boolean;
  threadId: string;
  className?: string;
  hideStepIcons?: boolean;
}) {
  // Названия инструментов коннекторов приходят с каталогом — перерисовать по приходу.
  useConnectorLabels();
  // Скрытые карточки task (продолжения, слитые с исходной) убираем ДО
  // разбиения: иначе на их месте оставался разрыв, и две цепочки рассуждений
  // шли подряд без текста между ними.
  const isHidden = useHiddenTaskSteps();
  const visible = steps.filter((s) => !(isTaskCardStep(s) && isHidden(s)));
  const segments = splitChainSteps(visible);
  return (
    <>
      {segments.map((seg, i) => {
        // «Работает» — только у последнего сегмента (там текущий шаг).
        const last = i === segments.length - 1;
        if (seg.kind === "task") {
          // Карточке задачи — «ход идёт», а не «последний сегмент»: при
          // ПАРАЛЛЕЛЬНЫХ вызовах task первая карточка не последняя, и без
          // результата она читалась как «готово», хотя агент ещё работал
          // (taskStatus без результата и без хода отдаёт done). Пока ход идёт,
          // шаг без результата — работающий, где бы он ни стоял; результат
          // придёт своим кадром tool_result.
          return (
            <AgentTaskStep
              key={i}
              step={seg.step}
              running={isRunning}
              threadId={threadId}
            />
          );
        }
        if (seg.kind === "weather") {
          // step.weather точно есть — по нему сегмент и отобран (isWeatherStep).
          return <WeatherWidget key={i} weather={seg.step.weather!} />;
        }
        return (
          <ThoughtChain
            key={i}
            steps={seg.steps}
            isRunning={isRunning && last}
            finalized={finalized}
            threadId={threadId}
            className={className}
            hideStepIcons={hideStepIcons}
          />
        );
      })}
    </>
  );
}

/**
 * Единая цепочка размышлений агента: reasoning-блоки и вызовы инструментов
 * в том порядке, в каком они происходили (подумал → вызвал → подумал → ответил).
 * Пока ход идёт — живая панель (ThinkingPanel) фиксированной высоты с текущим
 * рассуждением; после завершения схлопывается в кнопку. Раскрытие в обоих
 * состояниях показывает полную ленту шагов таймлайном.
 */
export function ThoughtChain({
  steps,
  isRunning = false,
  finalized = false,
  threadId,
  className = "",
  hideStepIcons = false,
}: {
  steps: ThoughtStep[];
  isRunning?: boolean;
  finalized?: boolean;
  threadId: string;
  className?: string;
  hideStepIcons?: boolean;
}) {
  // Названия инструментов коннекторов приходят с каталогом — перерисовать по приходу.
  useConnectorLabels();
  // Свёрнута по умолчанию (и пока агент работает тоже): заголовок сам говорит,
  // что сейчас делает агент. Пользователь раскрывает кликом (контролируемое
  // состояние, своё открытие/закрытие сохраняется).
  const [open, setOpen] = useState(false);

  // Когда пошёл финальный ответ — принудительно сворачиваем цепочку, даже если
  // пользователь раскрыл её ранее. Делаем один раз на переход finalized→true,
  // чтобы после этого юзер мог снова раскрыть и оно не закрывалось обратно.
  useEffect(() => {
    if (finalized) setOpen(false);
  }, [finalized]);

  // Локаль интерфейса — из общего контекста (переключатель языка в сайдбаре).
  const { locale } = useLocale();

  // Открытое окно сабагента (deep-research): null = закрыто. Храним id шага
  // task (tool_call_id), а не сам run — чтобы окно при стриме показывало живую,
  // постоянно дополняемую ленту (run достаём из актуальных steps на рендере, не
  // снимок на момент клика).
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const openStep =
    openCallId == null
      ? undefined
      : steps.find(
          (s) => s.kind === "tool" && s.id === openCallId && s.subagent,
        );
  const openRun =
    openStep && openStep.kind === "tool" ? openStep.subagent : undefined;

  // Заголовок: пока идёт ход — действие текущего (последнего) шага с shimmer;
  // когда завершён — статичное «Рассуждения».
  const runningLabel = currentStepLabel(steps, locale);

  return (
    <ThinkingPanel
      className={className}
      label={runningLabel}
      // Живую карточку показываем, только пока размышление ИДЁТ. Как пошёл
      // финальный ответ (finalized) — панель схлопывается в кнопку, даже если
      // ход ещё не закончен: место в ленте нужно ответу, а не потоку шагов.
      running={isRunning && !finalized}
      steps={steps}
      locale={locale}
      threadId={threadId}
      open={open}
      onOpenChange={setOpen}
    >
      {steps.map((step, i) => (
        <StepRow
          key={i}
          step={step}
          lastOfRunning={isRunning && i === steps.length - 1}
          last={i === steps.length - 1}
          locale={locale}
          threadId={threadId}
          onOpenSubagent={setOpenCallId}
          hideIcon={hideStepIcons}
        />
      ))}
      {openRun && openStep && openStep.kind === "tool" ? (
        <SubagentWindow
          run={openRun}
          running={taskStatus(openStep, isRunning) === "running"}
          locale={locale}
          threadId={threadId}
          onClose={() => setOpenCallId(null)}
        />
      ) : null}
    </ThinkingPanel>
  );
}

/**
 * Карточка-тикет «задача субагенту» (вынесенный из chain-of-thought шаг task).
 * Это НЕ рассуждение — поэтому не прячется в свёрнутую цепочку, а стоит
 * самостоятельным блоком там, где агент поставил задачу.
 *
 * Шапка: заголовок задачи (фраза flash-модели, иначе первая строка брифа) и
 * статус. Ниже — тип, счётчик шагов, время; затем то, что важно в ЭТОМ
 * состоянии: пока работает — что делает прямо сейчас; встал на вопросе —
 * вопрос и (когда есть) ответ оркестратора; закончил — первая строка итога.
 * Бриф целиком — по клику «Задание». Лента субагента — «Подробнее».
 */
function AgentTaskStep({
  step,
  running,
  threadId,
}: {
  step: ToolStep;
  running: boolean;
  threadId: string;
}) {
  // Названия инструментов коннекторов приходят с каталогом — перерисовать по приходу.
  useConnectorLabels();
  const t = useT();
  const { locale } = useLocale();
  const L = t.chat.task;
  const [winOpen, setWinOpen] = useState(false); // окно работы субагента
  const [briefOpen, setBriefOpen] = useState(false); // бриф целиком

  const [historyOpen, setHistoryOpen] = useState(false); // история беседы

  // ОДНА КАРТОЧКА — ОДИН АГЕНТ. Беседа с ним (исходный вызов + продолжения с
  // тем же agent_id: ответы на вопросы, дозадания) собирается контекстом
  // (task-chains-context). Карточку рисует ПОСЛЕДНИЙ дозревший вызов — так
  // повторный запуск агента переносит её вниз ленты, а не обновляет что-то
  // далеко вверху. Заголовок и бриф — от исходного вызова (head), статус,
  // «что делает сейчас» и итог — от последнего; между ними — история.
  // Скрытый шаг (см. useHiddenTaskSteps) карточку не рисует — лента такие
  // уже отфильтровала, здесь страховка (все хуки — до выхода).
  const merged = useHiddenTaskSteps()(step);
  const { chain, isStreaming } = useTaskChain(step);
  const head = chain[0] ?? step;
  const last = chain[chain.length - 1] ?? step;
  const streaming = step.state === "streaming";
  // «Ход идёт» для последнего вызова: если он в этом же сегменте — как у
  // сегмента; если в другом сообщении — по стриму сессии.
  const turnRunning = last === step || last.id === step.id ? running : isStreaming;
  const status = taskStatus(last, turnRunning);
  // Заголовок — фраза по исходному брифу; если исходный вызов вне загруженной
  // страницы истории (в цепочке одни продолжения) — подписываем как ответ;
  // пока фразы нет — нейтральное «Задача для агента».
  const title = isContinuation(head) ? L.continuationTitle : taskTitle(head);
  const type = taskType(head) || taskType(last);
  const question = taskQuestion(last);
  const live = status === "running" ? taskLiveAction(last, locale) : null;
  const result = status === "done" ? taskResultLine(last) : null;
  const brief = descriptionOf(head);
  const toolCount = chainToolCount(chain);
  const bg = last.background;
  const bgRunning = bg?.status === "running";
  const inBackground = chain.some((s) => !!s.background);
  // Лента за всю беседу: начало до вопроса + хвост после ответа.
  const run = mergeChainRuns(chain);
  const events = chainEvents(chain);
  // История есть, когда было чем обменяться: вопрос и ответ, несколько вызовов.
  const hasHistory = chain.length > 1 || events.length > 1;
  // Таймер — только у живого шага (startedAt ставит стрим; в истории его нет).
  const elapsed = useElapsed(last.startedAt, status === "running");

  if (merged) return null;

  return (
    <div className="my-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5">
      {/* Шапка: иконка, заголовок, статус. Пока бриф ещё стримится, заголовка
          нет — показываем нейтральное «Задача для агента». */}
      <div className="flex items-start gap-2">
        <BotIcon size={16} className="mt-0.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-foreground">
          {streaming ? (
            <Shimmer as="span" duration={1.5} accentColor="var(--color-primary)">
              {t.chat.agentTask}
            </Shimmer>
          ) : (
            title || t.chat.agentTask
          )}
        </span>
        {!streaming ? <TaskStatusPill status={status} /> : null}
      </div>

      {/* Тип · шаги · время · фон / продолжение. */}
      {!streaming ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-[11px] text-muted-foreground tabular-nums">
          {type ? (
            <span className="rounded-full border border-border/70 bg-muted px-1.5 py-px font-mono text-[10.5px] tracking-wide">
              {type}
            </span>
          ) : null}
          {isContinuation(step) ? <span>{L.continuation}</span> : null}
          {inBackground ? <span>{L.inBackground}</span> : null}
          {toolCount > 0 ? <span>{pluralize(toolCount, L.steps, locale)}</span> : null}
          {elapsed ? <span>{elapsed}</span> : null}
          {bgRunning ? (
            <button
              type="button"
              onClick={() => chatStreams.stopBackground(threadId, bg.agent_id)}
              className="ml-auto rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t.chat.bg.stop}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Бриф бежит предпросмотром, пока стримится. */}
      {streaming && brief ? (
        <div className="mt-1.5 pl-6">
          <ArgsStreamPreview text={brief} />
        </div>
      ) : null}

      {/* Текущее состояние — пока история свёрнута (раскрытая содержит его
          последней строкой). Что делает прямо сейчас: */}
      {!historyOpen && live ? (
        <div className="mt-2 pl-6 text-sm">
          <Shimmer as="span" duration={1.5} accentColor="var(--color-primary)">
            {live}
          </Shimmer>
        </div>
      ) : null}

      {/* Открытый вопрос оркестратору — ждёт ответа. */}
      {!historyOpen && question && status === "waiting" ? (
        <div className="mt-2 ml-6 rounded-lg bg-amber-500/10 px-2.5 py-2 text-sm">
          <div className="mb-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            {question.kind === "hitl" ? L.permission : L.question}
          </div>
          <div className="whitespace-pre-wrap break-words text-foreground">{question.text}</div>
        </div>
      ) : null}

      {/* Итог — первая строка ответа субагента. */}
      {!historyOpen && result ? (
        <div className="mt-2 pl-6 text-sm text-foreground">
          <span className="text-muted-foreground">{L.result} · </span>
          {result}
        </div>
      ) : null}

      {/* История беседы: вопрос субагента → ответ оркестратора → итог. */}
      {historyOpen ? (
        <ol className="mt-2 ml-6 space-y-2 border-l border-border/70 pl-3 text-sm">
          {events.map((ev, i) => (
            <li key={i}>
              <div className={cn("text-[11px] font-medium", EVENT_TONE[ev.kind])}>
                {ev.kind === "question"
                  ? L.historyQuestion
                  : ev.kind === "answer"
                    ? L.historyAnswer
                    : ev.kind === "result"
                      ? L.historyResult
                      : L.status[ev.kind]}
              </div>
              {ev.text ? (
                <div className="whitespace-pre-wrap break-words text-foreground/90">{ev.text}</div>
              ) : null}
            </li>
          ))}
          {live ? (
            <li>
              <Shimmer as="span" duration={1.5} accentColor="var(--color-primary)">
                {live}
              </Shimmer>
            </li>
          ) : null}
        </ol>
      ) : null}

      {/* Бриф целиком — по клику; кнопки действий. */}
      {!streaming ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          {brief ? (
            <button
              type="button"
              onClick={() => setBriefOpen((v) => !v)}
              aria-expanded={briefOpen}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {L.brief}
              <ChevronRight className={cn("size-3 transition-transform", briefOpen && "rotate-90")} />
            </button>
          ) : null}
          {hasHistory ? (
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {L.history}
              <span className="tabular-nums opacity-60">{events.length}</span>
              <ChevronRight className={cn("size-3 transition-transform", historyOpen && "rotate-90")} />
            </button>
          ) : null}
          {run && step.id ? (
            <button
              type="button"
              onClick={() => setWinOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {L.details}
            </button>
          ) : null}
        </div>
      ) : null}
      {briefOpen && brief ? (
        <div className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words pl-6 text-xs leading-relaxed text-muted-foreground">
          {brief}
        </div>
      ) : null}

      {winOpen && run ? (
        <SubagentWindow
          run={run}
          running={status === "running"}
          locale={locale}
          threadId={threadId}
          onClose={() => setWinOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Цвет подписи события истории: вопрос — янтарный, итог — зелёный, ошибка —
 *  красный, ответ оркестратора и остановки — нейтральные. */
const EVENT_TONE: Record<TaskEvent["kind"], string> = {
  question: "text-amber-700 dark:text-amber-400",
  answer: "text-muted-foreground",
  result: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  cancelled: "text-muted-foreground",
  interrupted: "text-muted-foreground",
};

/**
 * Статус задачи: точка + подпись. Семантические цвета — не акцент бренда:
 * зелёный/красный говорят об исходе, янтарный — «нужен ответ»; акцент только
 * у работающего (пульс).
 */
export function TaskStatusPill({ status }: { status: TaskStatus }) {
  const t = useT();
  const label = t.chat.task.status[status];
  const tone =
    status === "running"
      ? "text-primary"
      : status === "waiting" || status === "answered"
        ? "text-amber-700 dark:text-amber-400"
        : status === "done"
          ? "text-emerald-600 dark:text-emerald-400"
          : status === "error"
            ? "text-destructive"
            : "text-muted-foreground";
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] font-medium whitespace-nowrap", tone)}>
      {status === "running" ? (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      ) : status === "waiting" ? (
        <span className="inline-flex size-2 rounded-full bg-current" />
      ) : null}
      {label}
    </span>
  );
}

/** Прошедшее время от startedAt, тикает раз в секунду, пока active. */
function useElapsed(startedAt: number | undefined, active: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);
  if (!startedAt || !active) return null;
  return formatElapsed(now - startedAt);
}

/**
 * Бегущий предпросмотр содержимого аргументов (текст записываемого файла,
 * задание субагенту): окно в две строки, прижатое к ХВОСТУ текста — видно,
 * что модель пишет прямо сейчас. Верх растворяется маской. Показывается
 * только пока аргументы стримятся; открыть содержимое целиком нельзя нигде.
 *
 * Геометрия — как у ClampedReasoning (leading-[22px], 44px), но окно смотрит
 * на конец текста, а не на начало: у бегущего контента интересен хвост.
 */
function ArgsStreamPreview({ text }: { text: string }) {
  return (
    <div className="flex h-[44px] flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_top,black_34px,transparent_44px)]">
      <p className="break-words text-sm leading-[22px] text-muted-foreground/70 whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

/**
 * Один шаг цепочки (reasoning ИЛИ вызов тула) — мемоизирован. Ключевое для
 * производительности deep-research: при стриме 8 сабагентов стор патчит ленту
 * иммутабельно, поэтому НЕ изменившиеся шаги сохраняют ссылку на тот же объект
 * `step`, и memo пропускает их перерисовку. Перерисовывается только тот шаг,
 * чей сабагент реально получил новые данные — markdown/splitReasoning соседей
 * не пересчитывается. `onOpenSubagent` — стабильный setState, мемо не ломает.
 */
type StepRowProps = {
  step: ThoughtStep;
  /**
   * Шаг — ПОСЛЕДНИЙ в идущем ходе (позиция в ленте + isRunning), а не «шаг
   * выполняется». Разница существенна: тул на последней позиции может уже
   * отработать (пришёл result), и тогда он должен быть зелёным/красным, а не
   * синим. Активность рендера выводится ниже из СОСТОЯНИЯ шага, не из позиции.
   */
  lastOfRunning: boolean;
  /** Последний шаг цепочки — таймлайн не рисует под ним линию. */
  last?: boolean;
  locale: Locale;
  threadId: string;
  onOpenSubagent: (callId: string | null) => void;
  hideIcon?: boolean;
};

const StepRow = memo<StepRowProps>(function StepRow({
  step,
  lastOfRunning,
  last = false,
  locale,
  threadId,
  onOpenSubagent,
  hideIcon = false,
}) {
  // Названия инструментов коннекторов приходят с каталогом — перерисовать по приходу.
  useConnectorLabels();
  if (step.kind === "reasoning") {
    return (
      <TimelineNode
        icon={Sparkles}
        // У рассуждения «идёт» и «последний в ходе» — одно и то же: текст
        // дописывается ровно пока шаг замыкает идущий ход.
        status={lastOfRunning ? "active" : "complete"}
        last={last}
        hideIcon={hideIcon}
        // Фраза-сжатие вместо сырого текста; пока её нет (блок ещё стримится
        // или flash не ответил) — только первые строки с растворением. Полный
        // сырой текст в основной ленте не показывается никогда (решение
        // продукта; у сабагентов — по-прежнему целиком, см. SubagentWindow).
        // animate: фраза, пришедшая на глазах у человека в раскрытой ленте,
        // выезжает слева, старый текст растворяется (в свёрнутом live-окне —
        // мгновенная замена, см. thinking-panel).
        label={
          <ReasoningSummarySwap
            text={step.text}
            summary={step.summary}
            animate
          />
        }
      />
    );
  }
  const Icon = toolIcon(step.name);
  // web_search/web_fetch — свои окошки (запрос+источники / файл).
  // task (deep-research) — вложенная лента запущенного сабагента.
  // Прочие тулы — аргументы плашкой, раскрываются кликом по названию.
  const isSearch = step.name === "web_search";
  const isFetch = step.name === "web_fetch";
  const isTask = step.name === "task";
  // read_file картинки — показываем миниатюру под заголовком шага.
  const isImage = isImageRead(step);
  const query = isSearch ? String(step.args?.query ?? "") : "";
  // Аргументы ещё дозревают в стриме.
  const streaming = step.state === "streaming";
  // Признак завершения — пришедший результат; артефактные тулы (web_search/
  // web_fetch) result не отдают, у них это sources/file.
  const finished = isSearch
    ? Boolean(step.sources)
    : isFetch
      ? Boolean(step.file)
      : Boolean(step.result);
  // Шаг ВЫПОЛНЯЕТСЯ — выводим из состояния, а не из позиции в ленте: вызов
  // отправлен (args дозрели), а результата ещё нет. Именно это, а не
  // «последний шаг хода», означает синий узел и шиммер на заголовке.
  //
  // Плюс lastOfRunning: у шага из ЗАВЕРШЁННОГО хода результата может не быть
  // вовсе (ход прервали, история старого формата) — такой шаг не должен вечно
  // «выполняться», он просто нейтральный.
  const executing = !streaming && !finished && lastOfRunning;
  // Стадия для ЗАГОЛОВКА (время глагола): идёт — «Выполняю команду», закончился
  // — «Команда выполнена» либо форма ошибки. Незавершённый шаг прошлого хода
  // тоже описываем настоящим временем: прошедшее соврало бы о результате.
  const status: ToolStatus =
    streaming || executing || !finished
      ? "running"
      : step.result && !step.result.ok
        ? "failed"
        : "done";
  // Вид УЗЛА таймлайна — отдельная шкала: у него есть нейтральное "complete",
  // которого нет у заголовка. Синий только пока шаг реально идёт; отработавший
  // становится зелёным/красным сразу, не дожидаясь конца хода.
  const nodeStatus: TimelineNodeStatus =
    streaming || executing ? "active" : status === "running" ? "complete" : status;
  const { title, target } = describeTool(step.name, step.args, locale, status);
  // ПРОВАЛИВАНИЯ В АРГУМЕНТЫ БОЛЬШЕ НЕТ (решение продукта): раньше название
  // было кнопкой и раскрывало плашку с сырыми args. Теперь видно ровно то,
  // что в строке: заголовок + цель («Читаю файл abc.txt», «Изучаю навык
  // pdf/creating.md»), а содержимое (текст записываемого файла, задание
  // субагенту) бежит предпросмотром, пока стримится, — открыть его нельзя.
  //
  // target прячем там же, где live-окно: команда bash и URL web_fetch человеку
  // не в теме читаются как шум; у поиска и task свои блоки/окна.
  const hideTarget = step.name === "bash" || isFetch || isSearch || isTask;
  const argsText = contentArgsText(step.args);
  const titleNode =
    streaming || executing ? (
      <Shimmer
        as="span"
        className="font-medium"
        duration={1.5}
        accentColor="var(--color-primary)"
      >
        {title}
      </Shimmer>
    ) : (
      <span className="font-medium">{title}</span>
    );
  return (
    <TimelineNode
      icon={isTask ? Bot : Icon}
      // Статус несёт УЗЕЛ, а не текст: зелёный кружок при успехе, красный при
      // ошибке. В длинной ленте это читается как колонка статусов — неудачный
      // шаг видно, не вчитываясь в заголовки.
      status={nodeStatus}
      last={last}
      hideIcon={hideIcon}
      label={
        // Строка целиком статична: заголовок + цель, кликать некуда.
        // leading-6 = высоте кружка-узла — выравнивание с иконкой.
        <span className="leading-6">
          {titleNode}
          {!hideTarget && target ? (
            <span className="ml-1.5 break-all text-muted-foreground">
              {target}
            </span>
          ) : null}
        </span>
      }
    >
      {isSearch ? (
        query || step.sources?.length ? (
          <SearchSources sources={step.sources ?? []} query={query} />
        ) : null
      ) : isFetch ? (
        step.file ? (
          <FetchedFile file={step.file} threadId={threadId} />
        ) : null
      ) : isTask ? (
        <>
          {/* Задание субагенту бежит предпросмотром, пока стримится; полная
              лента его работы — в отдельном окне по кнопке ниже. */}
          {streaming && argsText ? <ArgsStreamPreview text={argsText} /> : null}
          {step.subagent && step.id ? (
            <button
              type="button"
              onClick={() => onOpenSubagent(step.id ?? null)}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {OPEN_SUBAGENT[locale]}
            </button>
          ) : null}
        </>
      ) : (
        <>
          {/* Прочитанная картинка — миниатюрой, как в живом превью: путь в
              заголовке уже есть, а по картинке видно, что именно агент смотрел. */}
          {isImage ? (
            <ImageThumb path={imagePath(step)} threadId={threadId} />
          ) : null}
          {/* Заданный вопрос — вопросы с вариантами и ответ, когда он есть
              (сама карточка для ответа живёт вне ленты). */}
          {step.name === "ask_user" && !streaming ? (
            <AskUserStep args={step.args} answer={step.result?.output} />
          ) : null}
          {/* Содержимое (текст файла, правка) видно ТОЛЬКО бегущим
              предпросмотром на время стрима — человек видит, что модель
              работает, но провалиться в сырые аргументы нельзя. */}
          {streaming && argsText ? <ArgsStreamPreview text={argsText} /> : null}
        </>
      )}
    </TimelineNode>
  );
});

const SUBAGENT_LABEL: Record<Locale, string> = {
  ru: "Работа субагента",
  en: "Subagent activity",
};

const OPEN_SUBAGENT: Record<Locale, string> = {
  ru: "Подробнее",
  en: "Details",
};

/**
 * Модальное окно поверх ленты чата: оверлей в области #chat-area, закрывается
 * крестиком / кликом по фону / Escape. Общая оболочка для окна работы субагента
 * и окна полной ленты рассуждений — чтобы обе открывались ОДИНАКОВО.
 */
export function ChatWindow({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Контейнер для портала — область рабочего чата (#chat-area). Окно центрируем
  // внутри неё, а не во всём вьюпорте. На SSR/первом рендере document нет —
  // держим в состоянии и заполняем ОДИН РАЗ после маунта (пустые зависимости).
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("chat-area"));
  }, []);

  // onClose — новая функция на каждый рендер родителя; держим её в ref, чтобы
  // эффект-слушатель Escape НЕ пересоздавался каждый рендер (иначе setState в
  // нём → перезапуск эффекта → бесконечный цикл «Maximum update depth»).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!host) return null;

  return createPortal(
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>,
    host,
  );
}

/**
 * Окно работы запущенного субагента — оверлей поверх чата, открывается с
 * карточки задачи («Подробнее») и из панели субагентов, закрывается крестиком
 * / кликом по фону / Escape.
 *
 * Внутри — ТА ЖЕ лента, что у ответа ассистента (см. AssistantBubble в
 * chat.tsx): части run.parts по порядку — свёрнутая цепочка рассуждений и
 * тулов (ThoughtStream: живая панель, пока работает; кнопка «Рассуждения»,
 * когда закончил) и видимый текст между ними и в конце (ответ оркестратору).
 * Раньше здесь был свой плоский таймлайн из всех шагов подряд — прежний стиль,
 * который основная лента уже пережила.
 *
 * `running` — субагент ещё работает: шиммер на последней цепочке. Знает это
 * вызывающий (статус карточки / записи панели), а не сама лента.
 */
export function SubagentWindow({
  run,
  running = false,
  locale,
  threadId,
  onClose,
}: {
  run: SubagentRun;
  running?: boolean;
  locale: Locale;
  threadId: string;
  onClose: () => void;
}) {
  const parts = run.parts;
  // Как в AssistantBubble: «работает» — последняя цепочка, пока субагент
  // работает; цепочка сворачивается, как только ПОСЛЕ неё пошёл текст.
  const lastChainIndex = parts.map((p) => p.type).lastIndexOf("chain");
  return (
    <ChatWindow
      title={SUBAGENT_LABEL[locale]}
      icon={<BotIcon size={16} className="shrink-0 text-primary" />}
      onClose={onClose}
    >
      {parts.length === 0 && running ? (
        <Shimmer as="span" className="text-sm" duration={1.5} accentColor="var(--color-primary)">
          {HEADER[locale].running}
        </Shimmer>
      ) : null}
      {parts.map((p, i) =>
        p.type === "chain" ? (
          <ThoughtStream
            key={i}
            steps={p.steps}
            isRunning={running && i === lastChainIndex}
            finalized={parts.slice(i + 1).some((q) => q.type === "text")}
            threadId={threadId}
          />
        ) : (
          <MessageResponse
            // Ключ по порядку текстовых частей, как в основной ленте: вставка
            // цепочки между текстами не должна перемонтировать абзац.
            key={`t${parts.slice(0, i).filter((q) => q.type === "text").length}`}
            className="text-sm"
            isAnimating={running && i === parts.length - 1}
          >
            {p.text}
          </MessageResponse>
        ),
      )}
    </ChatWindow>
  );
}
