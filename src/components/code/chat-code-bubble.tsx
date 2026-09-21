"use client";

// Рендер ответа агента во вкладке Avy Code. Вынесено из общего chat.tsx, чтобы
// code-режим и обычный чат не делили файл рендера (чистые мерджи с pre-prod).
//
// Логика: идём по частям ответа; идущие подряд reasoning-шаги группируем в один
// свёрнутый аккордеон (ThoughtChain), тулы между ними рисуем построчно
// (CodeToolSteps) с иконкой-таймлайном слева. Текстовые части — обычный markdown.

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { Sparkles, FileText, FilePen, Terminal, Wrench, MessageSquare, CircleQuestionMark, Globe, Download, Bot, Plug, Brain } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThoughtChain } from "@/components/code/code-tool-steps-base";
import { CodeToolSteps } from "@/components/chat/code-tool-steps";
import type { MessagePart, ThoughtStep } from "@/lib/code/code-chat-streams";

/** Анимированные точки ожидания ответа (как в основном чате). */
function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-2 text-primary">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-current"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}

const TOOL_ICONS_MAP: Record<string, React.ElementType> = {
  bash: Terminal, read_file: FileText, write_file: FilePen,
  edit_file: FilePen, ls: FileText, glob: FileText, grep: FileText,
  ask_user: CircleQuestionMark, web_search: Globe, web_fetch: Download,
  task: Bot, // спавн сабагента — голова агента, не гаечный ключ
  remember: Brain, // запись в проектную память — «мозг», не гаечный ключ
  // (Brain, а не BrainCircuit: последний рисует ПОЛОВИНУ мозга и в мелком
  // размере читается как перевёрнутый значок.)
};

// ── Обёртки со СТАБИЛЬНЫМИ пропсами ──────────────────────────────────────────
// entries ниже пересобираются на каждый кадр стрима (parts — новая ссылка), и
// инлайновые steps={[step]} / steps={reasoningGroup} создавали НОВЫЙ массив
// каждый кадр — memo внутри CodeToolSteps/ThoughtChain пробивался shallow-
// сравнением, и ВСЯ цепочка шагов длинного хода перерисовывалась 60 раз/сек
// (фризы + рваный скролл, растущие с длиной хода). Стор при этом сохраняет
// ссылки НЕизменившихся шагов — здесь мы возвращаем это свойство в пропсы:
// массив мемоизируется по ссылке шага, а группы сравниваются поэлементно.
// Итог: на кадр перерисовывается только реально изменившийся шаг.

const ToolStepEntry = memo(function ToolStepEntry({
  step,
  active,
  threadId,
  onOpenFile,
  onOpenMemory,
}: {
  step: ThoughtStep;
  active: boolean;
  threadId: string;
  onOpenFile?: (path: string, searchText?: string) => void;
  onOpenMemory?: (path: string) => void;
}) {
  const steps = useMemo(() => [step], [step]);
  return (
    <CodeToolSteps
      steps={steps}
      isRunning={active}
      threadId={threadId}
      onOpenFile={onOpenFile}
      onOpenMemory={onOpenMemory}
    />
  );
});

