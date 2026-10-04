"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AIChatInput } from "@/components/ui/ai-chat-input";
import { QuestionCard, type PendingQuestions } from "@/components/chat/question-card";
import { ConnectorCard, type PendingConnector } from "@/components/chat/connector-card";
import { PermissionCard } from "@/components/chat/permission-card";
import type { PendingPermission } from "@/lib/chat-streams";
import { foldParts } from "@/lib/chain-fold";
import type { AskUserAnswer } from "@/lib/api";
import { useAttachments, type UploadedAttachment } from "@/hooks/use-attachments";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationScrollOnSend,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Actions, Action } from "@/components/ai-elements/actions";
import {
  CopyIcon,
  CheckIcon,
  RefreshCcwIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  PencilIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/hooks/use-chat";
import type { EffortLevel, ChatModelId } from "@/components/ui/ai-chat-input";
import { ThoughtStream } from "@/components/chat/tool-steps";
import { TaskChainsProvider } from "@/components/chat/task-chains-context";
import { OffscreenCull } from "@/components/chat/offscreen-cull";
import { AttachmentChip, mimeFromPath } from "@/components/chat/attachment-chip";
import { sessionFileRawUrl, sendFeedback } from "@/lib/api";
import type { Attachment } from "@/hooks/use-chat";
import {
  PASTED_TEXT_MARKER,
  PASTED_TEXT_MARKER_END,
  pastePreview,
} from "@/lib/chat-streams";
import { useLocale, useT } from "@/i18n/i18n-context";

// Коды ошибок хода с бэка (streaming.classify_error). В стейте error лежит
// либо один из них, либо сырой текст (загрузка файлов / HTTP — у них своё
// сообщение). Известный код переводим, остальное показываем как есть.
const ERROR_CODES = [
  "limit_exceeded",
  "gateway_unavailable",
  "timeout",
  "model_error",
  "internal",
  "session_busy",
] as const;

/** error из стейта -> человекочитаемое сообщение по локали. */
function resolveError(
  error: string,
  errors: Record<(typeof ERROR_CODES)[number], string>,
): string {
  return (ERROR_CODES as readonly string[]).includes(error)
    ? errors[error as (typeof ERROR_CODES)[number]]
    : error;
}

/** Дата сброса лимита (ISO) -> «1 июля» / «July 1» по локали. */
function formatResetDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
  });
}

type ChatProps = {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (text: string, uploaded: UploadedAttachment[]) => void | Promise<void>;
  /** Перегенерировать последний ответ агента (кнопка «Повторить»). */
  onRetry?: () => void | Promise<void>;
  /** Отредактировать сообщение пользователя (по serverId) и перегенерировать. */
  onEdit?: (serverId: string, text: string) => void | Promise<void>;
  /** Остановить идущий ход (кнопка Stop / Esc в инпуте). */
  onStop: () => void;
  /** Заполненность окна контекста (индикатор в капсуле инпута). */
  contextUsage?: { used_tokens: number; max_tokens: number } | null;
  /** Идёт ручное сжатие контекста. */
  compacting?: boolean;
  /** Сжать контекст сейчас (клик по индикатору). */
  onCompact?: () => void;
  /** Активная сессия — нужна для inline-превью файлов из песочницы. */
  threadId: string;
  /** Уровень рассуждения — источник истины в стейте ChatWorkspace. */
  effort: EffortLevel;
  onEffortChange?: (effort: EffortLevel) => void;
  /** Выбранная модель — источник истины там же, в ChatWorkspace. */
  model?: ChatModelId;
  onModelChange?: (model: ChatModelId) => void;
  /** Агент из библиотеки; null = универсальный чат. */
  agentId?: string | null;
  onAgentChange?: (id: string | null) => void;
  onSpacePick?: (spaceId: string, agentId: string | null) => void;
  activeSpaceId?: string | null;
  onSpaceClear?: () => void;
  modeLocked?: boolean;
  /** Лимит исчерпан — показать плашку над инпутом и заблокировать ввод. */
  /** Вопрос агента (тула ask_user): ход на паузе, карточка над полем ввода. */
  pendingQuestions?: PendingQuestions | null;
  onQuestionsSubmit?: (answers: AskUserAnswer[]) => void;
  /** Esc на карточке — снять её и остановить ход (граф уже на паузе в чекпойнте). */
  onQuestionsDismiss?: () => void;
  /** Просьба агента подключить сервис (тула connector): та же пауза, карточка
   *  «Подключить». Ответ — подключил (true) или отказался (false). */
  pendingConnector?: PendingConnector | null;
  onConnectorAnswer?: (connected: boolean) => void;
  /** Очередь подтверждений необратимых действий (`confirm:` в AGENT.md агента).
   *  Ход на паузе, карточка над полем ввода — как у вопроса. */
  pendingPermissions?: PendingPermission[];
  onPermissionDecision?: (decision: "approve" | "reject", comment?: string) => void;
  limitExhausted?: boolean;
  /** Дата сброса лимита (ISO) — для текста плашки. */
  limitResetAt?: string | null;
};

