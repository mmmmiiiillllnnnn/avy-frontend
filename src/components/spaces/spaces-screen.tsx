"use client";

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  Bot,
  Brain,
  Check,
  Clock,
  Download,
  FileText,
  Info,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";

import { Modal } from "@/components/ui/modal";
// Единые формы (агент, навык, задача) и кнопка «Создать» — из своих разделов:
// создание из пространства идёт через тот же интерфейс, своих форм по
// разделам не плодим.
import { AgentForm, CreateButton, SkillForm } from "@/components/agents/agents-screen";
import { TaskForm } from "@/components/recurring/recurring-tasks-screen";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  attachSpaceTask,
  createSpace,
  createMySkill,
  deleteSpace,
  deleteMySkill,
  detachSpaceTask,
  fetchAgents,
  fetchMySkills,
  fetchSkillsCatalog,
  forgetMemoryFact,
  listRecurringTasks,
  listSpaceAgents,
  listSpaceFiles,
  listSpaceMemory,
  listSpaceSkills,
  listSpaceTasks,
  listSpaceThreads,
  listSpaces,
  setSpaceAgents,
  setSpaceSkills,
  spaceFileRawUrl,
  updateMySkill,
  updateSpace,
  createAgent,
  createRecurringTask,
  updateRecurringTask,
  type Agent,
  type AgentInput,
  type MemoryFact,
  type MySkill,
  type SkillInfo,
  type MySkillInput,
  uploadMySkillFiles,
  type RecurringTask,
  type SessionFile,
  type Space,
  type SpaceSkill,
  type SpaceTask,
  type ThreadInfo,
} from "@/lib/api";
import { useT } from "@/i18n/i18n-context";

/** Клиентский id треда — тот же формат, что у обычных чатов (use-threads). */
function newThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FIELD =
  "w-full rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-primary/5";

// ── Подсказка под «i» ───────────────────────────────────────────────────────
//
// Пояснения не висят текстом под каждым заголовком: их читают один раз, а
// место и внимание занимают всегда. Разметка ТА ЖЕ, что у FieldLabel в разделе
// агентов (Tooltip из UI-кита + Info): одинаковые по смыслу вещи должны
// выглядеть и вести себя одинаково во всём приложении.

function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/60 transition hover:bg-muted hover:text-foreground">
            <Info size={13} />
          </span>
        }
      />
      <TooltipContent side="top" className="max-w-[280px] whitespace-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Инлайн-правка текста ────────────────────────────────────────────────────
//
// Название и описание правятся ПРЯМО НА МЕСТЕ по клику: заводить ради двух
// строк отдельную форму — лишний экран между намерением и результатом.

