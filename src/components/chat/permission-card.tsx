"use client";

import { useState } from "react";
import { ShieldAlert, Check, X, ChevronDown, Pencil } from "lucide-react";
import type { PendingPermission } from "@/lib/chat-streams";

/**
 * Карточка подтверждения необратимого действия — УНИВЕРСАЛЬНАЯ.
 *
 * Показывается, когда ход встал на approval: агент собирается сделать что-то
 * необратимое (отправить письмо, удалить безвозвратно, создать встречу), а
 * подтвердить это должен человек. Какие действия подтверждаются, объявляет сам
 * агент полем `confirm:` в своём AGENT.md.
 *
 * ПОЧЕМУ ОНА НЕ ЗНАЕТ НИ ОДНОЙ ТУЛЫ. В кодерской версии карточка разбирала
 * аргументы сама: ветка под file_path, под command, под old_string/new_string
 * плюс switch по именам тулов. Из-за этого КАЖДАЯ новая тула требовала правки
 * фронта, а письмо там было не нарисовать вовсе — у него нет ни пути, ни
 * команды.
 *
 * Здесь текст приходит готовым, в поле description: его собирает тот, кто
 * написал тулу (agents/<slug>/tools/confirm.py), и он же знает, что человеку
 * важно увидеть перед решением — например, у письма это получатели, тема,
 * вложения и СКРЫТАЯ копия. Карточка только показывает.
 *
 * Аргументы показываем лишь как запасной вариант, когда описания нет: сырой
 * словарь — плохая опора для решения, но лучше, чем пустая карточка.
 *
 * РЕШЕНИЯ. «Отправить» (approve) и «Отклонить» (reject) уходят наверх; при
 * отклонении человек может написать причину — она попадёт агенту, и тот
 * исправит вызов вместо того, чтобы повторить его слово в слово.
 *
 * Правка полей (edit) в карточке пока не реализована: агент переделывает вызов
 * по тексту отказа. Канал для неё готов на бэкенде (allowed_decisions включает
 * edit), поэтому кнопка «Изменить» подсказывает, как это сделать словами.
 */
export function PermissionCard({
  pending,
  queueSize = 1,
  onDecide,
}: {
  pending: PendingPermission;
  /** Сколько заявок в очереди: показываем «1 из N», когда их несколько. */
  queueSize?: number;
  onDecide: (decision: "approve" | "reject", comment?: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = (decision: "approve" | "reject", text?: string) => {
    if (busy) return;
    setBusy(true);
    onDecide(decision, text?.trim() || undefined);
  };

  // Описание приходит готовым. Пусто — показываем имя тулы и аргументы: не
  // идеально, но человек хотя бы видит, что именно собирается произойти.
  const body = pending.description?.trim();
  const fallback = !body ? JSON.stringify(pending.args ?? {}, null, 2) : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ShieldAlert className="size-4 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium">Подтвердите действие</span>
        {queueSize > 1 && (
          <span className="text-xs text-muted-foreground">1 из {queueSize}</span>
        )}
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${
            collapsed ? "-rotate-90" : ""
          }`}
        />
      </button>

      {!collapsed && (
        <div className="space-y-3 px-4 pb-4">
          {body ? (
            // whitespace-pre-line: описание многострочное (кому, тема, вложения),
            // и переносы в нём значимы.
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {body}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm text-foreground/90">
                Агент вызывает{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {pending.tool}
                </code>
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted/60 p-2.5 text-xs leading-relaxed">
                {fallback}
              </pre>
            </div>
          )}

          {rejecting ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    decide("reject", comment);
                  }
                  if (e.key === "Escape") setRejecting(false);
                }}
                placeholder="Что исправить? Например: отправь Петрову, а не Иванову"
                rows={2}
                className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide("reject", comment)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <X className="size-3.5" />
                  Отклонить
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Назад
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide("approve")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Check className="size-3.5" />
                Подтвердить
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejecting(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3.5 py-1.5 text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
              >
                <Pencil className="size-3.5" />
                Изменить или отклонить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