/**
 * Лента диалога + инпут. Контролируемый компонент: состояние чата приходит
 * сверху (из ChatWorkspace через useChat), чтобы шапка с переключателем сессий
 * и лента жили в одном дереве.
 *
 * - Пустое состояние: инпут по центру + приветствие.
 * - После первой отправки: инпут плавно уезжает вниз (motion layout),
 *   сверху появляется лента (AI Elements Conversation).
 */
export function Chat({
  messages,
  isStreaming,
  error,
  onSend,
  onRetry,
  onEdit,
  onStop,
  contextUsage,
  compacting,
  onCompact,
  threadId,
  effort,
  onEffortChange,
  model,
  onModelChange,
  agentId,
  onAgentChange,
  onSpacePick,
  activeSpaceId,
  onSpaceClear,
  modeLocked,
  limitExhausted,
  limitResetAt,
  pendingQuestions,
  onQuestionsSubmit,
  onQuestionsDismiss,
  pendingConnector,
  onConnectorAnswer,
  pendingPermissions,
  onPermissionDecision,
}: ChatProps) {
  const t = useT();
  const { locale } = useLocale();
  const isEmpty = messages.length === 0;
  // Агент ждёт ответа на карточку: она показана вместо поля ввода.
  //
  // Подтверждение и вопрос обрабатываются одинаково: в обоих случаях ход стоит
  // в interrupt, и отвечать надо карточкой. Свободный текст для отказа есть в
  // самой карточке, поэтому поле ввода не нужно.
  const confirming = Boolean(
    pendingPermissions && pendingPermissions.length > 0 && onPermissionDecision,
  );
  const connecting = Boolean(pendingConnector && onConnectorAnswer);
  const asking = Boolean(pendingQuestions && onQuestionsSubmit) || confirming || connecting;
  // Вложения композера держит чат (а не инпут): тогда drag&drop ловится по всей
  // области чата (#chat-area), а не только по капсуле инпута. Файлы грузятся в
  // песочницу СРАЗУ при прикреплении (кольцо прогресса на чипе, Send ждёт).
  // Этот Chat — обычный чат (avy-code — отдельный chat-code-input), mode не нужен.
  const attachmentsApi = useAttachments(threadId);
  // Тащат файл над областью чата — показываем оверлей «отпустите». dragenter/leave
  // считаем счётчиком: вход/выход по дочерним элементам не гасит оверлей раньше
  // времени (dragleave стреляет и при переходе на потомка).
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useMemo(() => ({ n: 0 }), []);

  // Реальная высота плавающей капсулы инпута -> CSS-переменная --input-h на
  // области чата. От неё зависят ДВЕ вещи: резерв места в конце ленты (спейсер)
  // и позиция кнопки «вниз».
  //
  // Обе раньше были константами, подогнанными под СВЁРНУТУЮ капсулу (68px):
  // спейсер h-24 (96px) и кнопка bottom-32 (128px). Но при фокусе капсула
  // разворачивается (минимум 128px) и дальше растёт под текст и вложения — в
  // итоге конец диалога уезжал под инпут, а кнопка пряталась под ним и её
  // нельзя было нажать. Наступали 11.08.
  //
  // Меряем САМУ капсулу (узел .pointer-events-auto), а не её обёртку: у обёртки
  // сверху ещё pt-8 прозрачного градиента — он не перекрывает контент, и если
  // включить его в отступ, кнопка встаёт на 32px выше, чем нужно (проверено в
  // браузере: верх капсулы в 171px от низа, высота обёртки 203px).
  // К высоте капсулы добавляем pb-4 (16px) обёртки — он лежит НИЖЕ капсулы и в
  // её offsetHeight не входит.
  //
  // Величина верна при любом наполнении: многострочный текст, чипы вложений,
  // плашка лимита — всё внутри измеряемого узла.
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = inputWrapRef.current;
    const area = chatAreaRef.current;
    if (!wrap || !area) return;
    const apply = () => {
      // 16px = pb-4 обёртки (отступ капсулы от низа области).
      area.style.setProperty("--input-h", `${Math.round(wrap.offsetHeight) + 16}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
    // isEmpty переключает раскладку (инпут по центру <-> плавающая капсула),
    // asking — капсулу на карточку вопроса: в обоих случаях измеряемый узел
    // пересоздаётся, и наблюдателя надо навесить заново.
  }, [isEmpty, asking]);
  // Для автоскролла «новое сообщение к верху»: считаем сообщения пользователя
  // (триггер — отправка, не стрим ответа) и индекс последнего из них (его ряд
  // помечаем [data-last-user], к нему скроллит ConversationScrollOnSend).
  // Именно role === "user", а не «не ассистент»: карточка репорта фонового
  // агента (role "report") — не реплика человека, и скроллить к ней или
  // считать её отправкой нельзя.
  const userCount = messages.reduce(
    (n, m) => (m.role === "user" ? n + 1 : n),
    0,
  );
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  return (
    <div
      id="chat-area"
      ref={chatAreaRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      // Drag&drop файлов по ВСЕЙ области чата (не только по капсуле инпута).
      // Реагируем только на перетаскивание файлов (types содержит "Files"),
      // чтобы не мешать перетаскиванию текста/выделения.
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
        e.preventDefault();
        dragDepth.n += 1;
        setDropActive(true);
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
        dragDepth.n -= 1;
        if (dragDepth.n <= 0) {
          dragDepth.n = 0;
          setDropActive(false);
        }
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
        e.preventDefault();
        dragDepth.n = 0;
        setDropActive(false);
        if (e.dataTransfer.files?.length) attachmentsApi.addFiles(e.dataTransfer.files);
      }}
    >
      {/* Оверлей «отпустите файлы» поверх всей области, пока тащат файл. */}
      {dropActive && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/5 backdrop-blur-[1px]">
          <span className="rounded-lg bg-background/90 px-4 py-2 text-sm font-medium text-foreground shadow-sm">
            {t.input.dropToAttach}
          </span>
        </div>
      )}

      {/* Лента скроллится ВНУТРИ себя (flex-1 + min-h-0). Нижний паддинг даёт
          место под плавающую капсулу инпута, чтобы последнее сообщение из-под
          неё было видно. */}
      {!isEmpty && (
        <TaskChainsProvider messages={messages} isStreaming={isStreaming}>
        <Conversation className="min-h-0 flex-1">
          {/* Автоскролл: при отправке нового сообщения юзера оно встаёт к верху. */}
          <ConversationScrollOnSend userMessageCount={userCount} />
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6">
            {messages.map((m, idx) => (
              // Виртуализация выгрузкой офскрина (см. OffscreenCull): далёкие от
              // вьюпорта ряды отдают плейсхолдер своей высоты, освобождая память
              // от markdown и картинок. keepMounted — для рядов, которые НЕЛЬЗЯ
              // выгружать: активный (стримящийся) ответ, его высота прыгает каждый
              // кадр; и последнее сообщение пользователя — к нему скроллит
              // автоскролл по [data-last-user], узел должен существовать в DOM.
              <OffscreenCull
                key={m.id}
                keepMounted={
                  (isStreaming && idx === messages.length - 1) ||
                  idx === lastUserIndex ||
                  idx >= messages.length - 2
                }
              >
                <MessageRow
                  m={m}
                  running={isStreaming && idx === messages.length - 1}
                  isLastUser={idx === lastUserIndex}
                  threadId={threadId}
                  // Пробрасываем onRetry/onEdit по ПОЗИЦИИ (не по isStreaming),
                  // чтобы проп не менялся в момент завершения хода — иначе ряд
                  // ререндерится ровно когда ThoughtChain сворачивается, и скролл
                  // дёргается. Видимость кнопок решается внутри по `running`.
                  onRetry={
                    idx === messages.length - 1 && m.role === "assistant"
                      ? onRetry
                      : undefined
                  }
                  onEdit={m.role === "user" ? onEdit : undefined}
                />
              </OffscreenCull>
            ))}
            {/* Спейсер под плавающую капсулу инпута: StickToBottom скроллит к
                концу контента, поэтому резерв задаём реальным элементом (а не
                pb-*, который конфликтует с p-4 базового ConversationContent).
                Высота — РЕАЛЬНАЯ высота капсулы (--input-h): при фокусе она
                разворачивается, и на фиксированных 96px конец диалога уезжал
                под инпут. Фолбэк 6rem — прежнее значение на первый кадр. */}
            {/* -mt-6 гасит gap-6 ленты ПЕРЕД спейсером: между последним
                сообщением и капсулой оставалось 39px пустоты (замерено в
                браузере). Сам резерв (--input-h) не трогаем — он держит
                контент от заезда под инпут. */}
            <div
              aria-hidden
              className="-mt-6 shrink-0"
              style={{ height: "var(--input-h, 6rem)" }}
            />
          </ConversationContent>
          {/* Кнопка «вниз» — НАД плавающей капсулой инпута. Отступ считаем от
              её реальной высоты (--input-h) плюс 8px зазора: на фиксированном
              bottom-32 кнопка пряталась под развёрнутой капсулой. */}
          <ConversationScrollButton
            className="shadow-md"
            style={{ bottom: "calc(var(--input-h, 6rem) + 8px)" }}
          />
        </Conversation>
        </TaskChainsProvider>
      )}

      <motion.div
        layout
        transition={{ type: "spring", stiffness: 200, damping: 28 }}
        className={
          isEmpty
            ? "flex flex-1 flex-col items-center justify-center px-4"
            : // Плавает над лентой: прижат к низу, фон прозрачный, снизу лёгкий
              // фейд из фона, чтобы текст не лез резко под капсулу.
              "pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/80 to-transparent px-4 pb-4 pt-8"
        }
      >
        <AnimatePresence>
          {isEmpty && (
            <motion.div
              key="greeting"
              className="mb-6 text-center"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <h1 className="text-2xl font-semibold tracking-tight">{t.chat.greeting}</h1>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Вопрос агента — НАД обёрткой инпута, а не внутри неё.
            Внутри карточка ломала раскладку: inputWrapRef измеряется в
            --input-h (отступ ленты снизу), и её появление дёргало ленту, а
            motion layout эту смену высоты ещё и анимировал — инпут «уезжал»
            вниз, как в пустой сессии. Снаружи высота обёртки не меняется. */}
        {confirming && (
          <div ref={inputWrapRef} className="pointer-events-auto mx-auto w-full max-w-3xl">
            <PermissionCard
              // Своя карточка на каждую заявку очереди: иначе React берёт тот
              // же компонент, и кнопки остаются погашенными после ответа на
              // предыдущую (busy) — до перезахода в тред.
              key={`${pendingPermissions![0].interruptId ?? "p"}-${pendingPermissions!.length}`}
              pending={pendingPermissions![0]}
              queueSize={pendingPermissions!.length}
              onDecide={onPermissionDecision!}
            />
          </div>
        )}

        {asking && !confirming && !connecting && (
          // ТОТ ЖЕ ref, что у капсулы: карточка и поле ввода — взаимоисключающие
          // узлы, в DOM ровно один из них, и --input-h считается по тому, что
          // смонтировано. Так лента резервирует место и под карточку, не
          // измеряя при этом внешнюю обёртку с её pt-8 (из-за него между
          // последним сообщением и инпутом появлялась пропасть).
          <div ref={inputWrapRef} className="pointer-events-auto mx-auto w-full max-w-3xl">
            <QuestionCard
              pending={pendingQuestions!}
              onSubmit={onQuestionsSubmit!}
              onDismiss={onQuestionsDismiss}
            />
          </div>
        )}
        {connecting && (
          <div ref={inputWrapRef} className="pointer-events-auto mx-auto w-full max-w-3xl">
            <ConnectorCard pending={pendingConnector!} onAnswer={onConnectorAnswer!} />
          </div>
        )}

        {/* Пока висит вопрос, поле ввода не рендерится вовсе: отвечать нужно
            карточкой, а свободный текст для этого есть в ней («Другое»).
            Размонтирование безопасно — ref переезжает на карточку (см. выше). */}
        {!asking && (
        <motion.div
          layout
          ref={inputWrapRef}
          className="pointer-events-auto mx-auto w-full max-w-3xl"
        >
          {limitExhausted && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
              <span>
                {limitResetAt
                  ? t.limit.bannerExhaustedReset(formatResetDate(limitResetAt, locale))
                  : t.limit.bannerExhausted}
              </span>
            </div>
          )}
          <AIChatInput
            onSend={onSend}
            streaming={isStreaming}
            onStop={onStop}
            // Обычный чат: сообщение во время хода уходит агенту на ходу.
            allowInterject

            contextUsage={contextUsage}
            compacting={compacting}
            onCompact={onCompact}
            effort={effort}
            onEffortChange={onEffortChange}
            model={model}
            onModelChange={onModelChange}
            agentId={agentId}
            onAgentChange={onAgentChange}
            onSpacePick={onSpacePick}
            activeSpaceId={activeSpaceId}
            onSpaceClear={onSpaceClear}
            // Сессия началась (есть сообщения или идёт стрим) — режим
            // зафиксирован: менять агента/пространство посреди сессии нельзя.
            modeLocked={modeLocked ?? (messages.length > 0 || isStreaming)}
            disabled={limitExhausted}
            attachmentsApi={attachmentsApi}
          />
          <p className="mt-2 px-2 text-center text-xs text-muted-foreground">
            {t.input.disclaimer}
          </p>
        </motion.div>
        )}
        {/* Ошибка — ВНЕ скрываемого блока: её надо видеть и когда поле ввода
            спрятано за карточкой вопроса (например, ответ не доехал). */}
        {error && (
          <div className="pointer-events-auto mx-auto mt-2 flex w-full max-w-3xl items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <span>{resolveError(error, t.chat.errors)}</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Один пузырь ответа ассистента. Рисуем parts[] строго в порядке возникновения:
 * свёрнутая цепочка (reasoning+tool) и видимый текст чередуются, как их выдала
 * модель — [▸ цепочка] → комментарий → [▸ цепочка] → … → итоговый ответ.
 */
/**
 * Один ряд ленты. Для пользователя вложения рендерим НАД пузырём (отдельным
 * блоком в колонке Message, до MessageContent), а сам пузырь несёт только текст.
 * Для ассистента — обычный контент в пузыре.
 *
 * memo: при стриминге меняется только последнее (активное) сообщение. Без memo
 * каждый токен ререндерит ВСЮ ленту, и каждое старое сообщение заново парсит
 * markdown — на больших сессиях это и есть причина тормозов. Пропсы у неактивных
 * рядов стабильны (m по ссылке не меняется, running=false), поэтому memo их
 * пропускает; перерисовывается лишь активный ряд.
 */
export const MessageRow = memo(function MessageRow({
  m,
  running,
  isLastUser,
  threadId,
  onRetry,
  onEdit,
}: {
  m: ChatMessage;
  running: boolean;
  /** Последнее сообщение пользователя — к нему скроллит автоскролл при отправке. */
  isLastUser: boolean;
  threadId: string;
  /** Перегенерировать ответ — задан только у последнего ответа агента. */
  onRetry?: () => void | Promise<void>;
  /** Отредактировать сообщение пользователя (по serverId). */
  onEdit?: (serverId: string, text: string) => void | Promise<void>;
}) {
  const dict = useT();
  // role "summary" — служебная строка сжатия контекста, встречается только в
  // ленте Avy Code (там её рисует CodeMessageRow). В обычном чате её не бывает;
  // сюда попасть не может, поэтому ветку не заводим (тип Role общий на оба режима).
  //
  // role "report" — репорт фонового субагента: сообщение от системы для
  // ассистента, не для ленты. В UI его НЕ рисуем: итог виден на исходном
  // блоке «Задача для агента» (бейдж статуса + «Подробнее»), а отдельная
  // карточка его только дублировала (решение владельца 19.09).
  if (m.role === "report") {
    return null;
  }
  if (m.role === "user") {
    // Вложения берём из явного поля (свежая отправка) ИЛИ парсим из текста
    // (история из чекпойнтера: туда ушёл блок "Прикреплённые файлы:"). Блок из
    // видимого текста вырезаем — файлы показываем чипами/превью.
    const raw = extractUserAttachments(m);
    // Из видимого текста вырезаем ещё и вставленные блоки — их показываем чипами.
    const { text, pasted } = extractPastedTexts(raw.text);
    const attachments = raw.attachments;
    // Редактировать можно простое текстовое сообщение с serverId, без вложений
    // и вставок (их перепосыл усложнил бы усечение; ограничиваемся текстом).
    const canEdit =
      !!onEdit &&
      !!m.serverId &&
      // Реплика посреди хода, которую агент ещё не забрал, — не в чекпойнте,
      // усекать историю по ней нечего.
      !m.pending &&
      attachments.length === 0 &&
      pasted.length === 0 &&
      !!text;
    return (
      <Message from={m.role} {...(isLastUser ? { "data-last-user": "" } : {})}>
        {/* Вложения — НАД пузырём (chips сверху, справа), сам пузырь — только текст. */}
        {(attachments.length > 0 || pasted.length > 0) && (
          <div className="flex flex-wrap justify-end gap-2">
            {pasted.map((t, i) => (
              <AttachmentChip
                key={`pasted-${i}`}
                name={`${dict.chat.pastedText} ${pasted.length > 1 ? i + 1 : ""}`.trim()}
                mime="text/plain"
                preview={pastePreview(t)}
              />
            ))}
            {attachments.map((a) => (
              <AttachmentChip
                key={a.path}
                name={a.name}
                mime={a.mime}
                thumbUrl={
                  a.mime.startsWith("image/")
                    ? sessionFileRawUrl(threadId, a.path)
                    : undefined
                }
              />
            ))}
          </div>
        )}
        {text && (
          <UserBubble
            text={text}
            canEdit={canEdit}
            onSubmitEdit={
              canEdit && m.serverId
                ? (next) => onEdit!(m.serverId!, next)
                : undefined
            }
          />
        )}
        {/* Отправлено посреди хода: агент прочтёт на следующем шаге (перед
            следующим вызовом модели). Пометка снимается кадром `interject`. */}
        {m.pending && (
          <span className="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-current animate-pulse" />
            {dict.chat.interjectPending}
          </span>
        )}
      </Message>
    );
  }

  // Не-user ход в обычном чате — всегда ассистентский пузырь (summary сюда не
  // доходит, см. коммент выше).
  return (
    <Message from="assistant">
      <MessageContent>
        <AssistantBubble
          m={m}
          running={running}
          threadId={threadId}
          onRetry={onRetry}
        />
      </MessageContent>
    </Message>
  );
});

/**
 * Пузырь сообщения пользователя с инлайн-редактированием. По умолчанию — текст +
 * кнопка-карандаш под пузырём (на hover). В режиме правки — textarea + Сохранить/
 * Отмена. Сохранение зовёт onSubmitEdit(новый текст): сервер усекает историю и
 * перегенерирует ответ.
 */
function UserBubble({
  text,
  canEdit,
  onSubmitEdit,
}: {
  text: string;
  canEdit: boolean;
  onSubmitEdit?: (next: string) => void | Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (editing) {
    const save = () => {
      const next = draft.trim();
      setEditing(false);
      if (next && next !== text) void onSubmitEdit?.(next);
    };
    return (
      <div className="ml-auto flex w-full max-w-xl flex-col gap-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter — сохранить; Shift+Enter — перенос строки (как в инпуте чата).
            if (e.key === "Escape") {
              setDraft(text);
              setEditing(false);
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
          rows={Math.min(8, draft.split("\n").length + 1)}
          className="w-full resize-y rounded-2xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(text);
              setEditing(false);
            }}
          >
            {t.chat.actions.cancel}
          </Button>
          <Button size="sm" onClick={save}>
            {t.chat.actions.save}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/user flex flex-col items-end gap-1">
      <MessageContent>
        {/* Реплика пользователя — ПРОСТОЙ ТЕКСТ, не markdown.
            Человек пишет обычный текст, а не разметку: `**важно**` или `# план`
            он набирает буквально, и рендерить это как жирный/заголовок неверно.
            Заодно уходит потеря переносов (в markdown одиночный \n — пробел, и
            текст, набранный в несколько строк, схлопывался в одну) и не тянется
            весь тяжёлый стек Streamdown (KaTeX, mermaid, подсветка кода) ради
            пары строк. Редактирование и раньше было обычной textarea. */}
        <div className="whitespace-pre-wrap break-words">{text}</div>
      </MessageContent>
      {/* На тач-устройствах кнопка видна ВСЕГДА: наведения там нет, и с одним
          только group-hover она была недостижима с телефона. С мышью —
          прежнее поведение, чтобы не зашумлять ленту. */}
      {canEdit && (
        <Actions className="opacity-100 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/user:opacity-100 has-[:focus-visible]:opacity-100">
          <Action
            tooltip={t.chat.actions.edit}
            label={t.chat.actions.edit}
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <PencilIcon />
          </Action>
        </Actions>
      )}
    </div>
  );
}

