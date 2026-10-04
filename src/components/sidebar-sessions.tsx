"use client";

import * as React from "react";
import {
  ArrowUpRight,
  Check,
  Clock,
  Folder,
  FolderOpen,
  ListFilter,
  MessageCircle,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  listRecurringTasks,
  listSpaces,
  updateSpace,
  type RecurringTask,
  type Space,
  type ThreadInfo,
} from "@/lib/api";
import { useT } from "@/i18n/i18n-context";

type Props = {
  threads: ThreadInfo[];
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** Открыть детальный экран регулярной задачи (раздел «Задачи»). Если не
   *  передан (avy-code) — задачи в списке не показываются вовсе. */
  onOpenTask?: (taskId: string) => void;
  /** Перейти в раздел пространства (↗ на папке). Если не передан (avy-code) —
   *  папок пространств в списке нет. */
  onOpenSpace?: (spaceId: string) => void;
};

type TypeFilter = "all" | "chat" | "space" | "task";

// «Просмотрено»: task_id -> last_run_at, который пользователь уже видел.
// Живёт в localStorage — это состояние восприятия, не данных; серверу оно
// не нужно, а точка должна переживать перезагрузку страницы.
const SEEN_KEY = "avy_task_seen_v1";

function loadSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Список сессий в сайдбаре. Единый и всегда развёрнутый (сворачивание убрано
 * намеренно). В нём живут и чаты, и регулярные задачи — тип показан иконкой
 * (пузырь/часы), у задачи с непросмотренным прогоном — акцентная точка без
 * цифр. Фильтр по типу — кнопка-воронка у заголовка, как в «Моих агентах»:
 * подсвечена, пока фильтр применён. Закреплённые — отдельным блоком сверху.
 * Пространства появятся здесь папками (см. docs/entities.md).
 */
