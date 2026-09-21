"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Modal } from "@/components/ui/modal";
import {
  createReview,
  fetchEntryPrompts,
  markFeedbackDone,
  markWelcomeSeen,
} from "@/lib/api";
import { useLocale, useT } from "@/i18n/i18n-context";

/**
 * Что показать пользователю при входе: приветствие выданной роли и опрос по
 * окончании тестового периода.
 *
 * Оба «долга» живут на СЕРВЕРЕ (users.welcome_shown_at / feedback_due_at), а не
 * в localStorage: иначе приветствие вернулось бы в другом браузере, а на вопрос
 * «дошло ли до тестовой группы» ответить было бы нечем.
 *
 * Приветствие показывается ОДИН раз: отметку ставим при закрытии и больше её не
 * сбрасываем. Нужно показать новое — админ пишет новый текст (см. admin.py,
 * set_user_role).
 *
 * Текст — Markdown его пишет админ, поэтому рендерим тем же Streamdown, что и
 * ответы ассистента: свой рендерер разошёлся бы с чатом по виду.
 */
export function EntryPrompts() {
  const t = useT();
  const [welcome, setWelcome] = React.useState<string | null>(null);
  const [feedbackDue, setFeedbackDue] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void fetchEntryPrompts().then((p) => {
      if (!alive) return;
      setWelcome(p.welcome);
      setFeedbackDue(p.feedbackDue);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Приветствие важнее: оно про начало периода, опрос — про его конец. Вместе
  // они не встречаются, но если совпали — сперва поздороваемся.
  const closeWelcome = () => {
    setWelcome(null);
    // Отметку не ждём: пользователь уже закрыл окно, и сбой сети не повод
    // держать его перед модалкой. Худшее последствие — увидит ещё раз.
    void markWelcomeSeen().catch(() => {});
  };

  const closeFeedback = () => {
    setFeedbackDue(false);
    // Отказ снимает долг так же, как отправка: держать человека в петле «дай
    // обратную связь» — способ не получить ни отзыва, ни пользователя.
    void markFeedbackDone().catch(() => {});
  };

  if (welcome) {
    // Окно растёт под текст, но не больше 70% экрана — тот же потолок, что у
    // настроек. Короткое приветствие останется компактным, длинное получит
    // скролл внутри, а не растянет окно за край.
    return (
      <Modal
        open
        onClose={closeWelcome}
        title={t.auth.welcomeTitle}
        className="flex max-h-[70dvh] w-full max-w-[70vw] flex-col sm:max-w-2xl"
      >
        <div className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MessageResponse>{welcome}</MessageResponse>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={closeWelcome}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              {t.auth.welcomeClose}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (feedbackDue) {
    return <ReviewPrompt onDone={() => setFeedbackDue(false)} onSkip={closeFeedback} />;
  }

  return null;
}

/**
 * Опрос по окончании тестового периода: оценка обязательна, комментарий — нет.
 *
 * Почему оценка обязательна, а текст нет: без числа отзывы не с чем сравнивать
 * через полгода, а писать текст станут единицы. «Не сейчас» снимает долг так же,
 * как отправка — держать человека в петле «дай обратную связь» значит не
 * получить ни отзыва, ни пользователя.
 */
function ReviewPrompt({
  onDone,
  onSkip,
}: {
  onDone: () => void;
  onSkip: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function send() {
    if (!rating || sending) return;
    setSending(true);
    try {
      // source=role_expiry: бэкенд снимет долг сам (см. routes_support).
      await createReview({ rating, body, source: "role_expiry", locale });
      setSent(true);
      // Даём увидеть «спасибо», потом закрываем.
      setTimeout(onDone, 1200);
    } catch {
      // Сеть подвела — не запираем человека в модалке: долг останется, спросим
      // в следующий раз.
      onSkip();
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Modal open onClose={onDone} title={t.support.reviewTitle}>
        <p className="text-sm text-muted-foreground">{t.support.reviewThanks}</p>
      </Modal>
    );
  }

  const shown = hover || rating;

  return (
    <Modal open onClose={onSkip} title={t.auth.feedbackTitle}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t.auth.feedbackBody}</p>

        {/* Оценка. onMouseLeave на контейнере, а не на каждой звезде — иначе
            подсветка «залипает» при быстром уводе курсора между ними. */}
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
                    ? "size-7 fill-amber-400 text-amber-400"
                    : "size-7 text-muted-foreground/40"
                }
              />
            </button>
          ))}
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={t.support.reviewCommentPlaceholder}
          className="w-full resize-y rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/60 focus:bg-primary/5"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition hover:bg-muted"
          >
            {t.auth.feedbackLater}
          </button>
          <button
            type="button"
            disabled={!rating || sending}
            onClick={send}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {t.support.reviewSend}
          </button>
        </div>
      </div>
    </Modal>
  );
}