/** Контент ответа ассистента: упорядоченные части (цепочки + текст). */
function AssistantBubble({
  m,
  running,
  threadId,
  onRetry,
}: {
  m: ChatMessage;
  running: boolean;
  threadId: string;
  onRetry?: () => void | Promise<void>;
}) {
  // Пути файлов сессии (/report.pdf, /downloads/x.jpg) в markdown превращаем в
  // raw-URL песочницы, чтобы картинки/ссылки на файлы рендерились inline.
  // useMemo по threadId: иначе на каждый токен создаётся новая функция, ломая
  // мемоизацию MessageResponse (Streamdown перепарсивает весь markdown).
  const urlTransform = useMemo(() => makeFileUrlTransform(threadId), [threadId]);

  // Одна цепочка работы на ход: промежуточный текст между тулами — заметкой
  // внутрь, снаружи только финальный ответ (см. lib/chain-fold).
  const rawParts = m.parts;
  const parts = useMemo(() => foldParts(rawParts ?? []), [rawParts]);
  if (parts.length === 0) {
    // Ответ ещё не начался — индикатор печати.
    return running ? <TypingDots /> : null;
  }

  // Финальный видимый текст ответа (без reasoning-цепочек) — для «копировать».
  const answerText = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();

  // Индекс последней цепочки: по нему решаем, какая из них сейчас «работает»
  // (шиммер) и какие уже пора свернуть.
  const lastChainIndex = parts.map((p) => p.type).lastIndexOf("chain");

  return (
    <>
      {parts.map((p, i) =>
        p.type === "chain" ? (
          <ThoughtStream
            key={i}
            steps={p.steps}
            // «Работает», пока это ПОСЛЕДНЯЯ цепочка и идёт стрим. Не по
            // `i === parts.length - 1`: модель роняет текст посреди размышления,
            // и активная цепочка часто оказывается предпоследней частью —
            // шиммер тогда гас раньше времени.
            isRunning={running && i === lastChainIndex}
            // Финальный ответ пошёл — сворачиваем цепочку (даже если юзер
            // раскрыл): как только ПОСЛЕ неё появился текст, размышление
            // закончилось и место в ленте нужно ответу.
            //
            // Раньше для последней цепочки стояла оговорка `|| !running` —
            // ждали конца хода. Из-за неё блок висел раскрытым всё время, пока
            // агент печатал ответ, и схлопывался только когда тот дописан.
            finalized={parts.slice(i + 1).some((q) => q.type === "text")}
            threadId={threadId}
          />
        ) : (
          <MessageResponse
            // Ключ по ПОРЯДКУ текстовых частей, а не по индексу среди всех
            // parts: вставка цепочки между текстами сдвигала i, React считал
            // это новым компонентом, перемонтировал его — и Streamdown терял
            // память о том, что уже показано. Весь абзац проявлялся заново.
            key={`t${parts.slice(0, i).filter((q) => q.type === "text").length}`}
            urlTransform={urlTransform}
            // Анимируем ТОЛЬКО часть, в которую сейчас идёт стрим. Иначе при
            // открытии сессии заново «проявлялась» бы вся история.
            isAnimating={running && i === parts.length - 1}
          >
            {p.text}
          </MessageResponse>
        ),
      )}
      {/* Панель действий РЕЗЕРВИРУЕТ место всегда при наличии текста (во время
          стрима — невидима/неактивна). Иначе её появление в конце хода меняет
          высоту, и StickToBottom рывком возвращает скролл вниз. */}
      {answerText && (
        <MessageActions
          text={answerText}
          threadId={threadId}
          messageId={m.serverId ?? null}
          initialVote={m.feedback ?? null}
          onRetry={onRetry}
          hidden={running}
        />
      )}
    </>
  );
}