export function SidebarSessions({
  threads,
  activeId,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onOpenTask,
  onOpenSpace,
}: Props) {
  const t = useT();
  const [filter, setFilter] = React.useState<TypeFilter>("all");
  const [filterOpen, setFilterOpen] = React.useState(false);

  // Задачи — своя лёгкая загрузка, не общий стор раздела «Задачи»: сайдбару
  // нужен только список с last_run_at для точек. Перечитываем раз в минуту —
  // прогоны стартуют в фоне без каких-либо действий пользователя.
  const [tasks, setTasks] = React.useState<RecurringTask[]>([]);
  const [spaces, setSpaces] = React.useState<Space[]>([]);
  // Ленивый инициализатор: на сервере localStorage нет — loadSeen вернёт {}
  // из catch, а на клиенте карта готова до первой отрисовки точек.
  const [seen, setSeen] = React.useState<Record<string, string>>(loadSeen);
  React.useEffect(() => {
    if (!onOpenTask && !onOpenSpace) return;
    let cancelled = false;
    const load = () => {
      if (onOpenTask) {
        void listRecurringTasks()
          .then((list) => {
            if (!cancelled) setTasks(list);
          })
          .catch(() => {});
      }
      if (onOpenSpace) {
        // include_archived НЕ просим: чаты архивных пространств честно
        // рассыпаются в общий поток — папка архивного не нужна.
        void listSpaces()
          .then((list) => {
            if (!cancelled) setSpaces(list);
          })
          .catch(() => {});
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    // Список пространств живёт здесь своей копией и сам обновляется раз в
    // минуту. Этого мало для УДАЛЕНИЯ: оно происходит в разделе «Пространства»,
    // и до следующего тика папка удалённого висела в сессиях (пустая, ничего
    // не открывающая). Раздел шлёт событие — перечитываем сразу.
    window.addEventListener("avy:spaces-changed", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("avy:spaces-changed", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOpenTask ? 1 : 0, onOpenSpace ? 1 : 0]);

  const markSeen = (task: RecurringTask) => {
    if (!task.last_run_at) return;
    const next = { ...loadSeen(), [task.id]: task.last_run_at };
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    setSeen(next);
  };

  // Раскрытость папок пространств. Явного значения нет → папка с активным
  // чатом раскрыта, остальные закрыты. Производное, а не эффект: синхронный
  // setState в эффекте у нас lint-ошибка, а derived-значение и так живое.
  const [folderState, setFolderState] = React.useState<Record<string, boolean>>({});

  if (threads.length === 0 && tasks.length === 0 && spaces.length === 0) return null;

  const pinned = threads.filter((tr) => tr.pinned);
  const rest = threads.filter((tr) => !tr.pinned);

  // Пин папки — свойство пространства (spaces.pinned). Оптимистично: папка
  // прыгает в закреплённые сразу, откат — только если сервер отказал.
  const toggleSpacePin = (space: Space) => {
    const next = !space.pinned;
    setSpaces((cur) =>
      cur.map((s) => (s.id === space.id ? { ...s, pinned: next } : s)),
    );
    void updateSpace(space.id, { pinned: next }).catch(() =>
      setSpaces((cur) =>
        cur.map((s) => (s.id === space.id ? { ...s, pinned: !next } : s)),
      ),
    );
  };

  // Чаты пространств уходят в папки; остальные — в общий поток. Чат с
  // project_id архивного/неизвестного пространства остаётся в потоке: папки
  // рисуются только для живых пространств из listSpaces().
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const bySpace = new Map<string, ThreadInfo[]>();
  const loose: ThreadInfo[] = [];
  for (const tr of rest) {
    if (tr.project_id && spaceById.has(tr.project_id)) {
      const bucket = bySpace.get(tr.project_id);
      if (bucket) bucket.push(tr);
      else bySpace.set(tr.project_id, [tr]);
    } else {
      loose.push(tr);
    }
  }

  const activeSpaceId =
    threads.find((tr) => tr.id === activeId)?.project_id ?? null;
  const folderOpen = (spaceId: string) =>
    folderState[spaceId] ?? spaceId === activeSpaceId;

  const renderRow = (thread: ThreadInfo, indent = false) => (
    <SessionRow
      key={thread.id}
      thread={thread}
      active={thread.id === activeId}
      indent={indent}
      onSelect={() => onSelect(thread.id)}
      onDelete={() => onDelete(thread.id)}
      onRename={(title) => onRename(thread.id, title)}
      onTogglePin={() => onTogglePin(thread.id, !thread.pinned)}
    />
  );

  // Папка пространства + её чаты. Общий рендер для обеих зон (закреплённые /
  // поток): разметка одна, различается только место в списке.
  const renderFolder = (space: Space, children: ThreadInfo[]) => {
    const open = folderOpen(space.id);
    return (
      <React.Fragment key={space.id}>
        <SpaceFolderRow
          space={space}
          open={open}
          onToggle={() =>
            setFolderState((prev) => ({ ...prev, [space.id]: !open }))
          }
          onOpen={() => onOpenSpace?.(space.id)}
          onTogglePin={() => toggleSpacePin(space)}
        />
        {open && children.map((tr) => renderRow(tr, true))}
      </React.Fragment>
    );
  };

  // Закреплённые папки — над скролл-зоной, рядом с закреплёнными чатами,
  // вперемешку по свежести (у папки — свежайший её чат).
  const pinnedSpaces = spaces.filter((s) => s.pinned);
  const streamSpaces = spaces.filter((s) => !s.pinned);
  type PinnedItem =
    | { kind: "chat"; at: string; thread: ThreadInfo }
    | { kind: "space"; at: string; space: Space; children: ThreadInfo[] };
  const pinnedItems: PinnedItem[] = [
    ...pinned.map((thread): PinnedItem => ({ kind: "chat", at: thread.updated_at, thread })),
    // Закреплённое пространство показываем всегда, даже пустое: пин — явная
    // просьба держать его на виду.
    ...pinnedSpaces.map((space): PinnedItem => {
      const children = bySpace.get(space.id) ?? [];
      return {
        kind: "space",
        at: children[0]?.updated_at ?? space.updated_at,
        space,
        children,
      };
    }),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  // Чаты, задачи и папки пространств — вперемешку, по свежести: у чата это
  // updated_at, у задачи — последний прогон (без прогонов — создание), у
  // папки — свежайший её чат (пустая — само пространство). Отдельные блоки
  // сверху отвергнуты: они бы вытесняли чаты, ради которых список существует.
  type Item =
    | { kind: "chat"; at: string; thread: ThreadInfo }
    | { kind: "task"; at: string; task: RecurringTask }
    | { kind: "space"; at: string; space: Space; children: ThreadInfo[] };
  const items: Item[] = [
    ...(filter === "all" || filter === "chat"
      ? loose.map((thread): Item => ({ kind: "chat", at: thread.updated_at, thread }))
      : []),
    ...(filter === "all" || filter === "task"
      ? tasks.map((task): Item => ({
          kind: "task",
          at: task.last_run_at ?? task.created_at,
          task,
        }))
      : []),
    ...(filter === "all" || filter === "space"
      ? streamSpaces
          // ПУСТЫЕ НЕ ПОКАЗЫВАЕМ. Это список сессий: папка без единого чата
          // занимает в нём строку, ничего не открывая, — а пространство,
          // созданное минуту назад, сразу оказывалось наверху списка. Появится
          // первый чат — появится и папка. Само пространство никуда не делось:
          // оно в разделе «Пространства», и закреплённое видно всегда (выше).
          .filter((space) => (bySpace.get(space.id)?.length ?? 0) > 0)
          .map((space): Item => {
            const children = bySpace.get(space.id) ?? [];
            return {
              kind: "space",
              at: children[0]?.updated_at ?? space.updated_at,
              space,
              children,
            };
          })
      : []),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2">
      {/* Заголовок больше НЕ сворачивает список (сворачивание убрано);
          справа — фильтр по типу, паттерн из «Моих агентов»: кнопка-иконка,
          подсвеченная, пока фильтр применён, с меню-галочкой. */}
      <div className="flex shrink-0 items-center">
        <SidebarGroupLabel className="flex-1 select-none">
          {t.chat.sessions}
        </SidebarGroupLabel>
        {onOpenTask && (
          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownMenuTrigger
              aria-label={t.chat.sessionFilter}
              title={t.chat.sessionFilter}
              className={cn(
                "flex size-6 items-center justify-center rounded-md border outline-none transition-colors",
                filter !== "all"
                  ? "border-primary bg-primary/10 text-sidebar-foreground"
                  : "border-transparent text-sidebar-foreground/60 hover:text-sidebar-foreground",
              )}
              render={<button type="button" />}
            >
              <ListFilter className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {(
                [
                  ["all", t.chat.sessionFilterAll],
                  ["chat", t.chat.sessionFilterChats],
                  ["space", t.chat.sessionFilterSpaces],
                  ["task", t.chat.sessionFilterTasks],
                ] as const
              ).map(([key, label]) => (
                <DropdownMenuItem
                  key={key}
                  className="justify-between gap-2"
                  onClick={() => setFilter(key)}
                >
                  {label}
                  {filter === key && <Check className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Закреплённые — прибиты сверху, не скроллятся. Фильтр их не трогает:
            пин сильнее фильтра, закреплённое видно всегда. */}
        {pinnedItems.length > 0 && (
          <div className="shrink-0">
            <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-sidebar-foreground/50">
              {t.chat.pinnedSection}
            </div>
            <SidebarMenu>
              {pinnedItems.map((item) =>
                item.kind === "chat"
                  ? renderRow(item.thread)
                  : renderFolder(item.space, item.children),
              )}
            </SidebarMenu>
          </div>
        )}
        {/* Обычные сессии и задачи — единственная скролл-зона. Линия сверху —
            видимая граница скролла: под ней список уезжает, над ней (заголовок,
            закреплённые) — статика. Нижняя граница — линия футера пользователя.
            Отдельный разделитель после закреплённых стал не нужен — его роль
            выполняет эта же линия. */}
        <div className="min-h-0 flex-1 border-t border-sidebar-border">
          {/* pt-1.5 (6px) до первой строки: геометрически симметрично было бы
              8 (как от «СЕССИИ» до линии), но текст строки сам отстоит от
              верха плашки — оптически 6 выглядит ровнее (подобрано глазом). */}
          <div className="no-scrollbar h-full overflow-y-auto pt-1.5">
            <SidebarMenu>
              {items.map((item) => {
                if (item.kind === "chat") return renderRow(item.thread);
                if (item.kind === "task") {
                  return (
                    <TaskRow
                      key={item.task.id}
                      task={item.task}
                      unseen={
                        !!item.task.last_run_at &&
                        seen[item.task.id] !== item.task.last_run_at
                      }
                      onOpen={() => {
                        markSeen(item.task);
                        onOpenTask?.(item.task.id);
                      }}
                    />
                  );
                }
                return renderFolder(item.space, item.children);
              })}
            </SidebarMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Строка-папка пространства. Клик по строке раскрывает/сворачивает её чаты;
 * состояние показывает сама иконка (закрытая/открытая папка), стрелки нет —
 * решение из макета. Меню действий у папки НЕТ намеренно: ни удалить, ни
 * переименовать — на ховере только ↗ «перейти в пространство», управление
 * живёт в его разделе.
 */
function SpaceFolderRow({
  space,
  open,
  onToggle,
  onOpen,
  onTogglePin,
}: {
  space: Space;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const t = useT();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={onToggle}
        className={cn(
          "h-7 select-none border-b border-transparent bg-clip-padding",
          "group-hover/menu-item:bg-[#e6e6e6]! dark:group-hover/menu-item:bg-[#3a3a3a]! group-hover/menu-item:text-sidebar-accent-foreground",
        )}
      >
        {open ? (
          <FolderOpen className="size-3! shrink-0 text-sidebar-foreground/60" />
        ) : (
          <Folder className="size-3! shrink-0 text-sidebar-foreground/60" />
        )}
        {/* Фейд у правого края при ховере — как у сессий: кнопки встают в
            чистую зону. Две кнопки (пин + ↗) — стопы как у сессий: 80→52px. */}
        <span
          className={cn(
            "w-full truncate font-medium",
            "group-hover/menu-item:text-clip! group-hover/menu-item:[mask-image:linear-gradient(to_right,black_calc(100%-80px),transparent_calc(100%-52px))]",
          )}
        >
          {space.name}
        </span>
      </SidebarMenuButton>
      <div className="absolute top-1/2 right-1 hidden -translate-y-[52%] items-center gap-0.5 pointer-fine:flex pointer-fine:opacity-0 pointer-fine:group-hover/menu-item:opacity-100">
        <button
          type="button"
          aria-label={space.pinned ? t.chat.unpinSession : t.chat.pinSession}
          title={space.pinned ? t.chat.unpinSession : t.chat.pinSession}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-[#c8c8c8] hover:text-sidebar-foreground dark:hover:bg-sidebar-border"
        >
          {space.pinned ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label={t.chat.openSpace}
          title={t.chat.openSpace}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-[#c8c8c8] hover:text-sidebar-foreground dark:hover:bg-sidebar-border"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      </div>
    </SidebarMenuItem>
  );
}

/**
 * Строка регулярной задачи в общем списке. Никаких действий на ней нет —
 * ни удаления, ни переименования: клик только переходит на её экран в разделе
 * «Задачи», управление живёт там. Точка — непросмотренный прогон (без цифр);
 * гаснет при переходе.
 */
function TaskRow({
  task,
  unseen,
  onOpen,
}: {
  task: RecurringTask;
  unseen: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={onOpen}
        title={t.chat.openTask}
        className={cn(
          "h-7 select-none border-b border-transparent bg-clip-padding",
          "group-hover/menu-item:bg-[#e6e6e6]! dark:group-hover/menu-item:bg-[#3a3a3a]! group-hover/menu-item:text-sidebar-accent-foreground",
        )}
      >
        <Clock className="size-3! shrink-0 text-sidebar-foreground/60" />
        <span className="w-full truncate">{task.title}</span>
        {unseen && (
          <span className="size-[7px] shrink-0 rounded-full bg-primary" aria-hidden />
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SessionRow({
  thread,
  active,
  indent = false,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
}: {
  thread: ThreadInfo;
  active: boolean;
  /** Чат внутри раскрытой папки пространства — рисуется с отступом. */
  indent?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  // Открыто ли ⋮-меню — держит панель иконок видимой, пока меню открыто, и
  // прячет её сразу при закрытии (без залипания на возвращённом фокусе).
  const [menuOpen, setMenuOpen] = React.useState(false);
  // Удаление сессии — через подтверждение. Раньше корзина сносила переписку
  // мгновенно и без вопроса, а на тач-экране её вообще не было видно: тап по
  // правому краю строки удалял сессию, и вернуть её нельзя.
  const [confirmDel, setConfirmDel] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const title = thread.title || t.chat.newChat;

  const startEdit = () => {
    setDraft(thread.title || "");
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    if (next && next !== thread.title) onRename(next);
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Режим редактирования — input вместо кнопки строки. Enter — сохранить,
  // Esc — отменить, блюр — сохранить (как в файловых деревьях/переименовании).
  if (editing) {
    return (
      <SidebarMenuItem>
        <div className="flex h-8 items-center rounded-md px-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") cancel();
            }}
            onBlur={commit}
            placeholder={t.chat.renamePlaceholder}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={onSelect}
        // Компактнее дефолтных h-8 (строки ниже, плотнее). hover красит в поднятый
        // sidebar-accent (светлее фона); активная сессия — ТЕМНЕЕ фона, чтобы
        // «выбранное» уходило вглубь и отличалось от «наведённого».
        className={cn(
          // 1px-разрыв снизу, разделяющий подсветки соседних строк: ПРОЗРАЧНАЯ
          // рамка + bg-clip-padding (подсветка не подтекает под неё). Раньше
          // рамка была цвета фона (border-sidebar) — на стеклянной панели
          // непрозрачный #1b1b1b стал видимой линией на каждой строке.
          "h-7 select-none border-b border-transparent bg-clip-padding",
          indent && "pl-6",
          // Подсветка от ховера ВСЕЙ строки (группы), а не самой кнопки:
          // панель действий — absolute-оверлей, курсор над ней снимает :hover
          // с кнопки строки, и с одним hover: подсветка гасла ровно в момент,
          // когда пользователь тянется к корзине.
          //
          // Цвета СВОИ, ярче токена sidebar-accent (и с !, чтобы перебить
          // базовый hover:bg-sidebar-accent кнопки строки): просьба «не видно
          // нихуя» относилась к плашкам сессий, а не ко всему сайдбару —
          // глобальный токен ради этого не трогаем.
          "group-hover/menu-item:bg-[#e6e6e6]! dark:group-hover/menu-item:bg-[#3a3a3a]! group-hover/menu-item:text-sidebar-accent-foreground",
          // Иерархия в светлой теме: фон #f4f4f4 -> ховер #e6e6e6 -> активная
          // #d0d0d0 (в тёмной так же: #1b1b1b -> #3a3a3a -> #262626... актив
          // ТЕМНЕЕ ховера в обеих). Три требования из горького опыта: ховер
          // ВИДЕН на фоне, активная не светлее ховера, и между ними ЯВНЫЙ
          // разрыв — #d6d6d6/#d0d0d0 сливались почти в один цвет.
          active && "font-medium bg-[#d0d0d0]! dark:bg-[#262626]!",
        )}
        // Правый клик открывает то же ⋮-меню. preventDefault — подавить нативное
        // системное меню. mousedown-capture правой кнопки (ниже) глушит
        // outside-close base-ui, иначе меню сразу закрывалось (нужен был 2-й клик).
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        onPointerDownCapture={(e) => {
          // base-ui ловит outside-close по pointerdown (не mousedown). Глушим
          // pointerdown правой кнопки, иначе он же закрывает только что
          // открытое меню — приходилось кликать дважды.
          if (e.button === 2) e.stopPropagation();
        }}
      >
        {/* Иконка типа: пузырь = чат (у задач — часы, см. TaskRow). Тип строки
            в смешанном списке должен читаться без вчитывания в названия. */}
        {/* size с !: базовый [&_svg]:size-4 кнопки строки специфичнее класса
            на самой иконке — без important размер не применяется вовсе. */}
        <MessageCircle className="size-3! shrink-0 text-sidebar-foreground/60" />
        {/* Фейд заголовка ТОЛЬКО когда видны иконки действий (ховер строки
            или открытое ⋮-меню): правый край текста растворяется, и иконки
            встают в чистую зону — подложка им не нужна. В покое — обычное
            многоточие. Старт фейда за 64px до края: чуть раньше зоны иконок
            (~52px), но не с середины строки. text-clip с ! — иначе ellipsis
            из базового [&>span:last-child]:truncate кнопки строки рисовал бы
            «…» поверх фейда. */}
        <span
          className={cn(
            // w-full ОБЯЗАТЕЛЕН: без него ширина span = ширине текста, и маска
            // (проценты от ширины span) резала хвост у ЛЮБОГО заголовка, даже
            // однословного. На всю строку span — фейд живёт у правого края
            // строки и коротких заголовков не касается.
            "w-full truncate",
            // Стопы: растворение ЗАВЕРШАЕТСЯ к началу зоны кнопок (~52px от
            // края), а не под ними — иначе весь градиент прячется ПОД иконками
            // и его не видно вовсе. Видимая полоса фейда — 28px слева от
            // кнопок; под самими кнопками текста уже нет.
            "group-hover/menu-item:text-clip! group-hover/menu-item:[mask-image:linear-gradient(to_right,black_calc(100%-80px),transparent_calc(100%-52px))]",
            // Меню открыто, а курсор уже увели со строки — иконки видны,
            // значит и фейд должен остаться.
            menuOpen &&
              "text-clip! [mask-image:linear-gradient(to_right,black_calc(100%-80px),transparent_calc(100%-52px))]",
          )}
        >
          {title}
        </span>
      </SidebarMenuButton>

      {/* Иконки-действия по ховеру строки: корзина и ⋮-меню (закрепить/
          в проект/удалить). ПОДЛОЖКИ НЕТ ВООБЩЕ — итог перебора (глухая,
          градиентная вуаль, блюр, таблетка с тенью — всё отвергнуто): вместо
          прикрытия текста сам заголовок ПОСТОЯННО растворяется у правого края
          (маска на span заголовка выше), и иконки встают в зону, где текста
          уже нет. */}
      <div
        className={cn(
          // display задаётся ниже по состоянию (flex / hidden) — в базе его нет
          // намеренно, иначе `flex` перебивал бы `hidden` неактивной строки.
          "absolute top-1/2 right-1 -translate-y-[52%] items-center gap-0.5 rounded-md transition-opacity",
          // Видна по ховеру строки ИЛИ пока открыто ⋮-меню. focus-within НЕ
          // используем: после закрытия меню фокус возвращается на триггер и
          // держал бы панель залипшей до клика в другом месте.
          //
          // НА ТАЧ-ЭКРАНЕ панель есть только у ОТКРЫТОЙ сессии (и пока открыто
          // меню). Наведения там нет, а показывать иконки в каждой строке —
          // зашумлять узкий сайдбар одинаковыми кнопками, среди которых легко
          // промахнуться. На остальных строках действия достаются долгим
          // нажатием: браузер сам порождает contextmenu, а он уже открывает то
          // же меню (см. onContextMenu на строке).
          //
          // Совсем без иконки оставлять нельзя: жест невидим, и о нём просто не
          // догадаются. Видимая ⋮ на активной строке подсказывает, что действия
          // существуют, и даёт к ним доступ без всякого жеста.
          //
          // hidden, а не opacity-0: прозрачный элемент остаётся КЛИКАБЕЛЬНЫМ —
          // так тап по правому краю строки попадал в невидимую корзину и сносил
          // сессию. «Не видно» не значит «не нажмётся».
          menuOpen
            ? "flex opacity-100"
            : active
              ? "flex opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/menu-item:opacity-100"
              : "hidden opacity-0 pointer-fine:flex pointer-fine:group-hover/menu-item:opacity-100",
        )}
      >
        <button
          type="button"
          aria-label={t.chat.deleteSession}
          title={t.chat.deleteSession}
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDel(true);
          }}
          // Только для мыши. На тач-экране корзина и ⋮ стояли бы рядом в каждой
          // строке — две однотипные иконки в узком сайдбаре, и промахнуться
          // легко. Там оставляем одну ⋮, а удаление живёт пунктом в её меню.
          // rounded-md — ровно тот же радиус, что у строки: один радиус на
          // строке и кнопках в ней (выбор пользователя; концентричный
          // уменьшенный радиус отвергнут).
          className="hidden size-6 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors pointer-fine:flex hover:bg-destructive/15 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={t.chat.moreActions}
            title={t.chat.moreActions}
            // Светлая тема: свой тёмный ховер вместо bg-sidebar-border —
            // #e5e5e5 неотличим от ховера строки #e6e6e6, наведение на кнопку
            // не читалось. Тёмная: sidebar-border темнее ховера строки, ок.
            className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none transition-colors hover:bg-[#c8c8c8] hover:text-sidebar-foreground aria-expanded:bg-[#c8c8c8] aria-expanded:text-sidebar-foreground dark:hover:bg-sidebar-border dark:aria-expanded:bg-sidebar-border"
            render={<button type="button" onClick={(e) => e.stopPropagation()} />}
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="gap-2" onClick={() => startEdit()}>
              <Pencil className="size-4" />
              {t.chat.renameSession}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2"
              onClick={() => onTogglePin()}
            >
              {thread.pinned ? (
                <>
                  <PinOff className="size-4" />
                  {t.chat.unpinSession}
                </>
              ) : (
                <>
                  <Pin className="size-4" />
                  {t.chat.pinSession}
                </>
              )}
            </DropdownMenuItem>
            {/* Удаление есть и здесь: на тач-экране отдельной корзины в строке
                нет (две однотипные иконки в каждой строке зашумляют узкий
                сайдбар), и этот пункт — единственный путь к удалению. */}
            <DropdownMenuItem
              className="gap-2 text-destructive"
              onClick={() => setConfirmDel(true)}
            >
              <Trash2 className="size-4" />
              {t.chat.deleteSession}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Подтверждение удаления. Раньше корзина сносила сессию сразу: на тач-
          экране кнопка была невидимой (но кликабельной), и случайный тап по
          правому краю строки стирал переписку без единого вопроса. Восстановить
          её нельзя — на сервере remove() зовёт deleteThread безвозвратно. */}
      <Modal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title={t.chat.deleteSession}
      >
        <p className="text-sm text-muted-foreground">
          {t.chat.deleteSessionConfirm(title)}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmDel(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t.settings.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDel(false);
              onDelete();
            }}
            className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            {t.chat.deleteSession}
          </button>
        </div>
      </Modal>
    </SidebarMenuItem>
  );
}