function InlineEdit({
  value,
  placeholder,
  multiline = false,
  rows = 2,
  maxLength,
  className,
  inputClassName,
  onSave,
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  className?: string;
  inputClassName?: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next !== value) onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        title={placeholder}
        className={cn(
          "-mx-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-foreground/5",
          !value && "text-muted-foreground",
          // Многострочная подсказка (пример правил пространства) должна
          // показываться как есть: без этого её переносы схлопывались в строку.
          multiline && "whitespace-pre-wrap",
          className,
        )}
      >
        {value || placeholder}
      </button>
    );
  }

  const shared = {
    value: draft,
    autoFocus: true,
    placeholder,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(e.target.value),
    onBlur: commit,
    className: cn(FIELD, inputClassName),
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={rows}
        maxLength={maxLength ?? 500}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <input
      {...shared}
      maxLength={maxLength ?? 80}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

// ── Подключение из библиотеки: ОКНО с поиском и карточками ──────────────────
//
// РОВНО тот же паттерн, что выбор навыков в форме агента («Мои агенты»):
// строка поиска сверху, ниже сетка карточек «имя + описание», клик
// переключает выбор (рамка primary + галка). Ничего нового не выдумываем.

function LibraryPickerModal({
  title,
  items,
  checkedIds,
  onToggle,
  onClose,
  emptyText,
}: {
  title: string;
  items: { id: string; name: string; description?: string }[];
  checkedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
  emptyText: string;
}) {
  const t = useT();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((i) =>
        `${i.name} ${i.description ?? ""}`.toLowerCase().includes(q),
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
                          "flex h-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                          on
                            ? "border-primary bg-primary/5"
                            : "border-border/60 hover:bg-accent",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {item.name}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block h-8 text-xs leading-snug text-muted-foreground">
                            {item.description}
                          </span>
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


// ── Конфигурация пространства (вкладка «Настройки» главной страницы) ────────
//
// Всё, что НАСТРАИВАЕТСЯ: инструкции, агенты, навыки, регулярные задачи.
// Производимое (сессии, файлы, память) — соседняя вкладка «Обзор»; архив и
// удаление — кнопки в шапке страницы. Создание всего — ЕДИНЫМИ формами
// соответствующих разделов (AgentForm / SkillForm / TaskForm).

function SpaceConfig({
  space,
  agents,
  teamIds,
  onToggleAgent,
  onAgentCreated,
  spaceTasks,
  allTasks,
  onAttachTask,
  onDetachTask,
  onTasksChanged,
  onRename,
  onOpenThread,
}: {
  space: Space;
  agents: Agent[] | null;
  teamIds: string[];
  onToggleAgent: (agentId: string) => void;
  /** Агент, созданный отсюда, — родитель кладёт его в список и в команду. */
  onAgentCreated: (agent: Agent) => void;
  spaceTasks: SpaceTask[] | null;
  allTasks: RecurringTask[];
  onAttachTask: (taskId: string) => Promise<void>;
  onDetachTask: (taskId: string) => Promise<void>;
  /** Перечитать списки задач (после создания из формы). */
  onTasksChanged: () => void;
  onRename: (input: { instruction?: string }) => void;
  onOpenThread: (threadId: string, spaceId: string, opener?: string) => void;
}) {
  const t = useT();
  const sp = t.spaces;

  // Вкладки конфигурации: агенты, навыки, регулярные задачи.
  const [catalogTab, setCatalogTab] = React.useState<"agents" | "skills" | "tasks">(
    "agents",
  );
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Личная библиотека навыков — для окна подключения.
  const [mySkills, setMySkills] = React.useState<MySkill[]>([]);
  // Коробочные навыки поставки — только для ВЫБОРА в пикере. Править и удалять
  // их нельзя, поэтому отдельно от mySkills, а не одним списком.
  const [builtinSkills, setBuiltinSkills] = React.useState<SkillInfo[]>([]);
  const [skills, setSkills] = React.useState<SpaceSkill[] | null>(null);
  const [linked, setLinked] = React.useState<string[]>([]);
  // Открытая форма навыка: "new" — создание, MySkill — правка (полный, с
  // телом). Форма единая — SkillForm из «Моих агентов».
  const [editing, setEditing] = React.useState<MySkill | "new" | null>(null);
  const [skillBusy, setSkillBusy] = React.useState(false);
  const [skillError, setSkillError] = React.useState<string | null>(null);
  const [agentFormOpen, setAgentFormOpen] = React.useState(false);
  const [agentBusy, setAgentBusy] = React.useState(false);
  // Задача: единая форма (TaskForm из раздела задач) + черновик, как там же.
  const [taskFormOpen, setTaskFormOpen] = React.useState(false);
  const [taskDraftId, setTaskDraftId] = React.useState<string | null>(null);
  const [taskSubmitting, setTaskSubmitting] = React.useState(false);

  const reloadSkills = React.useCallback(() => {
    void listSpaceSkills(space.id).then((r) => {
      setSkills(r.skills);
      setLinked(r.linked);
    });
  }, [space.id]);

  React.useEffect(() => {
    let cancelled = false;
    void listSpaceSkills(space.id).then((r) => {
      if (cancelled) return;
      setSkills(r.skills);
      setLinked(r.linked);
    });
    void fetchMySkills().then((list) => {
      if (!cancelled) setMySkills(list);
    });
    // Коробочные — отдельным запросом, а не вместо личных: `mySkills` нужен
    // как есть для правки навыка (openSkillEdit ищет в нём по id), а коробочные
    // править нельзя — они едут с поставкой. В выборе же нужны и те и другие:
    // подключить к пространству можно любой навык из библиотеки, ровно как в
    // форме агента. Раньше список брался только из fetchMySkills, и docx/pptx
    // выбрать было нельзя — при том, что PUT их принимает.
    void fetchSkillsCatalog().then((list) => {
      if (!cancelled) setBuiltinSkills(list);
    });
    return () => {
      cancelled = true;
    };
  }, [space.id]);

  // Что можно подключить к пространству: ВСЯ библиотека — коробочные и личные,
  // тем же правилом, что в форме агента. Своих в пикере не показываем дважды:
  // навык, написанный в этом пространстве, уже его и подключать его незачем
  // (он приходит из listSpaceSkills со флагом own).
  const attachableSkills = React.useMemo(
    () => [
      ...builtinSkills.map((s) => ({
        id: s.name,
        name: s.name,
        description: s.description,
      })),
      ...mySkills.map((sk) => ({
        id: sk.slug,
        name: sk.name,
        description: sk.description,
      })),
    ],
    [builtinSkills, mySkills],
  );

  const toggleLinkedSkill = (slug: string) => {
    const next = linked.includes(slug)
      ? linked.filter((x) => x !== slug)
      : [...linked, slug];
    setLinked(next);
    void setSpaceSkills(space.id, next).then(reloadSkills);
  };

  const openSkillEdit = async (sk: SpaceSkill) => {
    // Тело в списке пространства не приходит — дочитываем полный навык.
    const full = (await fetchMySkills()).find((x) => x.id === sk.id);
    if (full) setEditing(full);
  };

  const submitSkill = async (input: MySkillInput, files: File[]) => {
    setSkillBusy(true);
    setSkillError(null);
    const res =
      editing === "new" || editing === null
        ? await createMySkill({ ...input, space_id: space.id })
        : await updateMySkill(editing.id, input);
    if (res.error) {
      setSkillBusy(false);
      setSkillError(res.error);
      return;
    }
    if (editing === "new" && files.length > 0 && res.skill) {
      await uploadMySkillFiles(res.skill.id, files);
    }
    setSkillBusy(false);
    reloadSkills();
    setEditing(null);
  };

  const submitAgent = async (body: AgentInput) => {
    setAgentBusy(true);
    const created = await createAgent(body);
    setAgentBusy(false);
    if (!created) return;
    // Созданный ИЗ ПРОСТРАНСТВА агент сразу в его команде — за этим сюда и
    // приходили; в библиотеке он тоже появится, как любой свой агент.
    onAgentCreated(created);
    setAgentFormOpen(false);
  };

  // Создание С АССИСТЕНТОМ — чат ЭТОГО пространства с заготовкой первого
  // сообщения: помощник получает SpaceMiddleware и видит, где находится.
  //
  // Тред ЗДЕСЬ НЕ СОЗДАЁМ. Правило одно на все входы: пока хода нет — нет и
  // сессии. Иначе каждое открытие «Нового чата» плодило бы пустую строку в
  // списке, даже если человек сразу передумал. Привязку к пространству делает
  // воркспейс при первой отправке (см. sendBindingSpace).
  const askAssistant = (opener: string) => {
    onOpenThread(newThreadId(), space.id, opener);
  };

  // ── Задачи ──
  const attachedTaskIds = (spaceTasks ?? []).map((task) => task.id);
  // Свободные для подключения: не черновики и не прикреплённые к другому
  // пространству.
  const freeTasks = allTasks.filter(
    (task) => !task.draft && (!task.space_id || task.space_id === space.id),
  );

  const openTaskCreate = async () => {
    setTaskFormOpen(true);
    setTaskDraftId(null);
    try {
      // Черновик — как в разделе задач: id нужен API секретов и вложений.
      const draft = await createRecurringTask({
        title: "",
        schedule: "",
        instruction: "",
        draft: true,
      });
      // Сразу привязываем к пространству: прогоны пойдут на его облаке.
      await attachSpaceTask(space.id, draft.id);
      setTaskDraftId(draft.id);
    } catch {
      /* без черновика форма всё равно работает — просто без секретов/файлов */
    }
  };

  const submitTask = async (input: {
    title: string;
    instruction: string;
    schedule: string;
    timezone: string;
    error_policy: Record<string, unknown>;
  }) => {
    setTaskSubmitting(true);
    try {
      if (taskDraftId) {
        await updateRecurringTask(taskDraftId, {
          ...input,
          draft: false,
          enabled: true,
        });
      } else {
        // Черновик не создался (сеть) — обычное создание + привязка.
        const created = await createRecurringTask(input);
        await onAttachTask(created.id);
      }
      onTasksChanged();
      setTaskFormOpen(false);
      setTaskDraftId(null);
    } catch {
      /* ошибка сохранения — форма остаётся открытой */
    } finally {
      setTaskSubmitting(false);
    }
  };

  // Форма задачи — отдельный вид на весь экран, как в разделе задач.
  if (taskFormOpen) {
    return (
      <TaskForm
        taskId={taskDraftId ?? undefined}
        submitting={taskSubmitting}
        onCancel={() => {
          setTaskFormOpen(false);
          setTaskDraftId(null);
          onTasksChanged();
        }}
        onSubmit={submitTask}
      />
    );
  }

  const team = (agents ?? []).filter((a) => teamIds.includes(a.id));
  const attachedTasks = spaceTasks ?? [];

  return (
    <div className="flex w-full flex-col gap-6">
        {/* ── Правила: одно поле, всегда в промпте. Правятся по клику. ── */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-medium">{sp.instructionLabel}</h2>
            <Hint text={sp.instructionHint} />
          </div>
          <InlineEdit
            value={space.instruction}
            placeholder={sp.instructionPlaceholder}
            multiline
            // 10 строк — под многострочный пример в плейсхолдере: он показывает,
            // как выглядит настоящая рамка правил, и на шести строках обрывался
            // бы на середине.
            rows={10}
            maxLength={8000}
            className="rounded-lg border border-dashed px-3 py-2.5 text-sm whitespace-pre-wrap"
            onSave={(instruction) => onRename({ instruction })}
          />
        </section>

        {/* ── Каталог: агенты, навыки, задачи — вкладками, как в «Моих
            агентах». Показывается только привязанное/созданное ЗДЕСЬ. ── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <div className="inline-flex w-fit shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5">
                {([
                  ["agents", sp.tabAgents],
                  ["skills", sp.tabSkills],
                  ["tasks", sp.settingsTasks],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCatalogTab(key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm transition-colors",
                      catalogTab === key
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Hint
                text={
                  catalogTab === "agents"
                    ? sp.settingsAgentsHint
                    : catalogTab === "skills"
                      ? sp.skillsHint
                      : sp.settingsTasksHint
                }
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Подключение уже существующего из библиотеки. */}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                {sp.attachFromLibrary}
              </button>
              {/* Создание — ЕДИНЫМИ путями соответствующих разделов. У задач
                  ассистентного пути в их разделе нет — обычная кнопка. */}
              {catalogTab === "tasks" ? (
                <button
                  type="button"
                  onClick={() => void openTaskCreate()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Plus className="size-4" />
                  {t.recurringTasks.create}
                </button>
              ) : (
                <CreateButton
                  label={
                    catalogTab === "agents" ? t.agents.create : t.agents.createSkill
                  }
                  manual={{
                    label: t.agents.createManual,
                    hint: t.agents.createManualHint,
                  }}
                  assisted={{
                    label: t.agents.createWithAssistant,
                    hint: t.agents.createWithAssistantHint,
                  }}
                  onManual={() =>
                    catalogTab === "agents"
                      ? setAgentFormOpen(true)
                      : setEditing("new")
                  }
                  onAssisted={() =>
                    void askAssistant(
                      catalogTab === "agents"
                        ? t.agents.assistantOpener
                        : t.agents.skillAssistantOpener,
                    )
                  }
                />
              )}
            </div>
          </div>

          {catalogTab === "agents" ? (
            team.length === 0 ? (
              <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                {sp.emptyTeam}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {team.map((agent) => (
                  <div
                    key={agent.id}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Bot className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{agent.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {agent.description || "—"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleAgent(agent.id)}
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                    >
                      {sp.detach}
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : catalogTab === "skills" ? (
            skills === null ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t.files.loading}
              </div>
            ) : skills.length === 0 ? (
              <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                {sp.emptySkills}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {skills.map((sk) => (
                  <div
                    key={sk.id}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent"
                  >
                    <Wrench className="size-4 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      // Править можно только СВОИ навыки пространства: у
                      // подключённого из библиотеки владелец — сам
                      // пользователь, и правка отсюда меняла бы его везде.
                      onClick={() => sk.own && void openSkillEdit(sk)}
                      disabled={!sk.own}
                      className="flex min-w-0 flex-1 flex-col text-left disabled:cursor-default"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{sk.name}</span>
                        {!sk.own && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {sp.skillFromLibrary}
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {sk.description || sp.skillNoDescription}
                      </span>
                    </button>
                    {sk.own ? (
                      // Свой навык удаляется из списка: в единой форме кнопки
                      // удаления нет — как в «Моих агентах».
                      <button
                        type="button"
                        onClick={() => {
                          void deleteMySkill(sk.id).then(reloadSkills);
                        }}
                        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                      >
                        {sp.delete}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleLinkedSkill(sk.slug)}
                        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                      >
                        {sp.detach}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : spaceTasks === null ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t.files.loading}
            </div>
          ) : attachedTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              {sp.emptySpaceTasks}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {attachedTasks.map((task) => (
                <div
                  key={task.id}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent"
                >
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                  <button
                    type="button"
                    onClick={() => void onDetachTask(task.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                  >
                    {sp.detach}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ЕДИНАЯ форма агента — AgentForm из «Моих агентов». */}
          {agentFormOpen && (
            <AgentForm
              agent={null}
              busy={agentBusy}
              onSubmit={(body) => void submitAgent(body)}
              onCancel={() => setAgentFormOpen(false)}
            />
          )}

          {/* ЕДИНАЯ форма навыка — SkillForm из «Моих агентов». Создание из
              пространства отличается только space_id в запросе. */}
          {editing !== null && (
            <SkillForm
              skill={editing === "new" ? null : editing}
              busy={skillBusy}
              error={skillError}
              onSubmit={(input, files) => void submitSkill(input, files)}
              onCancel={() => {
                setEditing(null);
                setSkillError(null);
              }}
            />
          )}

          {/* Окно «Добавить»: поиск + карточки, как выбор навыков в форме
              агента. Отметил — подключилось сразу. */}
          {pickerOpen &&
            (catalogTab === "agents" ? (
              <LibraryPickerModal
                title={sp.attachFromLibrary}
                items={agents ?? []}
                checkedIds={teamIds}
                onToggle={onToggleAgent}
                onClose={() => setPickerOpen(false)}
                emptyText={sp.emptySpaceAgents}
              />
            ) : catalogTab === "skills" ? (
              <LibraryPickerModal
                title={sp.attachFromLibrary}
                items={attachableSkills}
                checkedIds={linked}
                onToggle={toggleLinkedSkill}
                onClose={() => setPickerOpen(false)}
                emptyText={sp.emptyAttachableSkills}
              />
            ) : (
              <LibraryPickerModal
                title={sp.attachFromLibrary}
                items={freeTasks.map((task) => ({
                  id: task.id,
                  name: task.title,
                  description: task.instruction,
                }))}
                checkedIds={attachedTaskIds}
                onToggle={(id) => {
                  void (attachedTaskIds.includes(id)
                    ? onDetachTask(id)
                    : onAttachTask(id));
                }}
                onClose={() => setPickerOpen(false)}
                emptyText={sp.emptyAttachable}
              />
            ))}
        </section>

    </div>
  );
}

// ── Главный экран пространства ──────────────────────────────────────────────
//
// ОДНА страница, две вкладки: «Обзор» — то, что пространство ПРОИЗВОДИТ
// (сессии, файлы, память), «Настройки» — то, что настраивается (инструкции,
// агенты, навыки, задачи). Архив и удаление — кнопками в шапке, отдельного
// экрана настроек нет: конфигурация в быстром доступе.

function SpaceDetail({
  initialTab,
  space,
  threads,
  agents,
  teamIds,
  onToggleAgent,
  onAgentCreated,
  spaceTasks,
  allTasks,
  onAttachTask,
  onDetachTask,
  onTasksChanged,
  onArchiveToggle,
  onDelete,
  onRename,
  onOpenThread,
}: {
  space: Space;
  threads: ThreadInfo[] | null;
  agents: Agent[] | null;
  teamIds: string[];
  onToggleAgent: (agentId: string) => void;
  onAgentCreated: (agent: Agent) => void;
  spaceTasks: SpaceTask[] | null;
  allTasks: RecurringTask[];
  onAttachTask: (taskId: string) => Promise<void>;
  onDetachTask: (taskId: string) => Promise<void>;
  onTasksChanged: () => void;
  onArchiveToggle: () => void;
  onDelete: () => Promise<void>;
  onRename: (input: {
    name?: string;
    description?: string;
    instruction?: string;
  }) => void;
  /** threadId + пространство: воркспейсу нужно знать, в чью папку класть чат.
   *  opener — заготовка первого сообщения; agentId — преднастроить «Режим»
   *  на агента команды (быстрый запуск из дропдауна «Новый чат»). */
  onOpenThread: (
    threadId: string,
    spaceId: string,
    opener?: string,
    agentId?: string,
  ) => void;
  /** С какой вкладки открыть. Нужен для только что созданного пространства. */
  initialTab?: "overview" | "config";
}) {
  const t = useT();
  const sp = t.spaces;
  // Верхний уровень: обзор (производимое) / настройки (конфигурация).
  // Только что созданное пространство открывается СРАЗУ на настройках: в нём
  // ещё нечего обозревать, а человек пришёл его собирать.
  const [topTab, setTopTab] = React.useState<"overview" | "config">(
    initialTab ?? "overview",
  );
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [files, setFiles] = React.useState<SessionFile[] | null>(null);
  const [facts, setFacts] = React.useState<MemoryFact[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void listSpaceFiles(space.id).then((list) => {
      if (!cancelled) setFiles(list);
    });
    void listSpaceMemory(space.id).then((list) => {
      if (!cancelled) setFacts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [space.id]);

  // Новый чат В ПРОСТРАНСТВЕ. Тред не создаём — только открываем пустой с
  // меткой пространства: сессия появится с первым ходом, как и везде.
  // agentId — выбранный в дропдауне агент команды: чат откроется с ним в
  // «Режиме».
  const newChat = (agentId?: string) => {
    onOpenThread(newThreadId(), space.id, undefined, agentId);
  };

  const forget = async (factId: string) => {
    setFacts((prev) => prev?.filter((f) => f.id !== factId) ?? prev);
    const ok = await forgetMemoryFact(factId);
    if (!ok) void listSpaceMemory(space.id).then(setFacts);
  };

  const team = (agents ?? []).filter((a) => teamIds.includes(a.id));

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full flex-col gap-6 p-6">
        {/* Шапка: имя и описание правятся ПРЯМО ЗДЕСЬ по клику. Справа —
            архив, удаление и «Новый чат» с выбором агента. */}
        <div className="flex items-start justify-between gap-3">
          {/* flex-1 — колонке нужна вся свободная ширина: без неё поле описания
              сжималось до ширины заголовка, и подсказка в нём обрезалась. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <InlineEdit
                value={space.name}
                placeholder={sp.namePlaceholder}
                className="truncate text-xl font-semibold"
                inputClassName="text-xl font-semibold"
                onSave={(name) => name && onRename({ name })}
              />
              {space.archived && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {sp.archivedBadge}
                </span>
              )}
            </div>
            <InlineEdit
              value={space.description}
              placeholder={sp.descriptionPlaceholder}
              multiline
              // rows=3 под трёхстрочную подсказку: при двух она обрезалась на
              // полуслове. max-w — чтобы строка описания не растягивалась на
              // весь широкий экран и оставалась читаемой.
              rows={3}
              className="max-w-prose text-sm text-muted-foreground"
              inputClassName="max-w-prose"
              onSave={(description) => onRename({ description })}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onArchiveToggle}
              title={space.archived ? sp.unarchive : sp.archive}
              className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              {space.archived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              title={sp.delete}
              className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
            {/* «Новый чат» с дропдауном: по умолчанию (универсальный) или с
                агентом команды — быстрый запуск без похода в «Режим». */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  />
                }
              >
                <Plus className="size-4" />
                {sp.newChat}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="gap-2" onClick={() => void newChat()}>
                  <MessageCircle className="size-4" />
                  {sp.newChatDefault}
                </DropdownMenuItem>
                {team.map((agent) => (
                  <DropdownMenuItem
                    key={agent.id}
                    className="gap-2"
                    onClick={() => void newChat(agent.id)}
                  >
                    <Bot className="size-4 text-primary" />
                    <span className="truncate">{agent.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Верхние вкладки: производимое / настраиваемое. */}
        <div className="inline-flex w-fit shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {([
            ["overview", sp.tabOverview],
            ["config", sp.tabSettings],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTopTab(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                topTab === key
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {topTab === "config" ? (
          <SpaceConfig
            space={space}
            agents={agents}
            teamIds={teamIds}
            onToggleAgent={onToggleAgent}
            onAgentCreated={onAgentCreated}
            spaceTasks={spaceTasks}
            allTasks={allTasks}
            onAttachTask={onAttachTask}
            onDetachTask={onDetachTask}
            onTasksChanged={onTasksChanged}
            onRename={onRename}
            onOpenThread={onOpenThread}
          />
        ) : (
          /* ── Обзор: всё, что пространство производит, НА ОДНОЙ СТРАНИЦЕ.
             Две колонки: сессии — главное, им ширина; файлы и память —
             узкой колонкой справа, друг под другом. На узком экране
             колонки схлопываются в одну. ── */
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* Сессии */}
            <section className="flex min-w-0 flex-col gap-2">
              <div className="flex items-baseline gap-2 border-b pb-2">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {sp.settingsChats}
                </h2>
                {threads !== null && threads.length > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground/60">
                    {threads.length}
                  </span>
                )}
              </div>
              {threads === null ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t.files.loading}
                </div>
              ) : threads.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                  {sp.emptyChats}
                </div>
              ) : (
                <div className="flex flex-col">
                  {threads.map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => onOpenThread(thread.id, space.id)}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
                    >
                      <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {thread.title || t.chat.newChat}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {new Date(thread.updated_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Правая колонка: файлы над памятью — оба списка короткие. */}
            <div className="flex min-w-0 flex-col gap-8">
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2 border-b pb-2">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {sp.tabFiles}
                  </h2>
                  {files !== null && files.length > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground/60">
                      {files.length}
                    </span>
                  )}
                </div>
                {files === null ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t.files.loading}
                  </div>
                ) : files.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                    {sp.emptyFiles}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {files.map((file) => (
                      <a
                        key={file.path}
                        href={spaceFileRawUrl(space.id, file.path)}
                        download={file.name}
                        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {file.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {fmtSize(file.size)}
                        </span>
                        <Download className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                    ))}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2 border-b pb-2">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {sp.tabMemory}
                  </h2>
                  {facts !== null && facts.length > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground/60">
                      {facts.length}
                    </span>
                  )}
                </div>
                {facts === null ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t.files.loading}
                  </div>
                ) : facts.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                    {sp.emptyMemory}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {facts.map((fact) => (
                      <div
                        key={fact.id}
                        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent"
                      >
                        <Brain className="size-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm">{fact.description}</span>
                          {fact.expires_at && (
                            <span className="truncate text-[11px] text-muted-foreground/70">
                              {t.settings.memoryExpires(
                                new Date(fact.expires_at).toLocaleDateString(),
                              )}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void forget(fact.id)}
                          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                        >
                          {sp.forgetFact}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      {/* Подтверждение удаления: общие файлы пропадут безвозвратно. */}
      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} title={sp.delete}>
        <p className="text-sm text-muted-foreground">{sp.deleteConfirm(space.name)}</p>
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
              void onDelete();
            }}
            className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            {sp.delete}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Раздел целиком: список ⇄ пространство ⇄ настройки ───────────────────────

/**
 * Полноэкранный раздел «Пространства» — тело области чата (хедер остаётся).
 *
 * Виды: список → пространство (инструкции-файлы, команда, файлы, память) →
 * настройки / редактор файла инструкций. Чат открывается как обычная активная
 * сессия через onOpenThread — воркспейс закрывает раздел и переключает тред.
 */
export function SpacesScreen({
  onOpenThread,
  onAskAssistant,
  initialSpaceId,
  onConsumedInitial,
  onBackChange,
}: {
  onOpenThread: (
    threadId: string,
    spaceId?: string,
    opener?: string,
    agentId?: string,
  ) => void;
  /** Открыть новый чат с заготовленным первым сообщением («создать с
   *  ассистентом»). Тот же канал, что у агентов и навыков. */
  onAskAssistant?: (opener: string) => void;
  initialSpaceId?: string | null;
  onConsumedInitial?: () => void;
  onBackChange?: (back: (() => void) | null) => void;
}) {
  const t = useT();
  const sp = t.spaces;
  const [spaces, setSpaces] = React.useState<Space[] | null>(null);
  const [tab, setTab] = React.useState<"active" | "archive">("active");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // id только что созданного пространства: по нему экран открывается сразу на
  // вкладке настроек. Прежняя модалка «имя + описание» убрана — она спрашивала
  // два поля и всё равно вела сюда же, только лишним шагом.
  const [justCreatedId, setJustCreatedId] = React.useState<string | null>(null);

  // Данные для экрана настроек (живут здесь: настройки и главный экран их делят).
  const [threads, setThreads] = React.useState<ThreadInfo[] | null>(null);
  const [agents, setAgents] = React.useState<Agent[] | null>(null);
  const [teamIds, setTeamIds] = React.useState<string[]>([]);
  const [spaceTasks, setSpaceTasks] = React.useState<SpaceTask[] | null>(null);
  const [allTasks, setAllTasks] = React.useState<RecurringTask[]>([]);

  const refresh = React.useCallback(async () => {
    const list = await listSpaces(true);
    setSpaces(list);
  }, []);

  /** «Вручную»: завести пустое пространство и открыть его настройки. Имя
   *  переименовывается на месте, поэтому спрашивать его формой незачем. */
  const createBlank = React.useCallback(async () => {
    const created = await createSpace({
      name: sp.createDefaultName,
      description: "",
    });
    await refresh();
    window.dispatchEvent(new Event("avy:spaces-changed"));
    setJustCreatedId(created.id);
    setSelectedId(created.id);
  }, [refresh, sp.createDefaultName]);

  React.useEffect(() => {
    void listSpaces(true).then(setSpaces);
  }, []);

  // Данные пространства: чаты, агенты, задачи (для настроек).
  React.useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void listSpaceThreads(selectedId).then((list) => {
      if (!cancelled) setThreads(list);
    });
    void listSpaceAgents(selectedId).then((ids) => {
      if (!cancelled) setTeamIds(ids);
    });
    void listSpaceTasks(selectedId).then((list) => {
      if (!cancelled) setSpaceTasks(list);
    });
    void listRecurringTasks().then((list) => {
      if (!cancelled) setAllTasks(list);
    });
    void fetchAgents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Deep-link из сайдбара и «назад» для хедера — через setTimeout(0): оба
  // зовут setState (свой или родительский) из эффекта, синхронно это
  // каскадные рендеры и ошибка линта; нулевая задержка развязывает.
  React.useEffect(() => {
    if (!initialSpaceId) return;
    const timer = setTimeout(() => {
      setSelectedId(initialSpaceId);
      onConsumedInitial?.();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSpaceId]);

  // «Назад» в хедере: пространство → список; список — назад нечего (null).
  React.useEffect(() => {
    const back = selectedId ? () => setSelectedId(null) : null;
    const timer = setTimeout(() => onBackChange?.(back), 0);
    return () => {
      clearTimeout(timer);
      setTimeout(() => onBackChange?.(null), 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selected = spaces?.find((s) => s.id === selectedId) ?? null;

  const refreshTasks = React.useCallback(() => {
    if (!selectedId) return;
    void listSpaceTasks(selectedId).then(setSpaceTasks);
    void listRecurringTasks().then(setAllTasks);
  }, [selectedId]);

  if (selected) {
    return (
      <SpaceDetail
        initialTab={selected.id === justCreatedId ? "config" : "overview"}
        space={selected}
        threads={threads}
        agents={agents}
        teamIds={teamIds}
        onToggleAgent={(agentId) => {
          const next = teamIds.includes(agentId)
            ? teamIds.filter((id) => id !== agentId)
            : [...teamIds, agentId];
          setTeamIds(next);
          void setSpaceAgents(selected.id, next);
        }}
        onAgentCreated={(agent) => {
          setAgents((prev) => [...(prev ?? []), agent]);
          const next = [...teamIds, agent.id];
          setTeamIds(next);
          void setSpaceAgents(selected.id, next);
        }}
        spaceTasks={spaceTasks}
        allTasks={allTasks}
        onAttachTask={async (taskId) => {
          await attachSpaceTask(selected.id, taskId);
          refreshTasks();
        }}
        onDetachTask={async (taskId) => {
          await detachSpaceTask(selected.id, taskId);
          refreshTasks();
        }}
        onTasksChanged={refreshTasks}
        onArchiveToggle={() => {
          void updateSpace(selected.id, { archived: !selected.archived }).then(
            () => {
              void refresh();
              // Папка архивного в сессиях не рисуется — сайдбару тоже надо знать.
              window.dispatchEvent(new Event("avy:spaces-changed"));
            },
          );
        }}
        onDelete={async () => {
          await deleteSpace(selected.id);
          setSelectedId(null);
          void refresh();
          // Сайдбар держит свою копию списка и обновляет её раз в минуту —
          // без этого папка удалённого пространства висела бы там до тика.
          window.dispatchEvent(new Event("avy:spaces-changed"));
        }}
        onRename={(input) => {
          // Оптимистично: имя в шапке меняется сразу, сервер догоняет.
          setSpaces(
            (prev) =>
              prev?.map((s) => (s.id === selected.id ? { ...s, ...input } : s)) ??
              prev,
          );
          void updateSpace(selected.id, input).then(refresh);
        }}
        onOpenThread={onOpenThread}
      />
    );
  }

  const visible = (spaces ?? []).filter((s) =>
    tab === "active" ? !s.archived : s.archived,
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {([
              ["active", t.recurringTasks.tabActive],
              ["archive", t.recurringTasks.tabArchive],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  tab === key
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Та же развилка, что у агентов и навыков, и тем же компонентом:
              форма требует заранее знать, каким будет пространство, а разговор
              это вырабатывает — ассистент заодно соберёт ему команду, навыки и
              регулярные задачи, чего форма не умеет. */}
          <div className="ml-auto shrink-0">
            <CreateButton
              label={sp.create}
              manual={{ label: sp.createManual, hint: sp.createManualHint }}
              assisted={{
                label: sp.createWithAssistant,
                hint: sp.createWithAssistantHint,
              }}
              onManual={() => void createBlank()}
              onAssisted={() => onAskAssistant?.(sp.assistantOpener)}
            />
          </div>
        </div>

        {spaces === null ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t.files.loading}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            {sp.empty}
          </div>
        ) : (
          /* Карточки, а не строки: пространств немного, зато у каждого есть
             описание — в сетке оно читается, в строке обрезалось бы. */
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {visible.map((space) => (
              <button
                key={space.id}
                type="button"
                onClick={() => setSelectedId(space.id)}
                // h-28 — ФИКСИРОВАННАЯ высота: без неё карточка без описания
                // выходила ниже соседней с тремя строками, и сетка шла рвано.
                className="group flex h-28 flex-col gap-1.5 overflow-hidden rounded-xl border bg-background/40 p-4 text-left transition-colors hover:border-foreground/30 hover:bg-sidebar-accent"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{space.name}</span>
                    {space.archived && (
                      <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {sp.archivedBadge}
                      </span>
                    )}
                  </span>
                  {/* Описание в карточке не режем одной строкой: место есть, а
                      по нему человек и отличает пространства друг от друга. */}
                  {space.description && (
                    <span className="line-clamp-3 text-xs text-muted-foreground">
                      {space.description}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>


    </div>
  );
}
