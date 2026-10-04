"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { ConnectorLogo } from "@/components/agents/connectors-panel";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";

// ── Подключение из библиотеки: ОКНО с поиском и карточками ──────────────────
//
// ОДИН пикер на всё приложение: агенты, навыки, задачи и коннекторы в
// пространстве, коннекторы у агента и у задачи. Строка поиска сверху, ниже
// сетка карточек «имя + описание», клик переключает выбор (рамка primary +
// галка). Что выбрано — снаружи (checkedIds), окно ничего не хранит.

/** Карточка в окне выбора. Логотип и чип состояния — только у коннекторов;
 *  у остальных их просто нет, и карточка выглядит как раньше. */
export type PickerItem = {
  id: string;
  name: string;
  description?: string;
  /** Путь к логотипу (ConnectorLogo); без него — просто имя. */
  logo?: string | null;
  /** Готовая иконка (навыки: SkillIcon) — когда логотипа-файла нет. */
  icon?: React.ReactNode;
  /** Под описанием, напр. чип «Подключено / Не подключено». */
  badge?: React.ReactNode;
};

export function LibraryPickerModal({
  title,
  items,
  checkedIds,
  onToggle,
  onClose,
  emptyText,
}: {
  title: string;
  items: PickerItem[];
  checkedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
  emptyText: string;
}) {
  const t = useT();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  // Ищем и по id: в конфиге лежит id, и человек, пришедший из файла, ищет
  // «gmail», а не «Почта».
  const shown = q
    ? items.filter((i) =>
        `${i.id} ${i.name} ${i.description ?? ""}`.toLowerCase().includes(q),
      )
    : items;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      // Тот же размер, что у формы агента: большое окно, не «домик Барби».
      className="flex h-[80dvh] w-full max-w-5xl flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <>
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.agents.searchPlaceholder}
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {shown.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t.agents.nothingFound}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {shown.map((item) => {
                    const on = checkedIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onToggle(item.id)}
                        className={cn(
                          // h-full: в сетке карточки стоят рядом, и разная
                          // длина описания делала бы их разного роста.
                          "flex h-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                          on
                            ? "border-primary bg-primary/5"
                            : "border-border/60 hover:bg-accent",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {item.logo && <ConnectorLogo src={item.logo} className="size-4" />}
                            {item.icon}
                            <span className="min-w-0 truncate text-sm font-medium">
                              {item.name}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block h-8 text-xs leading-snug text-muted-foreground">
                            {item.description}
                          </span>
                          {item.badge && <span className="mt-1.5 block">{item.badge}</span>}
                        </span>
                        {on && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
