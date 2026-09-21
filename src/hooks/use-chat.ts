"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  uploadSessionFiles,
  type AskUserAnswer,
  type SubagentReport,
  type UploadedFile,
} from "@/lib/api";
import type { UploadedAttachment } from "@/hooks/use-attachments";
import {
  chatStreams,
  type Attachment,
  type ChatMessage,
  type MessagePart,
  type Role,
} from "@/lib/chat-streams";

// Типы ленты живут в сторе (он — источник правды для состояния хода). Ре-экспорт
// для обратной совместимости импортов (chat.tsx и др. берут их отсюда).
export type { Attachment, ChatMessage, MessagePart, Role, SubagentRun, ThoughtStep } from "@/lib/chat-streams";

type UseChatOptions = {
  threadId?: string;
  modelId?: string;
  effort?: string | null;
  mode?: string | null;
  /** Режим Avy Code: уровень автономии approval (ask | accept-edits | plan). */
  permissionMode?: string | null;
  /** Агент из библиотеки (/api/agents). null/undefined = универсальный чат. */
  agentId?: string | null;
  /** Вызывается в момент ОТПРАВКИ сообщения — до начала хода. Нужен, чтобы
   * сессия появлялась в сайдбаре сразу, а не по завершении (ход идёт минутами,
   * а при уходе из сессии onDone не срабатывает вовсе). */
  onSend?: (threadId: string) => void;
  /** Вызывается после завершения хода (для подхвата фонового заголовка и т.п.). */
  onDone?: (threadId: string) => void;
  /** Вызывается, когда сервер сгенерировал заголовок сессии (первый ход). */
  onTitle?: (title: string) => void;
};

