"use client";

// Code-режим: обработчики событий стрима и функции управления permission.
//
// Вынесено из chat-streams.ts, чтобы основной стор оставался чисто чатовым.
// Этот модуль НЕ импортирует chatStreams напрямую (циклический импорт).
// Вместо этого экспортирует функции, которые chat-streams.ts вызывает,
// передавая необходимые зависимости (rec, setState, consume, streamChat, resumeBubble).

import { streamChat, type ChatEvent } from "@/lib/api";
import type { PendingPermission } from "@/lib/chat-streams";

/** Параметры code-хода, нужные для возобновления после approval. */
export type CodeRunParams = {
  modelId?: string;
  effort?: string | null;
  /** Режим прерванного хода: null — обычный чат. */
  mode?: string | null;
  permissionMode?: string | null;
  /** Агент из библиотеки, которым шёл прерванный ход; пусто — ассистент. */
  agentId?: string | null;
  onTitle?: (title: string) => void;
  onDone?: (threadId: string) => void;
};

/** Накопленное решение по карточке approval. */
export type PermissionDecision = {
  type: "approve" | "reject";
  comment?: string;
};

type RunCallbacks = {
  onTitle?: (title: string) => void;
  onDone?: (threadId: string) => void;
};

/** Зависимости store, передаваемые из chat-streams.ts. */
export type StoreDeps = {
  rec: (threadId: string) => {
    state: { pendingPermissions: PendingPermission[] };
    codeRun: CodeRunParams | null;
    assistantId: string | null;
    ctrl: AbortController | null;
    pendingDecisions: PermissionDecision[];
  };
  setState: (threadId: string, patch: Record<string, unknown>) => void;
  consume: (
    threadId: string,
    source: AsyncGenerator<ChatEvent>,
    assistantId: string,
    cbs: RunCallbacks,
  ) => Promise<void>;
  /** Пузырь-приёмник продолжения: прежний, если он ещё в ленте, иначе новый. */
  resumeBubble: (threadId: string) => string;
};

/**
 * Обработать событие permission_request из стрима.
 *
 * Агент вызвал один или несколько тулов параллельно — каждый приходит
 * отдельным permission_request. Накапливаем в очередь; UI показывает
 * карточки по одной, resume уходит после последней.
 */
export function handlePermissionRequest(
  deps: StoreDeps,
  threadId: string,
  ev: {
    interrupt_id?: string;
    tool: string;
    args: Record<string, unknown>;
    description?: string;
  },
): void {
  const r = deps.rec(threadId);
  const next: PendingPermission = {
    interruptId: ev.interrupt_id ?? null,
    tool: ev.tool,
    args: ev.args,
    description: ev.description ?? "",
  };
  deps.setState(threadId, {
    pendingPermissions: [...r.state.pendingPermissions, next],
  });
}

/**
 * Ответить на одну карточку из очереди approval.
 *
 * Агент может вызвать N тулов параллельно → N событий permission_request в
 * очереди. Показываем карточки по одной; решения копим в r.pendingDecisions.
 * Когда пользователь ответил на последнюю карточку — отправляем все решения
 * сразу одним resume и возобновляем ход.
 */
export async function resolvePermission(
  deps: StoreDeps,
  threadId: string,
  decision: "approve" | "reject",
  comment?: string,
): Promise<void> {
  const r = deps.rec(threadId);
  const queue = r.state.pendingPermissions;
  const code = r.codeRun;
  if (queue.length === 0 || !code) return;

  // Записываем решение по первой карточке.
  r.pendingDecisions = [
    ...r.pendingDecisions,
    { type: decision, ...(comment ? { comment } : {}) },
  ];

  // Убираем первую карточку из очереди.
  const remaining = queue.slice(1);

  if (remaining.length > 0) {
    // Ещё есть карточки — показываем следующую, ход пока на паузе.
    deps.setState(threadId, { pendingPermissions: remaining });
    return;
  }

  // Все карточки пройдены — снимаем очередь, возобновляем ход. Пузырь тот
  // же, пока он в ленте; после перечитывания истории — новый (resumeBubble).
  const decisions = r.pendingDecisions;
  r.pendingDecisions = [];
  deps.setState(threadId, {
    isStreaming: true,
    error: null,
    pendingPermissions: [],
  });

  const assistantId = deps.resumeBubble(threadId);

  const ctrl = new AbortController();
  r.ctrl = ctrl;
  try {
    await deps.consume(
      threadId,
      streamChat(
        {
          message: "",
          threadId,
          modelId: code.modelId,
          effort: code.effort,
          // Режим — ТОТ ЖЕ, что у прерванного хода. Раньше здесь стояло
          // "avy-code" намертво: подтверждение бывало только у кодера. Теперь
          // его запрашивает и обычный чат (`confirm:` у агента, инструменты
          // коннекторов), а тред чата в чужом режиме сервер отклоняет (409).
          mode: code.mode ?? null,
          permissionMode: code.permissionMode,
          // Агент — ТОТ ЖЕ, что вёл прерванный ход. Без него сервер собрал бы
          // универсального ассистента, и подтверждённый вызов достался бы
          // чужому набору инструментов: своих тул агента в нём нет.
          agentId: code.agentId,
          resume: decisions,
        },
        ctrl.signal,
      ),
      assistantId,
      { onTitle: code.onTitle, onDone: code.onDone },
    );
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      deps.setState(threadId, { error: (e as Error).message });
    } else {
      return;
    }
  }
  if (r.ctrl === ctrl) r.ctrl = null;
  deps.setState(threadId, { isStreaming: false });
  code.onDone?.(threadId);
}
