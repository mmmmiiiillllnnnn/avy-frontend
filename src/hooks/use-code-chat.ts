"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { uploadSessionFiles, type AskUserAnswer, type UploadedFile } from "@/lib/api";
import { filesToLocalAttachments, hasLocalCodeAgent } from "@/lib/code/code-streams";
import {
  chatStreams,
  type Attachment,
  type BgTask,
  type ChatMessage,
  type MessagePart,
  type Role,
} from "@/lib/code/code-chat-streams";

// Типы ленты живут в сторе (он — источник правды для состояния хода). Ре-экспорт
// для обратной совместимости импортов (chat.tsx и др. берут их отсюда).
export type { Attachment, ChatMessage, MessagePart, Role, SubagentRun, ThoughtStep } from "@/lib/code/code-chat-streams";

type UseChatOptions = {
  threadId?: string;
  modelId?: string;
  effort?: string | null;
  mode?: string | null;
  /** Режим Avy Code: уровень автономии approval (ask | accept-edits | plan). */
  permissionMode?: string | null;
  /** Вызывается после завершения хода (для подхвата фонового заголовка и т.п.). */
  onDone?: (threadId: string) => void;
  /** Вызывается, когда сервер сгенерировал заголовок сессии (первый ход). */
  onTitle?: (title: string) => void;
};

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_BG_TASKS: BgTask[] = [];

/**
 * Тонкая обёртка над сторам стримов (lib/chat-streams), привязанная к активной
 * сессии. Состояние хода живёт в сторе ПО threadId и переживает переключение
 * сессий: уйдя в другую сессию, мы лишь «отцепляем» локальный цикл чтения (ход
 * на сервере продолжается), а вернувшись — переподключаемся (reattach).
 *
 * Контракт наружу прежний: { messages, isStreaming, error, send, stop, reset,
 * setHistory } — поэтому ChatWorkspace/Chat почти не меняются.
 */
