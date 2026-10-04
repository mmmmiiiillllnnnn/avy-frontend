"use client";

import * as React from "react";
import { Plus, SlidersHorizontal, X } from "lucide-react";

import { ConnectorLogo } from "@/components/agents/connectors-panel";
import { LibraryPickerModal, type PickerItem } from "@/components/ui/library-picker-modal";
import { useT } from "@/i18n/i18n-context";

// ── Поле «заголовок + плюс, ниже список выбранного» ─────────────────────────
//
// Устроено как «Вложения» у задачи: заголовок раздела, справа от него
// маленький «+», под ним строки. Плюс открывает ОБЩЕЕ окно выбора
// (LibraryPickerModal). Чипы с большой кнопкой «Добавить» в строку отвергнуты:
// в форме они выглядели чужеродно рядом с остальными полями.

export function PickerField({
  label,
  hint,
  title,
  items,
  value,
  onChange,
  emptyText,
  onConfigure,
  configuredIds,
}: {
  /** Заголовок поля. */
  label: string;
  /** Пояснение под списком. */
  hint?: string;
  /** Заголовок окна выбора; по умолчанию — label. */
  title?: string;
  /** Что можно выбрать; null — каталог ещё грузится. */
  items: PickerItem[] | null;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Текст в окне, когда выбирать не из чего. */
  emptyText: string;
  /** Настройка выбранного элемента (правила коннектора у сущности). Нет —
   *  кнопки нет. */
  onConfigure?: (id: string) => void;
  /** У каких элементов уже свои настройки — кнопка подсвечена. */
  configuredIds?: string[];
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex h-7 items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={items === null}
          title={t.connectors.add}
          aria-label={t.connectors.add}
          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* Выделенная область фиксированной высоты, как поле вложений:
          карточки компактные, в три колонки, с прокруткой внутри — поле не
          растягивает форму, сколько бы ни выбрали. */}
      <div className="max-h-36 overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-2">
        {items === null ? (
          <span className="block px-1 py-1 text-xs text-muted-foreground">{t.files.loading}</span>
        ) : value.length === 0 ? (
          <span className="block px-1 py-1 text-xs text-muted-foreground">{t.connectors.noneSelected}</span>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
            {value.map((id) => {
              // Неизвестный id (сервис удалили, конфиг правили файлом)
              // показываем как есть: молча терять его при сохранении нельзя.
              const item = items.find((i) => i.id === id);
              return (
                <div
                  key={id}
                  title={item?.description}
                  className="group flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background pl-2.5 pr-1 text-sm"
                >
                  {item?.logo && <ConnectorLogo src={item.logo} className="size-4" />}
                  {item?.icon}
                  <span className={item ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-muted-foreground"}>
                    {item ? item.name : id}
                  </span>
                  {onConfigure && (
                    <button
                      type="button"
                      onClick={() => onConfigure(id)}
                      title={t.connectors.configure}
                      aria-label={`${t.connectors.configure}: ${item?.name ?? id}`}
                      className={
                        configuredIds?.includes(id)
                          ? "flex size-6 shrink-0 items-center justify-center rounded-md text-primary hover:bg-muted"
                          : "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      }
                    >
                      <SlidersHorizontal className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-label={t.spaces.detach}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}

      {open && (
        <LibraryPickerModal
          title={title ?? label}
          items={items ?? []}
          checkedIds={value}
          onToggle={toggle}
          onClose={() => setOpen(false)}
          emptyText={emptyText}
        />
      )}
    </section>
  );
}
