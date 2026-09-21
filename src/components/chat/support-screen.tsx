"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Bug,
  Lightbulb,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Star,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectNative } from "@/components/ui/select-native";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/i18n/i18n-context";
import {
  createReview,
  createTicket,
  fetchTicket,
  listTickets,
  replyToTicket,
  ticketAttachmentUrl,
  type Ticket,
  type TicketKind,
  type TicketStatus,
} from "@/lib/api";

// Те же константы формы, что в разделе задач: один ритм полей на весь продукт.
const FIELD =
  "w-full rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-primary/5";
const LABEL = "text-xs font-medium text-muted-foreground";

const KIND_ICON: Record<TicketKind, React.ElementType> = {
  bug: Bug,
  idea: Lightbulb,
  other: MessageSquare,
};

/** Цвет статуса: открытое обращение заметнее закрытого — по нему и сканируют. */
const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-primary/10 text-primary",
  in_progress: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  closed: "bg-muted text-muted-foreground",
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Диалог «Обратная связь»: список обращений → переписка по одному, плюс форма
 * нового.
 *
 * Размеры и обёртка — как у настроек (settings-dialog): на мобильном во весь
 * экран, на десктопе 70vw × 70vh. Свой портал с блюр-бэкдропом, а не общий
 * Modal: тот рассчитан на короткую форму по центру и растёт вместе с контентом,
 * а здесь список может быть длинным — окну нужна фиксированная высота со
 * скроллом внутри.
 */