export function useChat(opts: UseChatOptions = {}) {
  const threadId = opts.threadId ?? "";

  // Подписка на срез стора активной сессии (внешний стор → useSyncExternalStore).
  const state = useSyncExternalStore(
    useCallback(
      (cb) => (threadId ? chatStreams.subscribe(threadId, cb) : () => {}),
      [threadId],
    ),
    () => (threadId ? chatStreams.getState(threadId) : undefined),
    () => undefined,
  );

  const messages = state?.messages ?? EMPTY_MESSAGES;
  const isStreaming = state?.isStreaming ?? false;
  const error = state?.error ?? null;
  // Режим Avy Code: первая карточка из очереди (или null) + размер очереди.
  const pendingPermissions = state?.pendingPermissions ?? [];
  const pendingPermission = pendingPermissions[0] ?? null;
  // Режим Avy Code: карточка ask_user (уточняющие вопросы), или null.
  const pendingQuestions = state?.pendingQuestions ?? null;
  // Режим Avy Code: фоновые процессы треда (панель фоновых задач).
  const bgTasks = state?.bgTasks ?? EMPTY_BG_TASKS;

  // При входе в сессию пытаемся переподключиться к идущему на сервере ходу.
  // No-op, если хода нет (attach сразу вернёт done) или локальный цикл уже жив.
  useEffect(() => {
    if (!threadId) return;
    void chatStreams.reattach(threadId, {
      onTitle: opts.onTitle,
      onDone: opts.onDone,
    });
    // Уходя из сессии — отцепляем локальный цикл (ход на сервере НЕ трогаем).
    return () => {
      chatStreams.detach(threadId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Avy Code + локальный агент: ПОСТОЯННАЯ подписка на события треда, живущая
  // вне ходов. Нужна для событий, которые порождает main-процесс САМ, а не в
  // ответ на renderer-ход: bg_task (панель фоновых задач) и «wake»-ход —
  // реакция агента на завершение фоновой bash-команды (sessionManager.runWake).
  // Такие события не видит consume() (его генератор жив только на время
  // renderer-хода), поэтому роутим их в applyBackgroundEvent, который сам
  // отсеивает дубли активного хода (см. chat-streams.ts). onEvent мультиплексирует
  // подписчиков, так что эта подписка не мешает subscribeCodeAgentEvents.
  useEffect(() => {
    if (!threadId || opts.mode !== "avy-code" || !hasLocalCodeAgent()) return;
    const bridge = window.avyDesktop?.codeAgent;
    if (!bridge) return;
    // Панель фоновых задач: подтягиваем durable-историю треда (переживает
    // рестарт приложения) — running прошлого запуска придут как stopped.
    chatStreams.loadBgTasks(threadId);
    const unsubscribe = bridge.onEvent(threadId, (ev) => {
      chatStreams.applyBackgroundEvent(threadId, ev);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, opts.mode]);

  const send = useCallback(
    async (text: string, files: File[] = []) => {
      const trimmed = text.trim();
      if (!threadId) return;
      if ((!trimmed && files.length === 0) || chatStreams.isStreaming(threadId)) {
        return;
      }

      let attachments: Attachment[] | undefined;
      let codeAttachments: { name: string; mime: string; data: string }[] | undefined;
      let sendMessage = trimmed;

      if (opts.mode === "avy-code" && hasLocalCodeAgent()) {
        // Локальный агент: файл никогда не покидает машину пользователя —
        // читаем и base64-кодируем в renderer'е (сервер тут вообще не участвует,
        // File.path недоступен в Electron). Содержимое инжектится в сообщение
        // локальным агентом (см. apps/code-cli/src/agent/attachments.ts).
        if (files.length) {
          const res = await filesToLocalAttachments(files);
          attachments = res.display;
          codeAttachments = res.forAgent;
        }
      } else if (files.length) {
        // Сначала грузим вложения (должны лежать в песочнице до старта хода).
        const res = await uploadSessionFiles(threadId, files, opts.mode);
        const uploaded: UploadedFile[] = res.files;
        attachments = uploaded.map((f) => ({
          path: f.path,
          name: f.name,
          mime: f.mime,
          thumbUrl: f.thumbUrl,
        }));
        // Ошибки прикрепления показываем как ошибку сессии (не срывая отправку).
        if (res.errors.length) {
          const names = res.errors.map((e) => e.name).join(", ");
          chatStreams.setError(threadId, `Не удалось прикрепить: ${names}`);
        }
        // Обычный чат: дописываем блок путей файлов (/uploads/...) — агент
        // читает их через read_file по пути. Avy Code (без локального агента,
        // старый серверный путь): сервер сам инжектит содержимое в сообщение.
        if (uploaded.length && opts.mode !== "avy-code") {
          sendMessage = `${trimmed}${trimmed ? "\n\n" : ""}Прикреплённые файлы:\n${uploaded
            .map((f) => `- ${f.path}`)
            .join("\n")}`;
        }
      }

      await chatStreams.start(threadId, {
        visibleText: trimmed,
        sendMessage,
        attachments,
        codeAttachments,
        modelId: opts.modelId,
        effort: opts.effort,
        mode: opts.mode,
        permissionMode: opts.permissionMode,
        onTitle: opts.onTitle,
        onDone: opts.onDone,
      });
    },
    [threadId, opts.modelId, opts.effort, opts.mode, opts.permissionMode, opts.onTitle, opts.onDone],
  );

  const retry = useCallback(async () => {
    if (!threadId || chatStreams.isStreaming(threadId)) return;
    await chatStreams.retry(threadId, {
      modelId: opts.modelId,
      effort: opts.effort,
      mode: opts.mode,
      onTitle: opts.onTitle,
      onDone: opts.onDone,
    });
  }, [threadId, opts.modelId, opts.effort, opts.mode, opts.onTitle, opts.onDone]);

  const edit = useCallback(
    async (serverId: string, newText: string) => {
      if (!threadId || chatStreams.isStreaming(threadId)) return;
      await chatStreams.edit(threadId, serverId, newText, {
        modelId: opts.modelId,
        effort: opts.effort,
        mode: opts.mode,
        onTitle: opts.onTitle,
        onDone: opts.onDone,
      });
    },
    [threadId, opts.modelId, opts.effort, opts.mode, opts.onTitle, opts.onDone],
  );

  const stop = useCallback(() => {
    if (threadId) chatStreams.stop(threadId);
  }, [threadId]);

  const reset = useCallback(() => {
    if (threadId) chatStreams.reset(threadId);
  }, [threadId]);

  const setHistory = useCallback(
    (
      history: {
        role: Role;
        content: string;
        parts?: MessagePart[];
        tokens?: number | null;
        id?: string | null;
        feedback?: "up" | "down" | null;
      }[],
    ) => {
      if (threadId) chatStreams.setHistory(threadId, history);
    },
    [threadId],
  );

  const loadMore = useCallback(() => {
    if (threadId) chatStreams.loadMore(threadId);
  }, [threadId]);

  const hasMore = threadId ? chatStreams.hasMore(threadId) : false;

  // Режим Avy Code: ответить на approval-заявку (accept/reject) и возобновить ход.
  const resolvePermission = useCallback(
    (decision: "approve" | "reject", comment?: string) => {
      if (threadId) void chatStreams.resolvePermission(threadId, decision, comment);
    },
    [threadId],
  );

  // Режим Avy Code: ответить на карточку ask_user (все вопросы разом).
  const resolveQuestions = useCallback(
    (answers: AskUserAnswer[]) => {
      if (threadId) void chatStreams.resolveQuestions(threadId, answers);
    },
    [threadId],
  );

  // Режим Avy Code: Esc на карточке ask_user — снять её и остановить ход.
  const dismissQuestions = useCallback(() => {
    if (threadId) chatStreams.dismissQuestions(threadId);
  }, [threadId]);

  // Режим Avy Code: убить фоновый процесс по pid (кнопка «стоп» в панели).
  const killBackground = useCallback((pid: number) => {
    if (threadId) void window.avyDesktop?.codeAgent?.killBackground(threadId, pid);
  }, [threadId]);

  // Режим Avy Code: удалить завершённую задачу из истории (кнопка «удалить»).
  // Панель обновится сама bg_task(removed)-событием из main-процесса.
  const removeBackground = useCallback((id: string) => {
    if (threadId) void window.avyDesktop?.codeAgent?.removeBackground(threadId, id);
  }, [threadId]);

  // Режим Avy Code: запустить команду задачи заново (кнопка «запустить снова»).
  // Новая running-строка придёт bg_task(upsert)-событием.
  const restartBackground = useCallback((id: string) => {
    if (threadId) void window.avyDesktop?.codeAgent?.restartBackground(threadId, id);
  }, [threadId]);

  return {
    messages,
    isStreaming,
    error,
    send,
    retry,
    edit,
    stop,
    reset,
    loadMore,
    hasMore,
    setHistory,
    pendingPermission,
    pendingQueueSize: pendingPermissions.length,
    resolvePermission,
    pendingQuestions,
    resolveQuestions,
    dismissQuestions,
    bgTasks,
    killBackground,
    removeBackground,
    restartBackground,
  };
}
