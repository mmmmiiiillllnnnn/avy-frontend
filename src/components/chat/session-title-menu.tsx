"use client";

import * as React from "react";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/i18n-context";

type Props = {
  /** Заголовок текущей сессии (пустой — если сессия ещё не материализована). */
  title: string;
  /** Есть ли активная сессия в списке (черновик до первого сообщения — нет). */
  hasSession: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
};

/**
 * Название ТЕКУЩЕЙ сессии в хедере + меню действий над ней. Клик по названию
 * раскрывает dropdown: «Переименовать» (инлайн-инпут прямо в меню) и «Удалить».
 * Список всех сессий живёт в сайдбаре — тут только текущая.
 *
 * Пока сессия не материализована (пустой черновик до первого сообщения) —
 * показываем плейсхолдер «Новый чат» без меню (нечего переименовывать/удалять).
 */
export function SessionTitleMenu({ title, hasSession, onRename, onDelete }: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const shown = title || t.chat.newChat;

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) onRename(next);
    setEditing(false);
  };

  // Режим переименования — инпут НА МЕСТЕ заголовка (не внутри меню). Класть
  // <input> в base-ui Menu.Content нельзя: меню перехватывает клавиатуру
  // (typeahead/стрелки) и крадёт фокус, поэтому там нельзя было печатать и
  // onBlur коммитил пустое. Инлайн-инпут в хедере — как в сайдбаре.
  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setEditing(false);
        }}
        onBlur={commit}
        placeholder={t.chat.renamePlaceholder}
        className="max-w-[60vw] rounded-md bg-accent/50 px-2 py-1 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    );
  }

  // Нет активной сессии (черновик) — просто текст, без меню.
  if (!hasSession) {
    return (
      <span className="max-w-[60vw] truncate px-2 py-1 text-sm font-medium text-foreground">
        {shown}
      </span>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="flex max-w-[60vw] items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        render={<button type="button" />}
      >
        <span className="truncate">{shown}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem
          className="gap-2"
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
        >
          <Pencil className="size-4" />
          {t.chat.renameSession}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onClick={() => {
            onDelete();
            setOpen(false);
          }}
        >
          <Trash2 className="size-4" />
          {t.chat.deleteSession}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
