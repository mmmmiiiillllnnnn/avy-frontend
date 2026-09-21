"use client";

import { useEffect, useState } from "react";
import { MessagesSquare, Check, ChevronRight, ChevronLeft, ChevronDown } from "lucide-react";
import type { AskUserAnswer, AskUserQuestionSpec } from "@/lib/api";

/** Вопросы на паузе: что показать и какой interrupt резолвить.
 *  Свой тип, а не импорт из стримов кодера — у чата свой канал резолва. */
export type PendingQuestions = {
  interruptId: string | null;
  questions: AskUserQuestionSpec[];
};

/** Метка поля свободного ввода в списке вариантов (как «Other» у Claude Code). */
const OTHER = "__other__";

/**
 * Карточка ask_user для ОБЫЧНОГО ЧАТА — агент задаёт уточняющие вопросы с
 * вариантами ответа.
 *
 * Копия карточки кодера (components/code/question-card.tsx), адаптированная под
 * чат: тип PendingQuestions объявлен здесь, а не импортируется из стримов
 * кодера — каналы резолва у них разные (кодер отвечает локальному агенту в
 * Electron, чат — серверу полем answers). Копия, а не общий компонент: пути
 * живут отдельно и расходятся по мелочам, а связать их одним файлом значило бы
 * править кодер каждый раз, когда меняется чат.
 * Показывается, когда ход на паузе (pendingQuestions). Полностью на русском,
 * заголовок «Вопрос от Avy».
 *
 * Компоновка как визард: ОДИН вопрос на экран (даже если их несколько),
 * перелистывание «Назад»/«Далее»; на single-вопросе выбор автоматически ведёт
 * дальше. По клику в шапку карточка сворачивается (как permission/edit). Esc
 * снимает карточку и останавливает ход (onDismiss) — граф после ask_user уже
 * на паузе в чекпоинте, так что это чисто UI-выход из ожидания.
 *
 * onSubmit получает по одному AskUserAnswer на вопрос в исходном порядке;
 * uplink (chat-streams.resolveQuestions) резюмирует ход с этим массивом.
 */