export function SupportDialog({
  open,
  onClose,
  onUnreadChange,
}: {
  open: boolean;
  onClose: () => void;
  /** Счётчик непрочитанных мог измениться (открыли обращение с ответом). */
  onUnreadChange?: () => void;
}) {
  const t = useT();
  const [tickets, setTickets] = React.useState<Ticket[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // null — список; "new" — форма обращения; "review" — форма отзыва; иначе id
  // открытого обращения.
  const [view, setView] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);

  // Портал доступен только в браузере. Флаг ставим в микротаске, а не прямо в
  // теле эффекта — тот же приём, что в sidebar-user: синхронный setState
  // вызывает каскадный ре-рендер (react-hooks/set-state-in-effect).
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const load = React.useCallback(() => {
    listTickets()
      .then(setTickets)
      .catch((e) => setError(String(e)));
  }, []);

  React.useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Закрытие возвращает к списку: следующее открытие не должно показывать
  // переписку с прошлого раза. Делаем в обработчике, а не эффектом на open —
  // это следствие действия, а не синхронизация с внешним состоянием.
  const close = React.useCallback(() => {
    setView(null);
    onClose();
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc внутри переписки/формы возвращает к списку, и только со списка
      // закрывает окно — иначе случайное нажатие теряет набранный текст.
      if (view !== null) setView(null);
      else close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, view, close]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
            onClick={close}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            // Тот же кегль, что в настройках и сайдбаре (см. settings-dialog).
            style={{ "--text-sm": "0.8125rem" } as React.CSSProperties}
            className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden border-border bg-card text-card-foreground shadow-2xl sm:h-[70vh] sm:w-[70vw] sm:max-w-3xl sm:rounded-2xl sm:border"
          >
            {/* Шапка: заголовок, «назад» из переписки, крестик. */}
            <div
              className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3"
              style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
            >
              {view !== null && (
                <button
                  type="button"
                  onClick={() => setView(null)}
                  aria-label={t.recurringTasks.backToList}
                  title={t.recurringTasks.backToList}
                  className="-ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-4.5" />
                </button>
              )}
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
                {t.support.title}
              </h2>
              {/* Два входа: отзыв (оценка, отвечать не на что) и обращение
                  (переписка со статусом). Отзыв второстепенной кнопкой —
                  основной сценарий раздела всё же обращение. */}
              {view === null && (
                <>
                  <button
                    type="button"
                    onClick={() => setView("review")}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-muted"
                  >
                    <Star className="size-4" />
                    <span className="hidden sm:inline">{t.support.reviewSend}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("new")}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                  >
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">{t.support.newTicket}</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={close}
                aria-label={t.settings.close}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Тело: единственная скролл-зона окна. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {view === "review" ? (
                <ReviewForm />
              ) : error ? (
                <div className="p-6 text-sm text-destructive">
                  {t.support.loadError(error)}
                </div>
              ) : view === "new" ? (
                <NewTicketForm
                  onCancel={() => setView(null)}
                  onCreated={(id) => {
                    load();
                    setView(id);
                  }}
                />
              ) : view ? (
                <TicketThread
                  ticketId={view}
                  onChanged={() => {
                    load();
                    onUnreadChange?.();
                  }}
                />
              ) : (
                <TicketList
                  tickets={tickets}
                  onOpen={(id) => setView(id)}
                  onCreate={() => setView("new")}
                />
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Отзыв о продукте по своей воле (не по нашей просьбе — та живёт в
 * entry-prompts и приходит по окончании периода).
 *
 * Оценка обязательна, текст нет: без числа отзывы не с чем сравнивать через
 * полгода, а писать станут единицы.
 */
function ReviewForm() {
  const t = useT();
  const { locale } = useLocale();
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function send() {
    if (!rating || sending) return;
    setSending(true);
    setError(null);
    try {
      await createReview({ rating, body, source: "manual", locale });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 p-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl border bg-muted/50 text-amber-400 [&_svg]:size-6">
          <Star className="fill-amber-400" />
        </span>
        <p className="text-sm font-medium">{t.support.reviewThanks}</p>
        <button
          type="button"
          onClick={() => {
            // Разрешаем оставить ещё один: мнение меняется, и второй отзыв
            // через месяц ценнее, чем запрет «вы уже оценивали».
            setSent(false);
            setRating(0);
            setBody("");
          }}
          className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition hover:bg-muted"
        >
          {t.support.reviewAgain}
        </button>
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">{t.support.reviewHint}</p>

      {/* onMouseLeave на контейнере, а не на каждой звезде — иначе подсветка
          «залипает» при быстром уводе курсора между ними. */}
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label={t.support.reviewHint}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={t.support.ratingLabel(n)}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="rounded p-1 transition-transform hover:scale-110"
          >
            <Star
              className={
                n <= shown
                  ? "size-8 fill-amber-400 text-amber-400"
                  : "size-8 text-muted-foreground/40"
              }
            />
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>{t.support.bodyLabel}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder={t.support.reviewCommentPlaceholder}
          className={cn(FIELD, "resize-y")}
        />
      </label>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!rating || sending}
          onClick={send}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {sending ? t.support.sending : t.support.reviewSend}
        </button>
      </div>
    </div>
  );
}

function TicketList({
  tickets,
  onOpen,
  onCreate,
}: {
  tickets: Ticket[] | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const t = useT();
  if (tickets === null) {
    return <div className="p-6 text-sm text-muted-foreground">{t.files.loading}</div>;
  }
  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare />}
        title={t.support.empty}
        description={t.support.emptyHint}
        className="min-h-full"
        action={
          <button
            type="button"
            onClick={onCreate}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t.support.newTicket}
          </button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 p-4">
      {tickets.map((ticket) => (
        <TicketRow key={ticket.id} ticket={ticket} onOpen={() => onOpen(ticket.id)} />
      ))}
    </div>
  );
}

function statusLabel(t: ReturnType<typeof useT>, s: TicketStatus): string {
  return s === "open"
    ? t.support.statusOpen
    : s === "in_progress"
      ? t.support.statusInProgress
      : t.support.statusClosed;
}

function kindLabel(t: ReturnType<typeof useT>, k: TicketKind): string {
  return k === "bug" ? t.support.kindBug : k === "idea" ? t.support.kindIdea : t.support.kindOther;
}

function TicketRow({ ticket, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const t = useT();
  const Icon = KIND_ICON[ticket.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:bg-accent/40"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {ticket.subject || kindLabel(t, ticket.kind)}
          </span>
          {ticket.unread && (
            <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
              {t.support.unread}
            </span>
          )}
        </span>
        <span className="line-clamp-1 text-xs text-muted-foreground">{ticket.body}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_STYLE[ticket.status],
          )}
        >
          {statusLabel(t, ticket.status)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {shortDate(ticket.createdAt)}
        </span>
      </span>
    </button>
  );
}

/** Форма нового обращения. */
function NewTicketForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [kind, setKind] = React.useState<TicketKind>("bug");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function submit() {
    if (!body.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createTicket({ kind, subject, body, locale, files });
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{t.support.kindLabel}</span>
          <SelectNative
            value={kind}
            onChange={(e) => setKind(e.target.value as TicketKind)}
          >
            <option value="bug">{t.support.kindBug}</option>
            <option value="idea">{t.support.kindIdea}</option>
            <option value="other">{t.support.kindOther}</option>
          </SelectNative>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{t.support.subjectLabel}</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t.support.subjectPlaceholder}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{t.support.bodyLabel}</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            placeholder={t.support.bodyPlaceholder}
            className={cn(FIELD, "resize-y")}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className={LABEL}>{t.support.attachLabel}</span>
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-foreground/5 py-1 pr-1 pl-2.5 text-xs"
              >
                <span className="max-w-40 truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Paperclip className="size-3.5" />
              {t.support.attachHint}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
              // Сбрасываем значение: иначе повторный выбор ТОГО ЖЕ файла не
              // вызовет change и он не прикрепится.
              e.target.value = "";
            }}
          />
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition hover:bg-muted"
          >
            {t.support.cancel}
          </button>
          <button
            type="button"
            disabled={!body.trim() || saving}
            onClick={submit}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? t.support.sending : t.support.send}
          </button>
        </div>
    </div>
  );
}