/** Поэлементное сравнение групп шагов: ссылки элементов стабильны у стора. */
function sameSteps(a: ThoughtStep[], b: ThoughtStep[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const ReasoningEntry = memo(
  function ReasoningEntry({
    steps,
    isRunning,
    finalized,
    threadId,
  }: {
    steps: ThoughtStep[];
    isRunning: boolean;
    finalized: boolean;
    threadId: string;
  }) {
    return (
      <ThoughtChain
        steps={steps}
        isRunning={isRunning}
        finalized={finalized}
        threadId={threadId}
        // pt-0.5 ровняет заголовок с текстом сообщения: у markdown-текста строка
        // 15px/leading-relaxed (~24px), у заголовка text-sm — 20px; без добавки
        // «Рассуждения» стоят на 2px выше соседних текстовых блоков таймлайна.
        className="my-0 space-y-0 pt-0.5"
        hideStepIcons
      />
    );
  },
  (prev, next) =>
    sameSteps(prev.steps, next.steps) &&
    prev.isRunning === next.isRunning &&
    prev.finalized === next.finalized &&
    prev.threadId === next.threadId,
);

/**
 * Avy Code: рендерим steps в правильном порядке — consecutive reasoning-шаги
 * группируем в один свёрнутый аккордеон, тулы между ними — inline построчно.
 */
function AssistantBubbleCodeInner({
  parts,
  running,
  threadId,
  urlTransform,
  onOpenFile,
  onOpenMemory,
}: {
  parts: MessagePart[];
  running: boolean;
  threadId: string;
  urlTransform: (url: string) => string | null;
  onOpenFile?: (path: string, searchText?: string) => void;
  onOpenMemory?: (path: string) => void;
}) {
  // Построение дерева ответа — в useMemo. Раньше `entries` пересобирались на
  // КАЖДОМ рендере (стор эмитит раз в кадр rAF, ~60/сек при стриминге), и каждый
  // раз создавались НОВЫЕ ноды MessageResponse/ThoughtChain/CodeToolSteps с
  // новыми пропсами (steps={[step]} — новая ссылка каждый кадр) и ключами по
  // индексу entries. Из-за этого memo внутри CodeToolSteps/ThoughtChain НИКОГДА
  // не срабатывал → всё поддерево ответа (тяжёлый markdown-парсинг Streamdown +
  // подсветка) перерисовывалось целиком каждый кадр. Отсюда фризы в code-режиме
  // (в обычном чате этого нет) и, как следствие, «залипание» approval-карточки:
  // главный поток занят рендером, rAF-колбэк со сбросом isStreaming=false
  // доезжает с задержкой, а кнопки disabled по isStreaming.
  //
  // Теперь entries пересобираются ТОЛЬКО когда меняется parts/running/threadId.
  // При стриминге хвостового текста меняется лишь последняя text-часть; ключи
  // стабильны по позиции части/шага (pi/si/groupStart), поэтому React
  // переиспользует ноды завершённых частей, а memo под-компонентов срабатывает.
  const entries = useMemo(() => {
    type NodeEntry = { key: string; node: React.ReactNode; Icon: React.ElementType; iconColor: string };
    const acc: NodeEntry[] = [];

    parts.forEach((p, pi) => {
      if (p.type === "text") {
        acc.push({
          key: `t-${pi}`,
          Icon: MessageSquare,
          iconColor: "text-muted-foreground",
          node: (
            <MessageResponse urlTransform={urlTransform}>
              {p.text}
            </MessageResponse>
          ),
        });
        return;
      }

      const isLastPart = pi === parts.length - 1;
      const isRunningPart = running && isLastPart;
      const finalized = parts.slice(pi + 1).some((q) => q.type === "text");

      let reasoningGroup: ThoughtStep[] = [];
      let groupStart = 0;

      const flushReasoning = (beforeIdx: number) => {
        if (reasoningGroup.length === 0) return;
        const isLastInGroup = isRunningPart && beforeIdx === p.steps.length;
        acc.push({
          key: `r-${pi}-${groupStart}`,
          Icon: Sparkles,
          iconColor: "text-muted-foreground",
          node: (
            <ReasoningEntry
              steps={reasoningGroup}
              isRunning={isLastInGroup}
              finalized={finalized || beforeIdx < p.steps.length}
              threadId={threadId}
            />
          ),
        });
        reasoningGroup = [];
      };

      p.steps.forEach((step, si) => {
        if (step.kind === "reasoning") {
          if (reasoningGroup.length === 0) groupStart = si;
          reasoningGroup.push(step);
        } else {
          flushReasoning(si);
          const isLastStep = si === p.steps.length - 1;
          // MCP-тул (mcp__<server>__<tool>) — своя иконка «вилка/разъём»:
          // это инструмент ПОДКЛЮЧЁННОГО сервера, а не встроенный. Гаечный
          // ключ остаётся фолбэком для по-настоящему неизвестных тулов.
          const ToolIcon =
            TOOL_ICONS_MAP[step.name] ?? (step.name.startsWith("mcp__") ? Plug : Wrench);
          const hasResult = step.result !== undefined;
          const isActive = isRunningPart && isLastStep;
          const toolIconColor = isActive && !hasResult
            ? "text-muted-foreground"
            : hasResult
              ? step.result!.ok ? "text-emerald-500" : "text-destructive"
              : "text-muted-foreground";
          acc.push({
            key: `tool-${pi}-${si}`,
            Icon: ToolIcon,
            iconColor: toolIconColor,
            node: (
              <ToolStepEntry
                step={step}
                active={isActive}
                threadId={threadId}
                onOpenFile={onOpenFile}
                onOpenMemory={onOpenMemory}
              />
            ),
          });
        }
      });

      flushReasoning(p.steps.length);
    });

    return acc;
  }, [parts, running, threadId, urlTransform, onOpenFile, onOpenMemory]);

  // Ответ ещё не начался — показываем индикатор ожидания (точки).
  if (parts.length === 0) {
    return running ? <TypingDots /> : null;
  }

  return (
    <div className="flex flex-col">
      {entries.map(({ key, node, Icon, iconColor }, i) => (
        <div key={key} className="flex gap-2">
          <div className="flex flex-col items-center">
            <Icon className={`mt-0.5 size-4 shrink-0 transition-colors ${iconColor}`} />
            {i < entries.length - 1 && (
              <div className="my-1 w-px flex-1 bg-border" />
            )}
          </div>
          {/* min-w-0 ОБЯЗАТЕЛЕН: у flex-детей min-width:auto, и один широкий
              неразрывный ребёнок (код-блок в markdown) раздувал мин-ширину всей
              колонки контента — при неразвёрнутом окне ВЕСЬ текст сообщения
              вёрстался шире видимой области и обрезался overflow-x-hidden'ом
              ConversationContent вместо переноса строк. С min-w-0 колонка честно
              ужимается до доступной ширины, а широкие блоки скроллятся внутри
              себя (у Streamdown-код-блоков свой overflow-x-auto). */}
          <div className="min-w-0 flex-1 pb-6">{node}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * memo: стример отдаёт новый массив messages каждый кадр, но ссылку на КАЖДОЕ
 * неизменившееся сообщение сохраняет (см. code-message-row). Для активного
 * (стримящегося) ряда пропсы реально меняются — там memo и не должен спасать,
 * зато useMemo внутри переиспользует ноды завершённых частей. Для НЕактивных
 * рядов memo пропускает перерисовку целиком.
 */
export const AssistantBubbleCode = memo(AssistantBubbleCodeInner);
