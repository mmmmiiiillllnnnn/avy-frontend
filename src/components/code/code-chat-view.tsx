"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AIChatInput } from "@/components/code/code-chat-input-base";
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
import type { ChatMessage } from "@/hooks/use-code-chat";
import type { EffortLevel } from "@/components/code/code-chat-input-base";
import { ThoughtChain } from "@/components/code/code-tool-steps-base";
import { OffscreenCull } from "@/components/chat/offscreen-cull";
import { AttachmentChip, mimeFromPath } from "@/components/chat/attachment-chip";
import { sessionFileRawUrl, sendFeedback } from "@/lib/api";
import type { Attachment } from "@/hooks/use-code-chat";
import {
  PASTED_TEXT_MARKER,
  PASTED_TEXT_MARKER_END,
  pastePreview,
} from "@/lib/code/code-chat-streams";
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
  onSend: (text: string, files: File[]) => void | Promise<void>;
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
  deepSearch?: boolean;
  onDeepSearchChange?: (active: boolean) => void;
  /** Лимит исчерпан — показать плашку над инпутом и заблокировать ввод. */
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
  deepSearch,
  onDeepSearchChange,
  limitExhausted,
  limitResetAt,
}: ChatProps) {
  const t = useT();
  const { locale } = useLocale();
  const isEmpty = messages.length === 0;
  // Для автоскролла «новое сообщение к верху»: считаем сообщения пользователя
  // (триггер — отправка, не стрим ответа) и индекс последнего из них (его ряд
  // помечаем [data-last-user], к нему скроллит ConversationScrollOnSend).
  const userCount = messages.reduce(
    (n, m) => (m.role !== "assistant" ? n + 1 : n),
    0,
  );
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") {
      lastUserIndex = i;
      break;
    }
  }

  return (
    <div
      id="chat-area"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Лента скроллится ВНУТРИ себя (flex-1 + min-h-0). Нижний паддинг даёт
          место под плавающую капсулу инпута, чтобы последнее сообщение из-под
          неё было видно. */}
      {!isEmpty && (
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
                pb-*, который конфликтует с p-4 базового ConversationContent). */}
            <div aria-hidden className="h-24 shrink-0" />
          </ConversationContent>
          {/* Кнопка «вниз» — над плавающей капсулой инпута (та висит у bottom-0
              c высотой ~капсула+отступы). Поднимаем, чтобы не пряталась под ней. */}
          <ConversationScrollButton className="bottom-32 shadow-md" />
        </Conversation>
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

        <motion.div layout className="pointer-events-auto mx-auto w-full max-w-3xl">
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
            contextUsage={contextUsage}
            compacting={compacting}
            onCompact={onCompact}
            effort={effort}
            onEffortChange={onEffortChange}
            deepSearch={deepSearch}
            onDeepSearchChange={onDeepSearchChange}
            disabled={limitExhausted}
          />
          <p className="mt-2 px-2 text-center text-xs text-muted-foreground">
            {t.input.disclaimer}
          </p>
          {error && (
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
              <span>{resolveError(error, t.chat.errors)}</span>
            </div>
          )}
        </motion.div>
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
const MessageRow = memo(function MessageRow({
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
        <MessageResponse>{text}</MessageResponse>
      </MessageContent>
      {canEdit && (
        <Actions className="opacity-0 transition-opacity group-hover/user:opacity-100 has-[:focus-visible]:opacity-100">
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

  const parts = m.parts ?? [];
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

  return (
    <>
      {parts.map((p, i) =>
        p.type === "chain" ? (
          <ThoughtChain
            key={i}
            steps={p.steps}
            // «Работает», пока это последний part и идёт стрим.
            isRunning={running && i === parts.length - 1}
            // Финальный ответ пошёл, если после этой цепочки есть текст —
            // тогда принудительно сворачиваем (даже если юзер раскрыл).
            finalized={parts.slice(i + 1).some((q) => q.type === "text")}
            threadId={threadId}
          />
        ) : (
          <MessageResponse key={i} urlTransform={urlTransform}>
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
          : "mt-1 opacity-0 transition-opacity group-hover:opacity-100 has-[:focus-visible]:opacity-100"
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

function makeFileUrlTransform(threadId: string) {
  return (url: string): string | null => {
    if (!url) return url;
    if (/^(https?:|data:|blob:|mailto:|#)/i.test(url)) return url;
    if (threadId && url.startsWith("/") && !url.startsWith("//")) {
      return sessionFileRawUrl(threadId, url);
    }
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
