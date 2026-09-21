"use client";

import { createContext, useContext, useMemo } from "react";
import type { ChatMessage } from "@/lib/chat-streams";
import { agentAddress, groupTaskChains, type TaskStep } from "@/lib/task-card";

/**
 * Беседы с субагентами всей видимой ленты — для карточек задач.
 *
 * Одна карточка — один агент, а продолжения (`task` с agent_id: ответ на его
 * вопрос, дозадание) могут лежать в ДРУГИХ сообщениях: у фонового агента
 * вопрос приходит репортом в новом ходе, и ответ оркестратора — там же.
 * Карточка внутри одного сообщения этого не видит, поэтому цепочки собирает
 * список (Chat) и раздаёт контекстом.
 *
 * Карточку рисует ПОСЛЕДНИЙ вызов беседы, а не исходный: продолжение
 * завершённого или остановленного агента — это новая работа, и её место —
 * внизу ленты, где человек смотрит. Пока карточка стояла у исходного вызова,
 * повторный запуск того же агента ничем не отличался от старой карточки где-то
 * выше — казалось, что ничего не обновляется. Заголовок и бриф при этом
 * по-прежнему от исходного вызова (см. AgentTaskStep).
 */
type Value = { chains: Map<string, TaskStep[]>; isStreaming: boolean };

const Ctx = createContext<Value>({ chains: new Map(), isStreaming: false });

export function TaskChainsProvider({
  messages,
  isStreaming,
  children,
}: {
  messages: ChatMessage[];
  isStreaming: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ chains: groupTaskChains(messages), isStreaming }),
    [messages, isStreaming],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Беседа, в которой участвует шаг (сам шаг, если цепочек нет). */
export function useTaskChain(step: TaskStep): { chain: TaskStep[]; isStreaming: boolean } {
  const { chains, isStreaming } = useContext(Ctx);
  const chain = chains.get(agentAddress(step)) ?? [step];
  return { chain, isStreaming };
}

/**
 * Какие шаги task в ленте НЕ рисуются карточкой. Одна функция для ленты
 * (ThoughtStream убирает их ДО разбиения на сегменты — иначе на месте скрытой
 * карточки оставался разрыв, и два «Рассуждения» шли подряд без текста между
 * ними) и для самой карточки.
 *
 * Карточку рисует ПОСЛЕДНИЙ дозревший вызов беседы (якорь), все прежние
 * скрыты. Стримящиеся вызовы якорем не бывают: пока аргументы не дозрели, шаг
 * вообще не карточка, а строка цепочки (см. isTaskCardStep) — иначе на время
 * стрима продолжения карточка исчезала бы и появлялась заново ниже.
 */
export function useHiddenTaskSteps(): (step: TaskStep) => boolean {
  const { chains } = useContext(Ctx);
  return useMemo(
    () => (step: TaskStep) => {
      const anchor = chainAnchor(chains.get(agentAddress(step)));
      return !!anchor && anchor !== step && anchor.id !== step.id;
    },
    [chains],
  );
}

/** Вызов, у которого стоит карточка: последний с дозревшими аргументами. */
export function chainAnchor(chain: TaskStep[] | undefined): TaskStep | undefined {
  if (!chain) return undefined;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].state !== "streaming") return chain[i];
  }
  return undefined;
}