const EMPTY_MESSAGES: ChatMessage[] = [];

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
  const pendingQuestions = state?.pendingQuestions ?? null;

  // При входе в сессию пытаемся переподключиться к идущему на сервере ходу.
  // No-op, если хода нет (attach сразу вернёт done) или локальный цикл уже жив.
  useEffect(() => {
    if (!threadId) return;
    // После реаттача — спросить, не ждёт ли репорт фонового агента: он мог
    // закончить, пока вкладка была закрыта. Сервер ответит 204, если нечего.
    void chatStreams
      .reattach(threadId, {
        onTitle: opts.onTitle,
        onDone: opts.onDone,
      })
      .then(() => chatStreams.deliver(threadId, { onTitle: opts.onTitle, onDone: opts.onDone }));
    // Уходя из сессии — отцепляем локальный цикл (ход на сервере НЕ трогаем).
    return () => {
      chatStreams.detach(threadId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Параметры хода (модель, глубина, агент) — в стор: ими идёт ход доставки
  // репорта фонового агента, чтобы репорт разбирал тот же агент и та же
  // модель, что ведут разговор. После reload это единственный их источник.
  useEffect(() => {
    if (!threadId) return;
    chatStreams.setTurnParams(threadId, {
      modelId: opts.modelId,
      effort: opts.effort,
      mode: opts.mode,
      agentId: opts.agentId,
    });
  }, [threadId, opts.modelId, opts.effort, opts.mode, opts.agentId]);

  // ВОЗВРАТ В ПРИЛОЖЕНИЕ. Эффект выше срабатывает только на СМЕНУ threadId,
  // поэтому «свернул и вернулся в ту же сессию» им не покрывался вовсе.
  //
  // Что происходило: система замораживает вкладку (в PWA на iOS — почти сразу,
  // но и в обычном браузере при уходе на другую вкладку), fetch стрима рвётся,
  // WebKit отдаёт «Load failed». Ошибка садилась в стор и висела на экране, а
  // переподключаться было некому — ход на сервере при этом жив и продолжается.
  // Пользователь видел мёртвый экран и перезагружал приложение вручную.
  //
  // Теперь на возврат видимости переподключаемся сами. reattach безопасен:
  // при живом локальном цикле выходит сразу, при завершённом ходе получает
  // только `done` и молча выходит, а кадры берёт с offset — уже показанное не
  // повторяется. Ошибку снимаем ДО попытки, иначе «Load failed» останется
  // висеть поверх успешно восстановленного стрима.
  //
  // ЗАДЕРЖКА ОБЯЗАТЕЛЬНА, и это не «на всякий случай». В Safari на iOS есть
  // баг: fetch, запущенный СРАЗУ после того, как документ стал видимым, падает
  // через 20-40 секунд с «Load failed»; тот же запрос с небольшой паузой
  // проходит нормально (developer.apple.com/forums/thread/771127). Первая
  // версия этой правки звала reattach немедленно из обработчика — то есть
  // ровно в тот момент, когда WebKit гарантированно рвёт соединение, — и не
  // помогала вовсе.
  //
  // Повтор нужен по той же причине: если сеть после разблокировки экрана ещё
  // не поднялась, первая попытка уходит впустую. Вторая идёт через секунду.
  useEffect(() => {
    if (!threadId) return;
    let timers: ReturnType<typeof setTimeout>[] = [];

    const tryReattach = () => {
      if (document.visibilityState !== "visible") return;
      // Гасим прежний цикл ПЕРЕД переподключением. Он почти наверняка мёртв:
      // соединение оборвалось, пока вкладка была заморожена, — но reattach
      // отказывается работать, пока в записи висит AbortController
      // (`if (r.ctrl) return`), а зависший WebKit-fetch держит его ещё 20-40
      // секунд. Без этого повтор не имел бы смысла. detach ход на сервере НЕ
      // трогает: он отменяет только локальное чтение.
      chatStreams.detach(threadId);
      chatStreams.setError(threadId, null);
      void chatStreams.reattach(threadId, {
        onTitle: opts.onTitle,
        onDone: opts.onDone,
      });
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      timers.forEach(clearTimeout);
      timers = [
        setTimeout(tryReattach, 350),
        // Второй заход — ТОЛЬКО если первый не удался. Проверяем по флагу
        // стрима: он поднимается на первом содержательном кадре. Иначе повтор
        // оборвал бы (через detach) уже восстановленный стрим.
        setTimeout(() => {
          if (!chatStreams.isStreaming(threadId)) tryReattach();
        }, 1500),
      ];
    };

    document.addEventListener("visibilitychange", onVisible);
    // pageshow — возврат из bfcache: visibilitychange там не всегда стреляет
    // (Safari восстанавливает страницу целиком, минуя обычный цикл видимости).
    window.addEventListener("pageshow", onVisible);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const send = useCallback(
    // Вложения приходят одним из двух видов:
    //  - File[] (Avy Code) — грузим ЗДЕСЬ на отправке (upload = инжект в сообщение);
    //  - UploadedAttachment[] (обычный чат) — файлы УЖЕ в песочнице (загружены при
    //    прикреплении), только берём их пути/метаданные.
    async (text: string, items: File[] | UploadedAttachment[] = []) => {
      const trimmed = text.trim();
      if (!threadId) return;
      if (!trimmed && items.length === 0) return;
      // Ход идёт: сообщение уходит агенту НА ХОДУ — он получит его перед
      // следующим вызовом модели (chatStreams.interject).
      const midTurn = chatStreams.isStreaming(threadId);

      // Разделяем два вида вложений (см. выше). File[] грузим; UploadedAttachment[]
      // уже загружены — используем как есть.
      const rawFiles = items.filter((x): x is File => x instanceof File);
      const preUploaded = items.filter(
        (x): x is UploadedAttachment => !(x instanceof File),
      );

      let uploaded: UploadedFile[] = [];
      let attachments: Attachment[] | undefined;
      if (rawFiles.length) {
        const res = await uploadSessionFiles(threadId, rawFiles, opts.mode);
        uploaded = res.files;
        // Ошибки прикрепления показываем как ошибку сессии (не срывая отправку).
        if (res.errors.length) {
          const names = res.errors.map((e) => e.name).join(", ");
          chatStreams.setError(threadId, `Не удалось прикрепить: ${names}`);
        }
      } else if (preUploaded.length) {
        // Уже загруженные (обычный чат) — приводим к UploadedFile для сообщения.
        uploaded = preUploaded.map((f) => ({
          path: f.path,
          name: f.name,
          mime: f.mime,
          size: 0,
          thumbUrl: f.thumbUrl,
        }));
      }
      if (uploaded.length) {
        attachments = uploaded.map((f) => ({
          path: f.path,
          name: f.name,
          mime: f.mime,
          thumbUrl: f.thumbUrl,
        }));
      }

      // Дописываем блок путей файлов (/uploads/...) — агент читает их через
      // read_file по пути.
      const sendMessage =
        uploaded.length
          ? `${trimmed}${trimmed ? "\n\n" : ""}Прикреплённые файлы:\n${uploaded
              .map((f) => `- ${f.path}`)
              .join("\n")}`
          : trimmed;

      // Сессия — в список ДО начала хода: она уже существует для пользователя,
      // как только он нажал «отправить».
      opts.onSend?.(threadId);

      const turn = {
        visibleText: trimmed,
        sendMessage,
        attachments,
        modelId: opts.modelId,
        effort: opts.effort,
        mode: opts.mode,
        permissionMode: opts.permissionMode,
        agentId: opts.agentId,
        onTitle: opts.onTitle,
        onDone: opts.onDone,
      };
      if (midTurn) await chatStreams.interject(threadId, turn);
      else await chatStreams.start(threadId, turn);
    },
    [threadId, opts.modelId, opts.effort, opts.mode, opts.permissionMode,
     opts.agentId, opts.onSend, opts.onTitle, opts.onDone],
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
        interject?: boolean;
        feedback?: "up" | "down" | null;
        report?: SubagentReport;
      }[],
    ) => {
      if (threadId) chatStreams.setHistory(threadId, history);
    },
    [threadId],
  );

  // Остановить фонового агента (кнопка на шаге task). Его репорт придёт как
  // обычно — со статусом cancelled.
  const stopBackground = useCallback(
    (agentId: string) => {
      if (threadId) chatStreams.stopBackground(threadId, agentId);
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

  // Вопрос агента (тула ask_user): ход на паузе, пока человек не ответит.
  const answerQuestions = useCallback(
    (answers: AskUserAnswer[]) => {
      if (threadId) void chatStreams.answerQuestions(threadId, answers);
    },
    [threadId],
  );

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
    // Вся очередь: карточка показывает «1 из N», когда агент запросил несколько
    // подтверждений за один ход.
    pendingPermissions,
    pendingQueueSize: pendingPermissions.length,
    resolvePermission,
    pendingQuestions,
    answerQuestions,
    stopBackground,
  };
}
