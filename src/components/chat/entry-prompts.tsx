"use client";

import * as React from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Modal } from "@/components/ui/modal";
import { fetchEntryPrompts, markWelcomeSeen } from "@/lib/api";
import { useT } from "@/i18n/i18n-context";

/**
 * Что показать пользователю при входе: приветствие, если оно задано.
 *
 * Отметка «показано» живёт на СЕРВЕРЕ (users.welcome_shown_at), а не в
 * localStorage: иначе приветствие вернулось бы в другом браузере.
 *
 * Приветствие показывается ОДИН раз: отметку ставим при закрытии и больше её не
 * сбрасываем.
 *
 * Опрос по обратной связи, который здесь жил рядом, убран вместе с разделом
 * «Обратная связь»: в локальной установке отправлять его некому.
 *
 * Текст — Markdown, рендерим тем же Streamdown, что и ответы ассистента: свой
 * рендерер разошёлся бы с чатом по виду.
 */
export function EntryPrompts() {
  const t = useT();
  const [welcome, setWelcome] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void fetchEntryPrompts().then((p) => {
      if (!alive) return;
      setWelcome(p.welcome);
    });
    return () => {
      alive = false;
    };
  }, []);

  const closeWelcome = () => {
    setWelcome(null);
    // Отметку не ждём: пользователь уже закрыл окно, и сбой сети не повод
    // держать его перед модалкой. Худшее последствие — увидит ещё раз.
    void markWelcomeSeen().catch(() => {});
  };

  if (!welcome) return null;

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