/** Переписка по обращению. */
function TicketThread({
  ticketId,
  onChanged,
}: {
  ticketId: string;
  onChanged: () => void;
}) {
  const t = useT();
  const [ticket, setTicket] = React.useState<Ticket | null>(null);
  const [reply, setReply] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const load = React.useCallback(
    (notify: boolean) => {
      fetchTicket(ticketId)
        .then((data) => {
          setTicket(data);
          // Открытие сняло отметку непрочитанного на сервере — обновим бейдж.
          if (notify) onChanged();
        })
        .catch(() => setTicket(null));
    },
    [ticketId, onChanged],
  );

  React.useEffect(() => load(true), [load]);

  async function send() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await replyToTicket(ticketId, text);
      setReply("");
      load(false);
    } finally {
      setSending(false);
    }
  }

  if (!ticket) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t.files.loading}</div>
    );
  }

  const Icon = KIND_ICON[ticket.kind];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
        {/* Шапка обращения. */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
            <Icon />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold">
              {ticket.subject || kindLabel(t, ticket.kind)}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {shortDate(ticket.createdAt)}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
              STATUS_STYLE[ticket.status],
            )}
          >
            {statusLabel(t, ticket.status)}
          </span>
        </div>

        {/* Исходное сообщение + скриншоты. */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm whitespace-pre-wrap">{ticket.body}</p>
          {ticket.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {ticket.attachments.map((i) => (
                <a
                  key={i}
                  href={ticketAttachmentUrl(ticket.id, i)}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-border transition hover:border-primary/40"
                >
                  {/* Обычный img: это пользовательский файл из нашего же API,
                      оптимизировать его нечем, а next/image потребовал бы
                      разрешать домен. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ticketAttachmentUrl(ticket.id, i)}
                    alt=""
                    className="size-24 object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Переписка. */}
        {(ticket.messages ?? []).map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex flex-col gap-1 rounded-xl border p-4",
              m.isStaff
                ? "border-primary/30 bg-primary/5"
                : "border-border bg-card",
            )}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {m.isStaff ? t.support.staff : t.support.you} · {shortDate(m.createdAt)}
            </span>
            <p className="text-sm whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}

        {ticket.status === "closed" && (
          <p className="text-xs text-muted-foreground">{t.support.closedHint}</p>
        )}

        {/* Ответ. */}
        <div className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              // Enter отправляет, Shift+Enter — перенос строки: как в инпуте чата.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={t.support.replyPlaceholder}
            className={cn(FIELD, "resize-y")}
          />
          <button
            type="button"
            disabled={!reply.trim() || sending}
            onClick={send}
            title={t.support.reply}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </div>
    </div>
  );
}