export function QuestionCard({
  pending,
  onSubmit,
  onDismiss,
  busy,
}: {
  pending: PendingQuestions;
  onSubmit: (answers: AskUserAnswer[]) => void;
  onDismiss?: () => void;
  busy?: boolean;
}) {
  const { questions } = pending;
  const total = questions.length;

  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState(0); // индекс текущего вопроса
  // Выбор по каждому вопросу: набор выбранных label'ов (для single — максимум
  // один). OTHER в наборе = поле «Другое» активно; текст хранится отдельно.
  const [picks, setPicks] = useState<Array<Set<string>>>(() =>
    questions.map(() => new Set<string>()),
  );
  const [others, setOthers] = useState<string[]>(() => questions.map(() => ""));

  // Esc — снять карточку и остановить ход. Слушаем на документе, чтобы работало
  // и когда фокус вне карточки (в т.ч. пока курсор в поле «Другое»).
  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const q = questions[step];
  const multi = q.multiSelect === true;
  const set = picks[step];
  const isLast = step === total - 1;

  // На вопрос дан ответ: выбран вариант, и если активно «Другое» — оно заполнено.
  function isAnswered(qi: number): boolean {
    const s = picks[qi];
    if (s.size === 0) return false;
    if (s.has(OTHER) && !others[qi].trim()) return false;
    return true;
  }
  const currentAnswered = isAnswered(step);
  const allAnswered = questions.every((_, qi) => isAnswered(qi));

  function goNext() {
    if (!isLast) setStep((s) => s + 1);
  }

  function toggle(label: string) {
    setPicks((prev) => {
      const next = prev.map((s) => new Set(s));
      const s = next[step];
      if (multi) {
        if (s.has(label)) s.delete(label);
        else s.add(label);
      } else {
        const had = s.has(label);
        s.clear();
        if (!had) s.add(label);
      }
      return next;
    });
    // Single + обычный вариант (не «Другое») → авто-переход к следующему вопросу.
    // Для multiSelect и «Другое» авто-перехода нет — там пользователь сам жмёт
    // «Далее» (может добрать несколько / дописать текст).
    if (!multi && label !== OTHER && !isLast) {
      // setTimeout 0 — дать состоянию picks примениться перед сменой шага.
      setTimeout(() => setStep((s) => (s === step ? s + 1 : s)), 0);
    }
  }

  function setOther(text: string) {
    setOthers((prev) => {
      const next = [...prev];
      next[step] = text;
      return next;
    });
  }

  function submit() {
    if (!allAnswered || busy) return;
    const answers: AskUserAnswer[] = questions.map((_, qi) => {
      const s = picks[qi];
      const selected = [...s].filter((l) => l !== OTHER);
      const other = s.has(OTHER) ? others[qi].trim() : "";
      return other ? { selected, other } : { selected };
    });
    onSubmit(answers);
  }

  return (
    /* Без внешних отступов (в кодере тут mx-4 mb-3): в чате карточку
       позиционирует обёртка над инпутом, свои margin'ы дали бы двойной зазор. */
    <div className="rounded-lg border border-border bg-background text-sm overflow-hidden shadow-md">
      {/* Шапка — клик сворачивает/разворачивает (как permission/edit). */}
      <div
        className="flex cursor-pointer items-center gap-2 p-3 hover:bg-muted/60"
        onClick={() => setCollapsed((v) => !v)}
      >
        <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium flex-1 min-w-0">Вопрос от Avy</span>
        {total > 1 && (
          <span className="text-xs text-muted-foreground shrink-0">
            {step + 1} из {total}
          </span>
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </div>

      {!collapsed && (
        <>
          {/* Тело — один вопрос, скролл если длинно. */}
          <div className="max-h-[60vh] overflow-y-auto border-t border-border px-3 py-3">
            <div className="flex items-baseline gap-2">
              {q.header && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {q.header}
                </span>
              )}
              <span className="font-medium">{q.question}</span>
            </div>
            {multi && (
              <div className="mt-1 text-xs text-muted-foreground">Можно выбрать несколько</div>
            )}

            <div className="mt-2 space-y-1.5">
              {q.options.map((opt, oi) => {
                const active = set.has(opt.label);
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={busy}
                    onClick={() => toggle(opt.label)}
                    className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
                      active ? "border-emerald-600 bg-emerald-600/10" : "border-border hover:bg-accent"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        active ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40"
                      }`}
                    >
                      {active && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{opt.label}</span>
                      {opt.description && (
                        <span className="block text-xs text-muted-foreground">{opt.description}</span>
                      )}
                    </span>
                  </button>
                );
              })}

              {/* «Другое» — свободный ввод, всегда доступен (как у Claude Code). */}
              <button
                type="button"
                disabled={busy}
                onClick={() => toggle(OTHER)}
                className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
                  set.has(OTHER) ? "border-emerald-600 bg-emerald-600/10" : "border-dashed border-border hover:bg-accent"
                }`}
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    set.has(OTHER) ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40"
                  }`}
                >
                  {set.has(OTHER) && <Check className="size-3" />}
                </span>
                <span className="font-medium text-muted-foreground">Другое</span>
              </button>
              {set.has(OTHER) && (
                <textarea
                  autoFocus
                  value={others[step]}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (isLast) submit();
                      else if (currentAnswered) goNext();
                    }
                  }}
                  placeholder="Ваш вариант ответа…"
                  rows={2}
                  className="w-full resize-none rounded border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-ring placeholder:text-muted-foreground/60"
                />
              )}
            </div>
          </div>

          {/* Навигация: Назад | (Далее / Ответить). */}
          <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
            <button
              type="button"
              disabled={step === 0 || busy}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" /> Назад
            </button>
            <div className="flex-1" />
            {isLast ? (
              <button
                type="button"
                disabled={!allAnswered || busy}
                onClick={submit}
                className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Ответить
              </button>
            ) : (
              <button
                type="button"
                disabled={!currentAnswered || busy}
                onClick={goNext}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Далее <ChevronRight className="size-3.5" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
