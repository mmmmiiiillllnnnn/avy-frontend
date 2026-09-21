"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Лёгкая модалка на токенах темы (без primitive-библиотеки). Контролируемая:
// open/onClose. Закрытие по Esc и клику на бэкдроп. Назван Modal, чтобы не
// путать с потенциальным shadcn Dialog (другой API).

export function Modal({
  open,
  onClose,
  title,
  headerActions,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Слева в шапке. Строку оборачиваем в заголовок; узел рисуем как есть —
   *  так на это место встают вкладки вместо названия окна. */
  title?: React.ReactNode;
  /** Доп. действия в хедере, слева от крестика (напр. «скачать»). */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Портал нужен, чтобы модалка не зависела от МЕСТА вызова. Без него она
  // рендерится там, где её позвали, и попадает в чужой контекст наложения:
  // сайдбар — `fixed ... z-10`, а такой элемент создаёт свой контекст, внутри
  // которого z-50 модалки уже ничего не значит снаружи. Итог был виден глазом —
  // затемнение с блюром ложилось на сайдбар, но поле ввода чата оставалось
  // поверх и резким.
  //
  // В body таких предков нет, и z-50 работает по глобальной шкале.
  // ПРОВЕРЯЕМ document, А НЕ ФЛАГ СОСТОЯНИЯ. Раньше здесь стоял `mounted`,
  // который включался в useEffect, — из-за него КАЖДАЯ новая модалка первый
  // кадр рисовала null и только потом содержимое. При переходе между двумя
  // окнами (просмотр навыка -> его правка) это давало видимое мигание: старое
  // окно уже размонтировано, новое ещё пустое.
  //
  // Смысл проверки — не звать createPortal на сервере, где document нет; для
  // этого достаточно самого document, и лишний кадр не нужен.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Бэкдроп */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* Контейнер */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl",
          className,
        )}
      >
        <div className="mb-4 flex items-center gap-2">
          {typeof title === "string" ? (
            <h2 className="min-w-0 truncate text-lg font-semibold">{title}</h2>
          ) : (
            title
          )}
          <div className="ml-auto flex items-center gap-1">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
