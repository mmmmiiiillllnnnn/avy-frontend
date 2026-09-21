"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Terminal,
  FileText,
  FilePen,
  Wrench,
  Sparkles,
  Globe,
  Download,
  Bot,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { CodingBlock } from "@/components/chat/coding-block";
import { SearchSources } from "@/components/chat/search-sources";
import { FetchedFile } from "@/components/chat/fetched-file";
import { ToolArgs } from "@/components/code/code-tool-args";
import type { Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { useLocale } from "@/i18n/i18n-context";
import { describeTool } from "@/lib/code/code-tool-labels";
import { splitReasoning } from "@/lib/reasoning-segments";
import type { SubagentRun, ThoughtStep } from "@/hooks/use-code-chat";

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

const TOOL_ICONS: Record<string, LucideIcon> = {
  bash: Terminal,
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
  ls: FileText,
  glob: FileText,
  grep: FileText,
  web_search: Globe,
  web_fetch: Download,
};

/**
 * Единая цепочка размышлений агента: reasoning-блоки и вызовы инструментов
 * в том порядке, в каком они происходили (подумал → вызвал → подумал → ответил).
 * Сворачиваемый блок (AI Elements ChainOfThought). Открыт, пока агент работает.
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

  // Отступы свёрнутого состояния — ПОД className вызывающего: в ленте Avy Code
  // (chat-code-bubble) иконка шага стоит в отдельной колонке, и компенсирующий
  // mt-2 из обычного чата уводил заголовок «Рассуждения» вниз от иконки.
  // cn (twMerge) даёт my-0 вызывающего победить.
  return (
    <ChainOfThought
      className={cn(open ? "" : "mt-2 -mb-2", className)}
      open={open}
      onOpenChange={setOpen}
    >
      <ChainOfThoughtHeader hideIcon={hideStepIcons}>
        {isRunning ? (
          <Shimmer as="span" duration={1.5} accentColor="var(--color-primary)">
            {runningLabel}
          </Shimmer>
        ) : (
          HEADER[locale].done
        )}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((step, i) => (
          <StepRow
            key={i}
            step={step}
            active={isRunning && i === steps.length - 1}
            locale={locale}
            threadId={threadId}
            onOpenSubagent={setOpenCallId}
            hideIcon={hideStepIcons}
          />
        ))}
      </ChainOfThoughtContent>
      {openRun ? (
        <SubagentWindow
          run={openRun}
          locale={locale}
          threadId={threadId}
          onClose={() => setOpenCallId(null)}
        />
      ) : null}
    </ChainOfThought>
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
  active: boolean;
  locale: Locale;
  threadId: string;
  onOpenSubagent: (callId: string | null) => void;
  hideIcon?: boolean;
};

const StepRow = memo<StepRowProps>(function StepRow({
  step,
  active,
  locale,
  threadId,
  onOpenSubagent,
  hideIcon = false,
}) {
  if (step.kind === "reasoning") {
    return (
      <ChainOfThoughtStep
        icon={Sparkles}
        status={active ? "active" : "complete"}
        label={<ReasoningBody text={step.text} active={active} locale={locale} />}
        className={hideIcon ? "[&>div:first-child]:hidden" : undefined}
      />
    );
  }
  const Icon = TOOL_ICONS[step.name] ?? Wrench;
  const { title } = describeTool(step.name, step.args, locale);
  // web_search/web_fetch — свои окошки (запрос+источники / файл).
  // task (deep-research) — вложенная лента запущенного сабагента.
  // Прочие тулы — свёрнутый блок «Аргументы» под шагом.
  const isSearch = step.name === "web_search";
  const isFetch = step.name === "web_fetch";
  const isTask = step.name === "task";
  const query = isSearch ? String(step.args?.query ?? "") : "";
  // Шиммер на заголовке: аргументы ещё стримятся ИЛИ тул выполняется (available, нет result).
  const streaming = step.state === "streaming";
  const executing = active && step.kind === "tool" && step.state === "available" && !step.result;
  return (
    <ChainOfThoughtStep
      icon={isTask ? Bot : Icon}
      status={active ? "active" : "complete"}
      label={
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
        )
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
          <ToolArgs args={step.args} streaming={streaming} />
          {step.subagent && step.id ? (
            <button
              type="button"
              onClick={() => onOpenSubagent(step.id ?? null)}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bot className="size-3.5" />
              {OPEN_SUBAGENT[locale]}
            </button>
          ) : null}
        </>
      ) : (
        <ToolArgs args={step.args} streaming={streaming} />
      )}
    </ChainOfThoughtStep>
  );
});

/**
 * Тело одного reasoning-шага: обычный текст рендерим markdown'ом, а ```код```
 * вытаскиваем в свёрнутый CodingBlock («Пишу код»). Shimmer на коде — только
 * если шаг активен И это последний, ещё не закрытый блок (агент печатает код
 * прямо сейчас); закрытые блоки и текст — без анимации.
 */
function ReasoningBody({
  text,
  active,
  locale,
}: {
  text: string;
  active: boolean;
  locale: Locale;
}) {
  const segments = splitReasoning(text);
  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <MessageResponse
              key={i}
              className="text-sm text-muted-foreground"
            >
              {seg.text}
            </MessageResponse>
          );
        }
        const isLast = i === segments.length - 1;
        return (
          <CodingBlock
            key={i}
            markdown={seg.markdown}
            active={active && isLast && !seg.closed}
            locale={locale}
          />
        );
      })}
    </>
  );
}