/**
 * Панель действий под ответом ассистента: копировать / ретрай / лайк / дизлайк.
 * Копирование и оценка работают; ретрай — UI (логика на следующем шаге).
 */
function MessageActions({
  text,
  threadId,
  messageId,
  initialVote,
  onRetry,
  hidden = false,
}: {
  text: string;
  threadId: string;
  /** id хода из чекпойнтера; null у ещё не сохранённого ответа (оценка недоступна). */
  messageId: string | null;
  initialVote: "up" | "down" | null;
  /** Перегенерировать ответ; задан только у последнего ответа. */
  onRetry?: () => void | Promise<void>;
  /** Зарезервировать место, но скрыть (во время стрима) — чтобы не дёргать высоту. */
  hidden?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(initialVote);

  // Догоняем проп: useState берёт значение ТОЛЬКО при первом рендере, а лента
  // приходит асинхронно — на момент монтирования initialVote ещё null, и
  // ранее поставленная оценка не подсвечивалась после перезахода в диалог.
  // Синхронизируем по messageId, а не по самому initialVote: иначе оптимистичный
  // клик тут же откатывался бы к серверному значению до ответа.
  useEffect(() => {
    setVote(initialVote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard недоступен (нет https/разрешения) — молча игнорируем */
    }
  };

  // Оценка с оптимистичным апдейтом: жмём → подсветка сразу, в фоне шлём на
  // сервер; при ошибке откатываем. Повторное нажатие той же кнопки снимает.
  const onVote = async (next: "up" | "down") => {
    if (!messageId) return; // ответ ещё не сохранён — оценивать нечего
    const prev = vote;
    const target = vote === next ? null : next;
    setVote(target);
    const ok = await sendFeedback(threadId, messageId, target);
    if (!ok) setVote(prev);
  };

  return (
    <Actions
      aria-hidden={hidden}
      className={
        hidden
          ? "pointer-events-none mt-1 opacity-0"
          : // На тач-устройствах кнопки видны ВСЕГДА (наведения там нет — с
            // одним group-hover они были недостижимы с телефона), с мышью
            // остаётся появление по наведению.
            "mt-1 opacity-100 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 has-[:focus-visible]:opacity-100"
      }
    >
      <Action tooltip={t.chat.actions.copy} label={t.chat.actions.copy} onClick={onCopy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Action>
      <Action
        tooltip={t.chat.actions.retry}
        label={t.chat.actions.retry}
        onClick={onRetry ? () => void onRetry() : undefined}
        disabled={!onRetry}
      >
        <RefreshCcwIcon />
      </Action>
      <Action
        tooltip={t.chat.actions.like}
        label={t.chat.actions.like}
        onClick={() => onVote("up")}
        disabled={!messageId}
        className={vote === "up" ? "text-foreground" : undefined}
      >
        <ThumbsUpIcon className={vote === "up" ? "fill-current" : undefined} />
      </Action>
      <Action
        tooltip={t.chat.actions.dislike}
        label={t.chat.actions.dislike}
        onClick={() => onVote("down")}
        disabled={!messageId}
        className={vote === "down" ? "text-foreground" : undefined}
      >
        <ThumbsDownIcon
          className={vote === "down" ? "fill-current" : undefined}
        />
      </Action>
    </Actions>
  );
}

/**
 * urlTransform для Streamdown: абсолютные пути сессии (начинаются с "/", но не
 * "//" и не схема) резолвим в raw-URL файла песочницы. http(s)/data/blob —
 * как есть. Без активной сессии не трогаем.
 */
/**
 * Разобрать сообщение пользователя на видимый текст и вложения.
 *
 * Вложения дописываются блоком `Прикреплённые файлы:\n- /uploads/...` (см.
 * use-chat). Свежая отправка несёт их и в `m.attachments`; история из
 * чекпойнтера — только в тексте. Берём явные, если есть, иначе парсим из текста;
 * сам блок из видимого текста вырезаем, чтобы показать файлы чипами/превью.
 */
function extractUserAttachments(m: ChatMessage): {
  text: string;
  attachments: Attachment[];
} {
  const content = m.content ?? "";
  // Блок начинается со строки-заголовка и идёт до конца сообщения.
  const idx = content.search(/\n*Прикреплённые файлы:\s*\n/);
  const text = idx >= 0 ? content.slice(0, idx).trim() : content;

  if (m.attachments?.length) {
    return { text, attachments: m.attachments };
  }
  if (idx < 0) return { text, attachments: [] };

  // Парсим строки "- /uploads/имя" из блока.
  const block = content.slice(idx);
  const paths = [...block.matchAll(/^\s*-\s*(\/\S.*?)\s*$/gm)].map((mm) => mm[1]);
  const attachments: Attachment[] = paths.map((p) => ({
    path: p,
    name: p.split("/").pop() || p,
    mime: mimeFromPath(p),
  }));
  return { text, attachments };
}

/**
 * Вырезать из текста блоки вставленного текста (между маркерами) и вернуть
 * очищенный текст + список вставок. В UI вставки показываем чипами, а не
 * портянкой; в модель они ушли как обычный помеченный текст.
 */
function extractPastedTexts(content: string): {
  text: string;
  pasted: string[];
} {
  const start = escapeRe(PASTED_TEXT_MARKER);
  const end = escapeRe(PASTED_TEXT_MARKER_END);
  const re = new RegExp(`${start}\\n([\\s\\S]*?)\\n${end}`, "g");
  const pasted: string[] = [];
  const text = content
    .replace(re, (_full, body: string) => {
      pasted.push(body);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, pasted };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Раскодировать путь, пришедший из markdown-ссылки.
 *
 * decodeURI бросает на «битой» последовательности (одиночный «%» в имени файла
 * — законный символ, но невалидный процент-код). Падать из-за этого нельзя:
 * такой путь просто отдаём как есть, он и так корректен. */
function safeDecodePath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function makeFileUrlTransform(threadId: string) {
  return (url: string): string | null => {
    if (!url) return url;
    if (/^(https?:|data:|blob:|mailto:|#)/i.test(url)) return url;
    // Модель часто оформляет файл песочницы как `file:///outputs/x.csv`, а не
    // голым путём: нахваталась из скиллов pdf/pptx, где так ссылаются на
    // картинки внутри HTML. Схему снимаем — дальше обычная ветка пути.
    const path = url.replace(/^file:\/\//i, "");
    if (threadId && path.startsWith("/") && !path.startsWith("//")) {
      // Путь приходит из MARKDOWN, а парсер уже закодировал в нём не-ASCII:
      // «/work/Отчёт.docx» превращается в «/work/%D0%9E%D1%82...». Дальше
      // sessionFileRawUrl кодирует строку ЕЩЁ раз (URLSearchParams), и знак «%»
      // становится «%25» — сервер получает имя из процентов вместо кириллицы.
      // Файла с таким именем нет, и скачивание молча отдавало пустоту.
      // Возвращаем путь к исходному виду; кодирование — забота одной стороны.
      return sessionFileRawUrl(threadId, safeDecodePath(path));
    }
    // Всё, что осталось со схемой, — не наш случай: разрешённые перечислены
    // выше, путь обработан. Обрубаем, чтобы `vbscript:` и подобное не утекло
    // в href (раньше это резал rehype-harden, который мы отключили ради
    // `file://`; `javascript:` глушит сам React, но полагаться на это одно
    // не стоит).
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
    return url;
  };
}

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