const SUBAGENT_LABEL: Record<Locale, string> = {
  ru: "Работа субагента",
  en: "Subagent activity",
};

const OPEN_SUBAGENT: Record<Locale, string> = {
  ru: "Открыть работу субагента",
  en: "Open subagent activity",
};

/**
 * Окно работы запущенного сабагента (deep-research) — оверлей поверх чата,
 * открывается кликом по чипу шага task и закрывается крестиком / кликом по фону
 * / Escape. Внутри — лента сабагента: его размышления, вызовы web_search/
 * web_fetch (с источниками/файлами) и финальный ответ оркестратору.
 */
export function SubagentWindow({
  run,
  locale,
  threadId,
  onClose,
}: {
  run: SubagentRun;
  locale: Locale;
  threadId: string;
  onClose: () => void;
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

  // Закрытие по Escape (окно — модальное поверх ленты). Вешаем один раз.
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
            <Bot className="size-4" />
            {SUBAGENT_LABEL[locale]}
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
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          {run.steps.map((step, i) => {
            if (step.kind === "reasoning") {
              return (
                <ChainOfThoughtStep
                  key={i}
                  icon={Sparkles}
                  status="complete"
                  label={
                    <ReasoningBody
                      text={step.text}
                      active={false}
                      locale={locale}
                    />
                  }
                />
              );
            }
            const Icon = TOOL_ICONS[step.name] ?? Wrench;
            const { title } = describeTool(step.name, step.args, locale);
            const isSearch = step.name === "web_search";
            const isFetch = step.name === "web_fetch";
            const query = isSearch ? String(step.args?.query ?? "") : "";
            const streaming = step.state === "streaming";
            return (
              <ChainOfThoughtStep
                key={i}
                icon={Icon}
                status="complete"
                label={<span className="font-medium">{title}</span>}
              >
                {isSearch ? (
                  query || step.sources?.length ? (
                    <SearchSources sources={step.sources ?? []} query={query} />
                  ) : null
                ) : isFetch ? (
                  step.file ? (
                    <FetchedFile file={step.file} threadId={threadId} />
                  ) : null
                ) : (
                  <ToolArgs args={step.args} streaming={streaming} />
                )}
              </ChainOfThoughtStep>
            );
          })}
          {run.text ? (
            <MessageResponse className="mt-3 border-t border-border/60 pt-3 text-sm">
              {run.text}
            </MessageResponse>
          ) : null}
        </div>
      </div>
    </div>,
    host,
  );
}
