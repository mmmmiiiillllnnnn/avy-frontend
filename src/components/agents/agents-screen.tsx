"use client";

/**
 * Раздел «Мои агенты»: библиотека и редактор.
 *
 * Агент — это КТО работает: имя, чем занимается, инструкция, модель. Здесь он
 * заводится руками; второй путь — попросить ассистента в разговоре (тула
 * manage_agent), и тогда агент приходит сюда выключенным, ждать проверки.
 *
 * Коробочные показываем вместе с пользовательскими, но только для чтения: у
 * них нет ни правки, ни удаления, ни тумблера. Копировать их тоже нельзя —
 * копия разошлась бы с оригиналом, человек сломал бы её и пришёл с жалобой на
 * продукт. Прячь мы их отсюда — было бы непонятно, откуда в выборе агента
 * берётся «Исследователь».
 *
 * Навыки (вкладка «Навыки») устроены так же, но отвечают на другой вопрос: не
 * КТО работает, а КАК делается работа. Свой навык правится здесь же формой,
 * либо его пишет ассистент в разговоре (навык skill-creator). Навык не
 * выбирают над полем ввода — он применяется сам, когда задача подходит под его
 * описание, поэтому тумблер у него значит «использовать», а не «показывать».
 */

import * as React from "react";
import { ArrowUpDown, Bot, Check, ChevronDown, FileCode2, FileText, Folder, FolderOpen, Info, Loader2, Pencil, Plus, Search, SlidersHorizontal, Trash2, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentConnectionsButton } from "@/components/agents/agent-connections";
import { ConnectorLogo, ConnectorsPanel } from "@/components/agents/connectors-panel";
import { useConnectorItems, useConnectorList } from "@/components/agents/connector-items";
import { ConnectorRulesDialog } from "@/components/agents/connector-rules-dialog";
import { SkillIcon } from "@/components/ui/skill-icon";
import { connectionForms } from "@/lib/connection-card";
import { invalidateAgents } from "@/hooks/use-agents";
import { MessageResponse } from "@/components/ai-elements/message";
import { useLocale, useT } from "@/i18n/i18n-context";
import { useAgentLibrary } from "@/hooks/use-agents";
import {
  createMySkill,
  deleteMySkill,
  deleteMySkillFile,
  connectorSummary,
  fetchConnectors,
  fetchMiddleware,
  fetchMySkillFile,
  fetchMySkillFiles,
  fetchMySkills,
  fetchSkillDetail,
  fetchSkillFile,
  fetchSkillsCatalog,
  patchBuiltinSkill,
  fetchToolsets,
  forkBuiltinSkill,
  updateMySkill,
  uploadMySkillFiles,
  type Agent,
  type AgentInput,
  type ConnectorInfo,
  type MySkill,
  type MySkillInput,
  type SkillDetail,
  type SkillInfo,
  type ConnectorRules,
} from "@/lib/api";
import {
  EFFORT_LABELS,
  EFFORT_ORDER,
  type EffortLevel,
} from "@/components/ui/ai-chat-input";
import { useModels } from "@/hooks/use-models";

const FIELD =
  "w-full rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-primary/5";
const LABEL = "text-xs font-medium text-muted-foreground";

// Что подставить, когда у агента глубина не задана: то же значение, с которого
// начинается обычный разговор (chat-workspace.tsx). Модель по умолчанию — с
// бэкенда (useModels), как и в чате: прошитого списка моделей больше нет.
const DEFAULT_AGENT_EFFORT = "medium";

/** Порядок списка. «Новые» осмысленны для агентов и СВОИХ навыков (у обоих есть
 *  дата создания); у коробочных навыков даты нет, они держат порядок имён. */
type SortMode = "name" | "recent";

/** Тумблер «показывать в выборе агента». */
function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        // В карточке тумблер лежит внутри кликабельной области — клик по нему
        // не должен заодно открывать редактор.
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-background transition-all",
          checked ? "left-[1.125rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

function AgentCard({
  agent,
  onOpen,
  onEdit,
  onToggle,
  onDelete,
  onConnectionsChanged,
}: {
  agent: Agent;
  /** Открыть на просмотр — у ЛЮБОГО агента, и у встроенного: посмотреть,
   *  о чём он и как работает, не рискуя что-то задеть. Правка — карандашом. */
  onOpen: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onConnectionsChanged: () => void;
}) {
  const t = useT();
  const a = t.agents;
  const cfg = agent.config ?? {};
  const model = cfg.model_id as string | undefined;
  const effort = cfg.effort as EffortLevel | undefined;
  const forms = connectionForms(agent.config);
  const needsConnection = (agent.missing_connections ?? []).length > 0;
  const connections = agent.slug && forms.length > 0;

  // ПЛИТКА КАК У НАВЫКА И КОННЕКТОРА. Высота у всех ОДНА: описание всегда
  // в две строки, под ним ОДИН нижний ряд — чипы модели слева, действия
  // справа (как у коннектора: чипы внизу). Свои и встроенные стоят в разных
  // сетках, по ряду их не выровнять — поэтому ряд есть всегда, даже пустой.
  // Раньше чипы и действия занимали две строки, и у встроенного агента (ни
  // модели, ни кнопок) внизу зияли обе пустые. Выключенный не приглушаем
  // (как и навык): это состояние, его показывает тумблер.
  return (
    <div
      className={cn(
        "group flex h-full cursor-pointer flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-accent/40",
      )}
      onClick={onOpen}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-foreground">
            {agent.name}
          </span>
        </div>
        {/* Три строки — две обрывали даже короткое описание. Высота
            фиксирована (3 × 1rem), чтобы карточки оставались одинаковыми;
            целиком описание — в просмотре. */}
        <p className="mt-0.5 line-clamp-3 h-12 text-xs text-muted-foreground">
          {agent.description}
        </p>
      </div>

      <div className="mt-auto flex h-7 shrink-0 items-center gap-1">
        {/* Модель и глубину показываем, только если агент их ЗАФИКСИРОВАЛ.
            Пусто = выбор остаётся за человеком в момент разговора. */}
        <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
          {model && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {model}
            </span>
          )}
          {effort && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {EFFORT_LABELS[effort] ?? effort}
            </span>
          )}
        </div>

        {/* Действия справа. Подключения — у того, кто объявил `connections:`
            (формы в config.connection_forms); правка и удаление по
            наведению; тумблер виден всегда — он показывает состояние. */}
        {connections && (
          <AgentConnectionsButton
            slug={agent.slug!}
            forms={forms}
            missing={needsConnection}
            onChanged={onConnectionsChanged}
          />
        )}
        {/* Кнопки есть у КАЖДОГО агента, у встроенного — заблокированы: без
            них его карточка выглядела другой, а «нельзя» лучше показать, чем
            спрятать. */}
        <button
          type="button"
          disabled={!agent.editable}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={a.edit}
          className="rounded-md p-1.5 text-muted-foreground/60 opacity-0 transition [@media(hover:none)]:opacity-100 enabled:hover:bg-accent enabled:hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:text-muted-foreground/30"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={!agent.editable}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={a.delete}
          className="rounded-md p-1.5 text-muted-foreground/60 opacity-0 transition [@media(hover:none)]:opacity-100 enabled:hover:bg-destructive/10 enabled:hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:text-muted-foreground/30"
        >
          <Trash2 className="size-3.5" />
        </button>
        <Switch
          checked={agent.enabled}
          onChange={onToggle}
          disabled={!agent.editable}
          label={a.enabledLabel}
        />
      </div>
    </div>
  );
}

/** Модель + глубина рассуждения одной капсулой — как в поле ввода.
 *
 *  В инпуте (ai-chat-input.tsx: ModelDropdown) это единый дропдаун с двумя
 *  разделами, и здесь повторяем ту же форму: человек уже знает этот контрол.
 *
 *  Своё, не переиспользованный ModelDropdown: у того оба значения обязательны
 *  (в чате модель всегда выбрана), а агенту нужно ТРЕТЬЕ состояние — «не
 *  задано», когда он наследует выбор разговора. Плюс тип модели там прибит к
 *  ChatModelId, а в форме это строка: агент может нести id, которого нет в
 *  списке чата (задан файлом или прошлой версией) — такой показываем как есть,
 *  а не молча теряем.
 */
function ModelEffortPicker({
  model,
  effort,
  onModelChange,
  onEffortChange,
  effortSectionLabel,
}: {
  model: string;
  effort: string;
  onModelChange: (v: string) => void;
  onEffortChange: (v: string) => void;
  effortSectionLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Подпись капсулы — «Модель · Глубина». Имя модели — настоящее, с эндпоинта.
  const { models } = useModels();
  const modelLabel = model;
  const effortLabel = EFFORT_LABELS[effort as EffortLevel] ?? effort;
  const caption = effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel;

  const row = (
    active: boolean,
    title: string,
    onClick: () => void,
    hint?: string,
  ) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-sm transition hover:bg-accent hover:text-accent-foreground",
        active ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span>{title}</span>
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      {active && <Check className="size-3.5 shrink-0 text-primary" />}
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
      >
        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{caption}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          role="menu"
          // ВВЕРХ, а не вниз: колонка формы — overflow-y-auto, и открытое вниз
          // меню уходило за её нижнюю границу (приходилось скроллить). Сверху
          // от капсулы ~330px контента (имя + описание) — меню (~230px)
          // помещается целиком.
          className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {models.map((m) =>
            <React.Fragment key={m}>
              {row(model === m, m, () => onModelChange(m))}
            </React.Fragment>,
          )}

          {/* Глубина — вторым разделом, с заголовком: значения («Средний») сами
              по себе не говорят, к чему относятся. Так же и в инпуте. */}
          <div className="my-1 h-px bg-border" />
          <div className="px-3 pb-1 pt-1 text-xs font-medium text-muted-foreground">
            {effortSectionLabel}
          </div>
          {EFFORT_ORDER.map((lvl) =>
            <React.Fragment key={lvl}>
              {row(effort === lvl, EFFORT_LABELS[lvl], () => onEffortChange(lvl))}
            </React.Fragment>,
          )}
        </div>
      )}
    </div>
  );
}

/** Подпись поля с пояснением под «i».
 *
 *  ВСЕ подсказки в формах — здесь, а не строкой под полем. Полей в форме
 *  навыка четыре, у каждого была своя строка мелким текстом: в сумме экран
 *  текста, который читают один раз, а пролистывают всегда. Под «i» он не мешает
 *  и остаётся доступен.
 *
 *  `hint` необязателен: поле, которому пояснение не нужно, просто не получает
 *  иконку — пустой тултип раздражал бы сильнее отсутствующего. */
function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className={LABEL}>{label}</label>
      {hint && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/60 transition hover:bg-muted hover:text-foreground">
                <Info size={13} />
              </span>
            }
          />
          <TooltipContent side="top" className="max-w-[280px] whitespace-normal">
            {hint}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** Ряд с тумблером: подпись, «i» с пояснением, сам тумблер.
 *
 *  Пояснение — ПОД «i», а не строкой под подписью. Тумблеров в форме два, и
 *  оба их пояснения — по три строки мелким текстом; в сумме это половина
 *  экрана текста, который читают один раз, а пролистывают всегда. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  dimmed,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  dimmed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 transition-opacity",
        dimmed && "opacity-50",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="truncate text-sm text-foreground">{label}</div>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/60 transition hover:bg-muted hover:text-foreground">
                <Info size={13} />
              </span>
            }
          />
          <TooltipContent side="top" className="max-w-[280px] whitespace-normal">
            {hint}
          </TooltipContent>
        </Tooltip>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

/** Инструменты агента — ОДНО поле на два реестра бэкенда.
 *
 *  На бэкенде это `tools` (веб, погода, задачи) и `middleware` (память,
 *  субагенты, план): разные механизмы сборки, и в конфиге они остаются
 *  раздельными. Но человеку эта граница не значит ничего — он выбирает «что
 *  агент умеет», а не «через какой слой это подключено». Поэтому в форме один
 *  список, а раскладывает обратно по полям `splitSelection` (реестры не
 *  пересекаются, имя однозначно определяет поле).
 *
 *  Карточки в модалке, а не чипами на странице: у шести записей есть описания,
 *  и без них имена вроде «Задачи» или «План работы» ничего не говорят. Шесть
 *  описаний прямо в форме — это экран текста посреди других полей, а читают их
 *  один раз, при сборке агента.
 *
 *  ТРИ состояния, как и раньше: не задано (набор по умолчанию) / точный состав /
 *  пустой состав. Последнее — не то же, что первое: пустой значит «ничего сверх
 *  файлов и команд», и без отдельной кнопки «По умолчанию» вернуться из него в
 *  «не задано» было бы нельзя. */
/** Выбор инструментов: поиск, «По умолчанию», сетка карточек.
 *
 *  Живёт на вкладке «Инструменты» формы агента и занимает её целиком. Раньше
 *  здесь стояла капсула со сводкой и кнопкой «Настроить», открывавшая это же
 *  окно, — лишний клик на вкладке, которая и так про инструменты.
 *
 *  ТРИ состояния: не задано (набор по умолчанию) / точный состав / пустой
 *  состав. Последнее — не то же, что первое: пустой значит «ничего сверх файлов
 *  и команд», и без отдельной кнопки «По умолчанию» вернуться из него в «не
 *  задано» было бы нельзя. */
function ToolsPicker({
  names,
  value,
  onChange,
  labels,
  defaultsLabel,
  searchPlaceholder,
  nothingFound,
}: {
  names: string[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  labels: Record<string, { label: string; hint: string }>;
  defaultsLabel: string;
  searchPlaceholder: string;
  nothingFound: string;
}) {
  const [query, setQuery] = React.useState("");

  // Незнакомое имя показываем как есть: оно приехало из реестра, которому фронт
  // ещё не знает перевода. Скрывать его нельзя — оно работает и влияет на
  // агента, а сырое имя заодно видно как напоминание дописать перевод.
  const nameOf = React.useCallback(
    (n: string) => labels[n]?.label ?? n,
    [labels],
  );

  // Ищем и по подписи, и по описанию, и по техническому имени. По имени —
  // потому что в конфиге агента и в логах лежит оно, и человек, пришедший из
  // файла агента, будет искать `web`, а не «Поиск в интернете».
  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return names;
    return names.filter((n) =>
      [n, labels[n]?.label ?? "", labels[n]?.hint ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [names, labels, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
        />
      </div>

      {/* «По умолчанию» — вне сетки и вне поиска: это не ещё один инструмент, а
          выбор «не настраивать вручную», и он должен быть доступен всегда,
          даже когда фильтр не нашёл ничего. */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "flex shrink-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors",
          value === null
            ? "border-primary bg-primary/5"
            : "border-border/60 hover:bg-accent",
        )}
      >
        <span className="min-w-0 flex-1 text-sm font-medium">{defaultsLabel}</span>
        {value === null && <Check className="size-4 shrink-0 text-primary" />}
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {nothingFound}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {shown.map((n) => {
              const on = value?.includes(n) ?? false;
              return (
                <button
                  key={n}
                  type="button"
                  // Клик выводит из «не задано»: человек начал собирать состав
                  // руками, и молча дописывать выбранное к набору по умолчанию
                  // нельзя — у этого агента тот набор может быть другим.
                  onClick={() =>
                    onChange(
                      on
                        ? (value ?? []).filter((x) => x !== n)
                        : [...(value ?? []), n],
                    )
                  }
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                    on
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:bg-accent",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{nameOf(n)}</span>
                    {labels[n]?.hint && (
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {labels[n].hint}
                      </span>
                    )}
                  </span>
                  {on && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Форма создания и правки. Одна на оба случая: поля те же, отличается только
 *  заголовок и что происходит при сохранении. */
// export: та же форма служит созданию агента ИЗ ПРОСТРАНСТВА (spaces-screen) —
// единая точка создания, а не своя форма в каждом разделе.
export function AgentForm({
  agent,
  busy,
  onSubmit,
  onCancel,
  onPreviewSkill,
}: {
  agent: Agent | null;
  busy: boolean;
  onSubmit: (body: AgentInput) => void;
  onCancel: () => void;
  /** Открыть коробочный навык на чтение — из вкладки «Навыки». */
  onPreviewSkill?: (name: string) => void;
}) {
  const t = useT();
  const a = t.agents;
  const cfg = (agent?.config ?? {}) as Record<string, unknown>;

  const [name, setName] = React.useState(agent?.name ?? "");
  const [description, setDescription] = React.useState(agent?.description ?? "");
  const [prompt, setPrompt] = React.useState(agent?.system_prompt ?? "");
  // Модель и глубина ЗАДАЮТСЯ ВСЕГДА, наследования из разговора нет: агент —
  // это в том числе «чем он думает», и молчаливая зависимость от того, что
  // выбрано в чате, делала его поведение невоспроизводимым. Пустое значение в
  // конфиге (старый агент, созданный до этого) подменяем дефолтом бэкенда —
  // ВЫЧИСЛЯЕМ, а не пишем в стейт эффектом: список приходит асинхронно, и
  // setState в эффекте дал бы каскадный ререндер.
  const { defaultModel } = useModels();
  const [pickedModel, setModel] = React.useState<string>(
    (cfg.model_id as string) || "",
  );
  const model = pickedModel || defaultModel || "";
  const [effort, setEffort] = React.useState<string>(
    (cfg.effort as string) || DEFAULT_AGENT_EFFORT,
  );
  const [enabled, setEnabled] = React.useState(agent?.enabled ?? true);
  const [delegatable, setDelegatable] = React.useState(agent?.delegatable ?? false);
  const [skills, setSkills] = React.useState<string[]>(agent?.skills ?? []);
  // Коннекторы — ЯВНЫМ списком id. Ассистент видит все подключённые сервисы
  // сам, а агент — только объявленные; пусто значит «ни одного», третьего
  // состояния (как у инструментов) здесь нет.
  const [connectors, setConnectors] = React.useState<string[]>(
    Array.isArray(cfg.connectors) ? (cfg.connectors as string[]) : [],
  );
  // Правила коннекторов у агента: какие инструменты ему доступны и что он
  // подтверждает (connectors/rules.py). Нет записи — как в общих настройках.
  const [connectorRules, setConnectorRules] = React.useState<ConnectorRules>(
    (cfg.connector_rules as ConnectorRules | undefined) ?? {},
  );
  const [rulesFor, setRulesFor] = React.useState<string | null>(null);
  // Открытая вкладка формы: сам агент, его навыки, инструменты или коннекторы.
  const [pane, setPane] = React.useState<"agent" | "skills" | "tools" | "connectors">("agent");
  // Поиск по навыкам на своей вкладке. Их десяток и будет больше — без поиска
  // выбрать нужный значит просматривать всю сетку глазами.
  const [skillQuery, setSkillQuery] = React.useState("");
  const [connectorQuery, setConnectorQuery] = React.useState("");

  // Тулы и middleware: null = «не задано» (агент получит набор по умолчанию),
  // массив = точный состав, в том числе ПУСТОЙ. Три состояния, а не два, и
  // разница видна пользователю: пустой список это «ничего сверх файловых», а
  // не «как обычно». Свернуть их в один [] значило бы отнять возможность
  // собрать агента без веба и погоды.
  //
  // В ИНТЕРФЕЙСЕ это ОДНО поле, в конфиге — два. Состояние держим объединённым
  // (так его правит ToolsPicker), а раскладываем обратно при сохранении.
  // Обратная сторона: «не задано» теперь общее на оба реестра. Раздельно оно
  // было бы честнее к конфигу, но означало бы два поля в форме — ровно то, что
  // мы убираем; агент с `tools: []` и дефолтным middleware настраивается
  // файлом, а не этой формой.
  const [toolsCombined, setToolsCombined] = React.useState<string[] | null>(() => {
    const t = cfg.tools as string[] | undefined;
    // `connectors` — не выбор, а каркас: состав сервисов агента задаётся на
    // своей вкладке. Попади это имя в middleware (агент заведён файлом) — при
    // сохранении оно ушло бы в тулы как незнакомое, и бэкенд отказал бы форме.
    const m = (cfg.middleware as string[] | undefined)?.filter((n) => n !== "connectors");
    return t === undefined && m === undefined ? null : [...(t ?? []), ...(m ?? [])];
  });

  // Что вообще бывает. Списки читает бэкенд из своих реестров — здесь не
  // дублируем, иначе разъедется при добавлении навыка или комплекта.
  // Каталог С ОПИСАНИЯМИ, а не просто имена: навыки выбирают карточками, и по
  // одному слову «pdf» не понять, что это и зачем.
  const [builtin, setBuiltin] = React.useState<SkillInfo[]>([]);
  // СВОИ навыки — их тоже можно дать агенту: `skills:` в конфиге принимает
  // коробочные И личные слаги (см. agents_backend), и для спец-агента это
  // ЕДИНСТВЕННЫЙ способ получить пользовательский навык — каталог /skills/my/
  // монтируется только универсальному ассистенту. Без этой загрузки форма
  // показывала одни коробочные, и свой навык агенту нельзя было выдать иначе
  // как правкой файла конфига.
  const [mySkills, setMySkills] = React.useState<MySkill[]>([]);
  const [availableTools, setAvailableTools] = React.useState<string[]>([]);
  const [availableMw, setAvailableMw] = React.useState<string[]>([]);
  // Коннекторы — карточками в окно выбора (вкладка «Коннекторы»).
  const connectorList = useConnectorList();
  const connectorItems = useConnectorItems(connectorList);

  React.useEffect(() => {
    let alive = true;
    fetchSkillsCatalog().then((list) => alive && setBuiltin(list));
    fetchMySkills().then((list) => alive && setMySkills(list));
    fetchToolsets().then((list) => alive && setAvailableTools(list));
    fetchMiddleware().then((list) => alive && setAvailableMw(list));
    return () => {
      alive = false;
    };
  }, []);

  // Общий список карточек. Свои — ПЕРВЫМИ: их несколько против десятков
  // коробочных, и человек, который завёл навык, ищет именно его.
  //
  // В `skills:` уходит СЛАГ (имя каталога в /skills/my/), а не человеческое
  // имя навыка: по слагу его резолвит skill_sources. Поэтому ключ карточки —
  // slug, а подпись — name.
  //
  // enabled НЕ фильтруем: тумблер в разделе навыков — про каталог личного
  // ассистента, а не про пригодность навыка. Убранный оттуда навык агенту
  // выдать можно, и это осознанный выбор.
  const available = React.useMemo(
    () => [
      ...mySkills.map((s) => ({
        name: s.slug,
        title: s.name,
        description: s.description,
        category: s.category,
        icon: "",
        mine: true,
      })),
      ...builtin.map((s) => ({
        name: s.name,
        title: s.name,
        description: s.description,
        category: s.category,
        icon: s.icon,
        mine: false,
      })),
    ],
    [mySkills, builtin],
  );

  // Один список для формы. Реестры не пересекаются — имя однозначно говорит, в
  // какое поле конфига его вернуть, поэтому объединение обратимо.
  const allToolNames = React.useMemo(
    () => [...availableTools, ...availableMw],
    [availableTools, availableMw],
  );

  // Ищем и по имени, и по описанию: имя это каталог («xlsx»), и человек,
  // который знает, ЧТО ему нужно, а не как оно называется, найдёт по описанию.
  const shownSkills = React.useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    if (!q) return available;
    return available.filter((s) =>
      `${s.name} ${s.title} ${s.description}`.toLowerCase().includes(q),
    );
  }, [available, skillQuery]);

  const shownConnectors = React.useMemo(() => {
    const q = connectorQuery.trim().toLowerCase();
    const all = connectorItems ?? [];
    if (!q) return all;
    return all.filter((c) => `${c.id} ${c.name} ${c.description}`.toLowerCase().includes(q));
  }, [connectorItems, connectorQuery]);

  const canSave = name.trim().length > 0 && !busy;

  const submit = () => {
    if (!canSave) return;
    // Модель и глубина пишутся ВСЕГДА: в интерфейсе их нельзя оставить
    // незаданными, поэтому агент несёт их явно. Прежняя ветка «пусто = убрать
    // ключ» (наследование из разговора) убрана вместе с пунктом «Как в чате».
    const config: Record<string, unknown> = { ...cfg };
    config.model_id = model;
    config.effort = effort;
    // null убирает ключ целиком -> набор по умолчанию. Пустой массив
    // остаётся массивом: это осознанное «ничего сверх базы».
    //
    // Раскладываем объединённый состав обратно по двум полям — по тому, из
    // какого реестра приехало имя. Неизвестное (реестр новее словаря или
    // комплект выкатили и убрали) кладём в `tools`: бэкенд там пропускает
    // незнакомое с записью в лог, а не падает.
    //
    // ПУСТОЙ КЛЮЧ ПИШЕМ ТОЛЬКО ЕСЛИ ОН УЖЕ БЫЛ. Агент, заведённый файлом, может
    // нести `tools:` без `middleware:` — это значит «тулы урезаны, остальное по
    // умолчанию». Дописав ему `middleware: []`, форма молча отняла бы память,
    // субагентов и план работы; человек открыл поле инструментов, ничего там не
    // тронул и потерял настройку.
    if (toolsCombined === null) {
      delete config.tools;
      delete config.middleware;
    } else {
      const mw = toolsCombined.filter((n) => availableMw.includes(n));
      const ts = toolsCombined.filter((n) => !availableMw.includes(n));
      if (mw.length > 0 || cfg.middleware !== undefined) config.middleware = mw;
      if (ts.length > 0 || cfg.tools !== undefined) config.tools = ts;
    }
    // Пишем всегда, и пустой тоже: у коннекторов «нет ключа» и «пустой
    // список» значат одно — агент не видит ни одного.
    config.connectors = connectors;
    // Правила — только у выбранных: убранный коннектор уносит свои с собой.
    const rules = Object.fromEntries(Object.entries(connectorRules).filter(([id]) => connectors.includes(id)));
    if (Object.keys(rules).length > 0) config.connector_rules = rules;
    else delete config.connector_rules;

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      system_prompt: prompt,
      config,
      enabled,
      delegatable,
      skills,
    });
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={
        /* ВКЛАДКИ ВМЕСТО НАЗВАНИЯ — как в форме навыка. «Новый агент» в шапке
           ничего не сообщал, а строку занимал. */
        <div className="inline-flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-0.5">
          {([
            ["agent", a.agentTabMain, 0],
            ["skills", a.fieldSkills, skills.length],
            ["tools", a.fieldTools, toolsCombined?.length ?? 0],
            ["connectors", a.fieldConnectors, connectors.length],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPane(key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors sm:px-3",
                pane === key
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {/* Счётчик: сколько выбрано, видно не переключаясь. Ноль не
                  показываем — пустой чип это шум. */}
              {count > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground">
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      }
      className="flex h-[80dvh] w-full max-w-5xl flex-col max-md:h-[calc(100dvh-2rem)] max-md:p-4"
    >
      {pane === "agent" ? (
        /* ДВЕ КОЛОНКИ. Инструкция — главное поле агента, её пишут и
           переписывают, поэтому она во всю высоту слева. Справа короткие
           свойства: имя, чем занимается, чем думает, два тумблера. */
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto md:flex-row md:overflow-hidden">
          <div className="flex min-h-[60dvh] min-w-0 flex-1 flex-col gap-1.5 md:min-h-0">
            <FieldLabel label={a.fieldPrompt} hint={a.fieldPromptHint} />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={a.fieldPromptPlaceholder}
              className={cn(FIELD, "min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed")}
            />
          </div>

          <div className="order-first flex shrink-0 flex-col gap-4 md:order-none md:w-80 md:overflow-y-auto md:pr-1">
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>{a.fieldName}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={a.fieldNamePlaceholder}
                maxLength={100}
                className={FIELD}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel label={a.fieldDescription} hint={a.fieldDescriptionHint} />
              {/* textarea, а не input: лимит 500 символов в одну строку не
                  влезает, а ниже по колонке всё равно пусто — пусть описание
                  дышит. resize-none: тянуть руками некуда, колонка узкая. */}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={a.fieldDescriptionPlaceholder}
                maxLength={500}
                rows={5}
                className={`${FIELD} resize-none`}
              />
            </div>

            {/* Модель и глубина — ОДНОЙ капсулой, как в поле ввода
                (ai-chat-input.tsx: ModelDropdown): это один вопрос «чем
                думать», и разносить его по двум селектам незачем. */}
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>{a.fieldModel}</label>
              <ModelEffortPicker
                model={model}
                effort={effort}
                onModelChange={setModel}
                onEffortChange={setEffort}
                effortSectionLabel={a.fieldEffort}
              />
            </div>

            <ToggleRow
              label={a.enabledLabel}
              hint={a.enabledHint}
              checked={enabled}
              onChange={setEnabled}
            />

            {/* Делегирование — отдельный вопрос: не «нужен мне под рукой», а
                «пусть ассистент зовёт его сам». НЕЗАВИСИМ от enabled: оба
                тумблера про личный список над полем ввода, и убранный оттуда
                агент продолжает быть исполнителем, если его об этом просили.
                Стояло `checked={delegatable && enabled}` с блокировкой — и
                снятая галочка у выключенного агента читалась как «делегирование
                отключено», хотя в базе оно стояло. */}
            <ToggleRow
              label={a.delegatableLabel}
              hint={a.delegatableHint}
              checked={delegatable}
              onChange={setDelegatable}
            />
          </div>
        </div>
      ) : pane === "skills" ? (
        /* Навыки. Набор агента ЗАМЕЩАЕТ общий: узкому специалисту лишние
           только занимают промпт — их описания идут в контекст каждый ход.
           Ничего не выбрано = набор по умолчанию. */
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {/* Пояснение зависит от состояния: пока ничего не выбрано, важно
              другое — что агент получит набор по умолчанию, а не пустоту. */}
          <FieldLabel
            label={a.fieldSkills}
            hint={skills.length === 0 ? a.skillsDefaultHint : a.fieldSkillsHint}
          />
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder={a.searchPlaceholder}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>

          {/* КАРТОЧКАМИ, как инструменты рядом: у навыка есть описание, и по
              имени каталога («pdf», «xlsx») не понять, что он делает. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shownSkills.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {a.nothingFound}
              </p>
            ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {shownSkills.map((s) => {
                const on = skills.includes(s.name);
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() =>
                      setSkills((cur) =>
                        on ? cur.filter((x) => x !== s.name) : [...cur, s.name],
                      )
                    }
                    className={cn(
                      // h-full и фиксированная высота описания: в сетке
                      // карточки стоят рядом, и разная длина текста делала бы
                      // их разного роста.
                      "group/skill flex h-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                      on
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <SkillIcon icon={s.icon} category={s.category} className="size-4" />
                        <span className="min-w-0 truncate text-sm font-medium">
                          {s.title}
                        </span>
                        {/* Метка своего навыка: в общей сетке иначе не
                            отличить личный от коробочного, а правится он
                            в разделе навыков, не здесь. */}
                        {s.mine && (
                          <span className="shrink-0 rounded px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-border">
                            {a.skillMine}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block h-8 text-xs leading-snug text-muted-foreground">
                        {s.description}
                      </span>
                    </span>
                    {/* Заглянуть внутрь навыка, не уходя из формы. ТОЛЬКО
                        ЧТЕНИЕ: копировать и править отсюда нельзя — человек
                        настраивает агента, а не библиотеку.
                        У СВОИХ кнопки нет: предпросмотр читает каталог
                        поставки (/api/skills/catalog/{name}), и для личного
                        слага он ответил бы «не найдено». */}
                    {!s.mine && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={s.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreviewSkill?.(s.name);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        e.stopPropagation();
                        onPreviewSkill?.(s.name);
                      }}
                      className="mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/60 opacity-0 transition [@media(hover:none)]:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/skill:opacity-100"
                    >
                      <Info size={13} />
                    </span>
                    )}
                    {on && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
            )}
          </div>
        </div>
      ) : pane === "tools" ? (
        /* Инструменты — ОДНО поле на два реестра (tools и middleware). Граница
           между ними техническая: веб и погода собираются фабрикой тулов, а
           память и субагенты — слоем конвейера. Человек выбирает не это, а что
           агент умеет.

           Файловых тулов в списке нет: они каркас, есть у любого агента
           всегда. Порядка тоже нет — для middleware он свойство реестра, и
           ручка в интерфейсе позволила бы молча сломать агента. */
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <FieldLabel label={a.fieldTools} hint={a.fieldToolsHint} />
          {/* Выбор СРАЗУ, без промежуточной капсулы с кнопкой «Настроить»:
              вкладка и так про инструменты, и лишний клик ничего не добавлял. */}
          <ToolsPicker
            names={allToolNames}
            value={toolsCombined}
            onChange={setToolsCombined}
            labels={a.toolNames}
            defaultsLabel={a.useDefaults}
            searchPlaceholder={a.searchPlaceholder}
            nothingFound={a.nothingFound}
          />
        </div>
      ) : (
        /* Коннекторы — какие внешние сервисы (почта, календарь, свой MCP)
           агент может брать. Состав явный: что не отмечено, того агент не
           видит (все подключённые разом видит только ассистент). */
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <FieldLabel label={a.fieldConnectors} hint={a.fieldConnectorsHint} />
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={connectorQuery}
              onChange={(e) => setConnectorQuery(e.target.value)}
              placeholder={a.searchPlaceholder}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>

          {/* Та же сетка карточек, что у навыков рядом: логотип, название,
              описание в две строки, галочка у выбранного. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {connectorItems === null ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t.files.loading}</p>
            ) : connectorItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t.connectors.pickerEmpty}
              </p>
            ) : shownConnectors.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {a.nothingFound}
              </p>
            ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {shownConnectors.map((item) => {
                const on = connectors.includes(item.id);
                return (
                  // Обёртка ради «Настроить»: кнопку в кнопку не вложить.
                  <div key={item.id} className="relative h-full">
                  <button
                    type="button"
                    onClick={() =>
                      setConnectors((cur) =>
                        on ? cur.filter((x) => x !== item.id) : [...cur, item.id],
                      )
                    }
                    className={cn(
                      "flex h-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                      // Снизу место под «Настроить», чтобы оно не наезжало на описание.
                      on
                        ? "border-primary bg-primary/5 pb-8"
                        : "border-border/60 hover:bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {item.logo && <ConnectorLogo src={item.logo} className="size-4" />}
                        <span className="min-w-0 truncate text-sm font-medium">
                          {item.name}
                        </span>
                        {item.badge}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block h-8 text-xs leading-snug text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    {on && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
                  </button>
                  {/* Свои правила коннектора у этого агента: доступные
                      инструменты и подтверждения (окно общее с задачей и
                      пространством). Только у выбранного. */}
                  {on && (
                    <button
                      type="button"
                      onClick={() => setRulesFor(item.id)}
                      className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <SlidersHorizontal className="size-3" />
                      {connectorRules[item.id] ? t.connectors.configured : t.connectors.configure}
                    </button>
                  )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </div>
      )}

      {rulesFor && connectorList?.find((x) => x.id === rulesFor) && (
        <ConnectorRulesDialog
          connector={connectorList.find((x) => x.id === rulesFor)!}
          rule={connectorRules[rulesFor]}
          onChange={(rule) =>
            setConnectorRules((cur) => {
              const next = { ...cur };
              if (rule) next[rulesFor] = rule;
              else delete next[rulesFor];
              return next;
            })
          }
          onClose={() => setRulesFor(null)}
        />
      )}

      <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-border/60 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {a.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {agent ? a.save : a.create}
        </button>
      </div>
    </Modal>
  );
}

/** Раздел «Файлы» навыка: список плюс кнопка «Добавить».
 *
 *  Навык это не только инструкция — рядом живут скрипты, шаблоны и
 *  requirements.txt, и запускает их bash в песочнице. Положить их раньше мог
 *  только ассистент в разговоре.
 *
 *  РАБОТАЕТ И ДО СОХРАНЕНИЯ. Файлы кладутся в S3 под слаг навыка, а у
 *  несозданного слага нет — но требовать «сначала сохрани, потом прикладывай»
 *  нельзя: человек собирает навык целиком. Поэтому у нового навыка выбранное
 *  видно в списке сразу, а на сервер уходит при сохранении (см. submitSkill).
 *  Ничего не создаётся за спиной человека раньше, чем он нажал кнопку.
 */
function SkillFiles({
  skillId,
  pending,
  onPendingChange,
  onCountChange,
}: {
  /** id сохранённого навыка. null — навык ещё создаётся. */
  skillId: string | null;
  /** Выбранные, но ещё не отправленные файлы — только у нового навыка. */
  pending: File[];
  onPendingChange: (files: File[]) => void;
  /** Сообщить форме, сколько файлов приложено — для счётчика на вкладке. */
  onCountChange?: (n: number) => void;
}) {
  const t = useT();
  const a = t.agents;
  const [saved, setSaved] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  // Выбранный в дереве файл. Нужен только для удаления: содержимое в форме не
  // показываем — на файлы смотрят в просмотре навыка.
  const [active, setActive] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const reload = React.useCallback(async () => {
    if (skillId) setSaved(await fetchMySkillFiles(skillId));
  }, [skillId]);

  React.useEffect(() => {
    if (!skillId) return;
    let alive = true;
    fetchMySkillFiles(skillId).then((list) => alive && setSaved(list));
    return () => {
      alive = false;
    };
  }, [skillId]);

  // Один список на оба случая: уже загруженные и ещё только выбранные. Для
  // человека это одно и то же — «что приложено к навыку».
  //
  // Мемоизируем: массив пересоздавался бы каждый рендер, и дерево ниже
  // перестраивалось бы вместе с ним — на семидесяти пяти файлах это заметно.
  const paths = React.useMemo(
    () => (skillId ? saved : pending.map((f) => f.name)),
    [skillId, saved, pending],
  );

  // ДЕРЕВОМ, тем же, что в просмотре навыка. У копии коробочного файлов
  // семьдесят пять, и плоский список полных путей («assets/templates/audit.js»
  // в каждой строке) — это простыня, в которой не видно ни структуры, ни того,
  // где кончается один каталог и начинается другой.
  const tree = React.useMemo(() => buildTree(paths), [paths]);

  const removeActive = async () => {
    if (!active) return;
    if (!skillId) {
      onPendingChange(pending.filter((f) => f.name !== active));
      setActive(null);
      return;
    }
    setBusy(true);
    await deleteMySkillFile(skillId, active);
    await reload();
    setActive(null);
    setBusy(false);
  };

  // Сообщаем форме, сколько файлов приложено — она рисует счётчик на вкладке.
  React.useEffect(() => {
    onCountChange?.(paths.length);
  }, [paths.length, onCountChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <FieldLabel label={a.skillFilesLabel} hint={a.skillFilesHint} />
        <div className="flex items-center gap-2">
          {/* Удаление — у ВЫБРАННОГО файла, здесь же в шапке. Корзина в каждой
              строке дерева забивала бы его иконками, а удаляют редко. */}
          {active && (
            <button
              type="button"
              onClick={removeActive}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              {a.delete}
            </button>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {a.skillFilesAdd}
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const picked = Array.from(e.target.files ?? []);
          // Сбрасываем значение: иначе повторный выбор ТОГО ЖЕ файла не даст
          // события, и «перезалить исправленный скрипт» молча не сработает.
          e.target.value = "";
          if (!picked.length) return;
          if (!skillId) {
            // Одноимённый заменяем — так же, как это делает сервер.
            const names = new Set(picked.map((f) => f.name));
            onPendingChange([...pending.filter((f) => !names.has(f.name)), ...picked]);
            return;
          }
          setBusy(true);
          await uploadMySkillFiles(skillId, picked);
          await reload();
          setBusy(false);
        }}
      />

      {paths.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/60">
          <p className="text-xs text-muted-foreground">{a.skillFilesEmpty}</p>
        </div>
      ) : (
        /* Дерево на всю площадь вкладки: в узкой колонке пути вроде
           `scripts/office/schemas/...` обрезались на полуслове. */
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 p-1">
          <FileTree nodes={tree} active={active ?? ""} onPick={setActive} />
        </div>
      )}
    </div>
  );
}

/** Форма своего навыка — в модалке, как и просмотр коробочного.
 *
 *  Полей меньше, чем у агента, и это по делу: у навыка нет ни модели, ни тулов,
 *  ни памяти — он описывает КАК делать работу, а чем её делать решает тот, кто
 *  навык взял. Остаётся четыре поля, тумблер и файлы.
 *
 *  Слаг не редактируется: он же имя каталога в /skills/my/, на него ссылаются
 *  инструкции и скрипты внутри самого навыка. Переименование создало бы второй
 *  навык вместо правки первого.
 */
// export: та же форма служит созданию навыка ИЗ ПРОСТРАНСТВА (spaces-screen) —
// единая точка создания, а не своя форма в каждом разделе.
export function SkillForm({
  skill,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  skill: MySkill | null;
  busy: boolean;
  error: string | null;
  /** `files` — приложенное до создания; у сохранённого всегда пусто. */
  onSubmit: (body: MySkillInput, files: File[]) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const a = t.agents;

  const [name, setName] = React.useState(skill?.name ?? "");
  const [description, setDescription] = React.useState(skill?.description ?? "");
  const [category, setCategory] = React.useState(skill?.category ?? "");
  const [body, setBody] = React.useState(skill?.body ?? "");
  const [enabled, setEnabled] = React.useState(skill?.enabled ?? true);
  // Файлы, выбранные до создания навыка: на сервер уходят при сохранении,
  // когда у навыка появится слаг. У сохранённого список пуст — там загрузка
  // идёт сразу, по выбору.
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  // Открытая вкладка формы: поля или файлы.
  const [pane, setPane] = React.useState<"fields" | "files">("fields");
  // Сколько файлов приложено — для счётчика на вкладке. Считает SkillFiles: у
  // сохранённого навыка список приходит с сервера, и форма его не знает.
  const [fileCount, setFileCount] = React.useState(0);

  // Описание обязательно: по нему навык выбирается, и без него он не сработает
  // никогда — просто не будет взят. Тело тоже: это сама инструкция.
  const canSave = name.trim().length > 0 && description.trim().length > 0
    && body.trim().length > 0 && !busy;

  return (
    <Modal
      open
      onClose={onCancel}
      title={
        /* ВКЛАДКИ ВМЕСТО НАЗВАНИЯ. «Новый навык» в шапке ничего не сообщал —
           человек и так знает, что открыл, — а вкладки занимали отдельную
           строку под ней. Теперь одна строка вместо двух. */
        <div className="inline-flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-0.5">
          {([
            ["fields", a.skillTabFields, 0],
            ["files", a.skillFilesLabel, fileCount],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPane(key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors sm:px-3",
                pane === key
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {/* Счётчик: сколько файлов приложено, видно не переключаясь.
                  Ноль не показываем — пустой чип это шум. */}
              {count > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground">
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      }
      className="flex h-[80dvh] w-full max-w-5xl flex-col max-md:h-[calc(100dvh-2rem)] max-md:p-4"
    >
      {pane === "fields" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto md:flex-row md:overflow-hidden">
          {/* Инструкция — главное поле навыка, его пишут и переписывают,
              поэтому она во всю высоту. Справа короткие свойства. */}
          <div className="flex min-h-[60dvh] min-w-0 flex-1 flex-col gap-1.5 md:min-h-0">
            <FieldLabel label={a.skillFieldBody} hint={a.skillFieldBodyHint} />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={a.skillFieldBodyPlaceholder}
              className={cn(FIELD, "min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed")}
            />
          </div>

          <div className="order-first flex shrink-0 flex-col gap-4 md:order-none md:w-80 md:overflow-y-auto md:pr-1">
            <div className="flex flex-col gap-1.5">
              <FieldLabel label={a.skillFieldName} hint={a.skillFieldNameHint} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={a.skillFieldNamePlaceholder}
                maxLength={100}
                className={FIELD}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel
                label={a.skillFieldDescription}
                hint={a.skillFieldDescriptionHint}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={a.skillFieldDescriptionPlaceholder}
                maxLength={500}
                rows={4}
                className={cn(FIELD, "resize-y")}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel label={a.skillFieldCategory} hint={a.skillFieldCategoryHint} />
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={40}
                className={FIELD}
              />
            </div>

            <ToggleRow
              label={a.skillEnabledLabel}
              hint={a.skillEnabledHint}
              checked={enabled}
              onChange={setEnabled}
            />

            {/* Ошибка от бэкенда — текстом, а не «не получилось»: проверки там
                содержательные, и человеку нужно знать, что именно поправить. */}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
      ) : (
        <SkillFiles
          skillId={skill?.id ?? null}
          pending={pendingFiles}
          onPendingChange={setPendingFiles}
          onCountChange={setFileCount}
        />
      )}

      {/* Действие — в футере, а не рядом с крестиком: см. BuiltinSkillView.
          Прибит к низу, поэтому виден и в длинной форме, где тело скроллится. */}
      <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-border/60 pt-4">
        {/* Явный выход без сохранения. Крестик в шапке закрывает окно, но в
            форме это не читается как «отменить правку» — человеку нужна кнопка,
            которая прямо это и говорит. */}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {a.cancel}
        </button>
        <button
          type="button"
          onClick={() =>
            onSubmit(
              {
                name: name.trim(),
                description: description.trim(),
                category: category.trim(),
                body,
                enabled,
              },
              pendingFiles,
            )
          }
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {/* `a.create` здесь НЕЛЬЗЯ: это «Создать агента» — ключ соседнего
              раздела, и в форме навыка он обещал не то. */}
          {skill ? a.save : a.createSkill}
        </button>
      </div>
    </Modal>
  );
}

/** Кнопка создания с выбором пути: руками или разговором.
 *
 *  Общая для агентов и навыков: подписи приходят параметрами, а развилка у них
 *  одна и та же. Два пути ведут к одной записи, но начинаются с разного: форма
 *  требует заранее знать, что писать в инструкцию, а разговор эту инструкцию как
 *  раз и вырабатывает. Меню, а не две кнопки рядом: второй путь уводит из
 *  раздела в чат, и это стоит показать выбором, а не соседством.
 */
// export: кнопка «Создать» с выбором «вручную / с ассистентом» — общая с
// разделом пространства (создание агентов и навыков оттуда идёт этим же путём).
export function CreateButton({
  label,
  manual,
  assisted,
  onManual,
  onAssisted,
}: {
  label: string;
  manual: { label: string; hint: string };
  assisted: { label: string; hint: string };
  onManual: () => void;
  onAssisted: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Закрытие по клику вне и по Esc. Меню маленькое и живёт рядом с кнопкой,
  // поэтому без портала — в отличие от дропдаунов композера, которые всплывают
  // над полем ввода и обрезались бы его контейнером.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (title: string, hint: string, onClick: () => void) => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="text-sm font-medium leading-tight">{title}</span>
      <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
    </button>
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 max-sm:size-8 max-sm:justify-center max-sm:p-0"
      >
        <Plus className="size-4" />
        {/* На телефоне — только «+», в размер кнопок поиска и фильтров рядом:
            с подписью кнопка не помещалась в их ряд. Имя остаётся для чтения. */}
        <span className="max-sm:sr-only">{label}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-60 rounded-lg border border-border/80 bg-popover p-1 shadow-md"
        >
          {item(assisted.label, assisted.hint, onAssisted)}
          {item(manual.label, manual.hint, onManual)}
        </div>
      )}
    </div>
  );
}

/** Дерево файлов навыка: папки сворачиваются, файл выбирается кликом.
 *
 *  НАСТОЯЩИЕ ПАПКИ, а не список путей с заголовками. В docx 75 файлов, из них
 *  44 внутри `scripts/` на трёх уровнях вложенности — вывалив их разом, мы
 *  получаем ту же простыню, которую и пытались убрать. Свёрнутый узел
 *  показывает счётчик: сколько там внутри, не открывая.
 *
 *  По умолчанию раскрыт только корень: человек пришёл читать SKILL.md, а
 *  скрипты открывает, если полез разбираться.
 */
type FileNode = {
  name: string;
  /** Полный путь. У файла — его собственный, у папки — путь до неё: по нему
   *  видно, лежит ли внутри открытый файл (тогда папку разворачиваем). */
  path: string;
  children?: FileNode[];
  /** Файлов внутри, включая вложенные папки. Для счётчика на свёрнутом узле. */
  count: number;
};

function buildTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", path: "", children: [], count: 0 };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    node.count += 1;
    parts.forEach((part, i) => {
      const leaf = i === parts.length - 1;
      node.children ??= [];
      let next = node.children.find((c) => c.name === part && !c.children === leaf);
      if (!next) {
        const here = parts.slice(0, i + 1).join("/");
        next = leaf
          ? { name: part, path: here, count: 1 }
          : { name: part, path: here, children: [], count: 0 };
        node.children.push(next);
      }
      if (!leaf) next.count += 1;
      node = next;
    });
  }
  // Папки выше файлов, внутри группы — по алфавиту. Исключение SKILL.md: он
  // точка входа и должен быть первым, что видит глаз.
  const sort = (nodes: FileNode[]): FileNode[] =>
    nodes
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n))
      .sort((x, y) => {
        if (x.name === "SKILL.md") return -1;
        if (y.name === "SKILL.md") return 1;
        const dx = x.children ? 0 : 1;
        const dy = y.children ? 0 : 1;
        return dx !== dy ? dx - dy : x.name.localeCompare(y.name);
      });
  return sort(root.children ?? []);
}

// Код или текст — больше в навыке различать нечего: там скрипты, справочные
// страницы и ассеты.
const CODE_FILE_RE = /\.(py|js|ts|tsx|jsx|sh|bash|json|ya?ml|toml)$/i;

/** Строка дерева: отступ вложенности плюс направляющая линия.
 *
 *  Линия, а не голый padding: без неё на третьем уровне не видно, к какой папке
 *  относится файл — глазу не за что зацепиться, и список выглядит случайным. */
const TREE_INDENT = 12;

function FileTree({
  nodes,
  active,
  onPick,
  depth = 0,
}: {
  nodes: FileNode[];
  active: string;
  onPick: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.children ? (
          <FolderNode
            key={`d:${node.name}:${depth}`}
            node={node}
            active={active}
            onPick={onPick}
            depth={depth}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            active={active}
            onPick={onPick}
            depth={depth}
          />
        ),
      )}
    </>
  );
}

function FileRow({
  node,
  active,
  onPick,
  depth,
}: {
  node: FileNode;
  active: string;
  onPick: (path: string) => void;
  depth: number;
}) {
  const isCode = CODE_FILE_RE.test(node.name);
  const on = node.path === active;
  return (
    <button
      type="button"
      onClick={() => onPick(node.path)}
      // Отступ инлайном: глубина вычисляется, а Tailwind собирает классы
      // статически и произвольное `pl-[N]` в сборку не попадёт.
      style={{ paddingLeft: 6 + depth * TREE_INDENT }}
      className={cn(
        "group/row flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors",
        on
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      title={node.path}
    >
      {/* Место под «шеврон» папки — чтобы имена файлов и папок стояли по одной
          вертикали, а не разъезжались на ширину стрелки. */}
      <span className="w-3 shrink-0" />
      {isCode ? (
        <FileCode2 className={cn("size-3.5 shrink-0", on ? "text-primary" : "opacity-60")} />
      ) : (
        <FileText className={cn("size-3.5 shrink-0", on ? "text-primary" : "opacity-60")} />
      )}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function FolderNode({
  node,
  active,
  onPick,
  depth,
}: {
  node: FileNode;
  active: string;
  onPick: (path: string) => void;
  depth: number;
}) {
  // Свёрнута по умолчанию — человек пришёл читать SKILL.md, а в scripts/ лезет,
  // когда разбирается. Но если внутри лежит ОТКРЫТЫЙ файл, разворачиваем: иначе
  // выбранное просто исчезло бы из дерева.
  const hasActive = !!active && active.startsWith(`${node.path}/`);
  const [open, setOpen] = React.useState(false);
  const expanded = open || hasActive;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: 6 + depth * TREE_INDENT }}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
      >
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        {expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
        {/* Счётчик — чипом, а не серой цифрой: он говорит «внутри столько-то»,
            и в свёрнутом виде это единственная подсказка о размере папки. */}
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground">
          {node.count}
        </span>
      </button>
      {expanded && (
        <div className="relative">
          {/* Направляющая: вертикаль от папки к её содержимому. */}
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: 6 + depth * TREE_INDENT + 5 }}
          />
          <FileTree
            nodes={node.children ?? []}
            active={active}
            onPick={onPick}
            depth={depth + 1}
          />
        </div>
      )}
    </>
  );
}

/** Просмотр навыка: инструкция плюс файлы, только чтение.
 *
 *  ОДИН КОМПОНЕНТ НА ОБА ВИДА — коробочный и свой. Для человека это одно и то
 *  же действие: открыть навык и посмотреть, из чего он сделан. Отличаются они
 *  только источником данных и кнопкой в футере («Скопировать» у коробочного,
 *  «Редактировать» у своего), поэтому и то и другое приходит параметрами.
 *
 *  ЗАЧЕМ ОТКРЫВАТЬ КОРОБОЧНЫЙ, который нельзя править: он образец, его берут за
 *  основу своего, и по карточке с описанием этого не понять — рядом лежат
 *  справочные страницы и скрипты, которые делают всю работу.
 *
 *  Файлы грузим ПО ОДНОМУ, по клику: навык — это десятки файлов и сотни
 *  килобайт, тащить их разом значит ждать ради того, что вряд ли откроют. */
/** Просмотр агента — у встроенного и у своего одинаково: полное описание,
 *  модель, навыки и инструкция целиком. Карточка показывает лишь начало
 *  описания, и понять, о чём агент, было негде: встроенный вообще не
 *  открывался. Устроено как просмотр навыка: инструкция во всю высоту,
 *  свойства сбоку, на телефоне — друг под другом. */
function AgentView({
  agent,
  onClose,
  onEdit,
}: {
  agent: Agent;
  onClose: () => void;
  /** Только у своего: у встроенного правки нет. */
  onEdit?: () => void;
}) {
  const t = useT();
  const a = t.agents;
  const cfg = agent.config ?? {};
  const model = cfg.model_id as string | undefined;
  const effort = cfg.effort as EffortLevel | undefined;
  const chip = "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground";

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="size-5 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 truncate text-lg font-semibold">{agent.name}</h2>
        </div>
      }
      className="flex h-[80dvh] w-full max-w-5xl flex-col max-md:h-[calc(100dvh-2rem)] max-md:p-4"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto md:flex-row md:overflow-hidden">
          <div className="flex min-h-[50dvh] min-w-0 flex-1 flex-col gap-1.5 md:min-h-0">
            <span className={LABEL}>{a.fieldPrompt}</span>
            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60 p-4">
              <MessageResponse>{agent.system_prompt}</MessageResponse>
            </div>
          </div>

          <div className="order-first flex shrink-0 flex-col gap-4 md:order-none md:w-72 md:overflow-y-auto md:pr-1">
            {agent.description && (
              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>{a.fieldDescription}</span>
                <p className="text-sm leading-relaxed text-foreground">{agent.description}</p>
              </div>
            )}
            {(model || effort) && (
              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>{a.fieldModel}</span>
                <div className="flex flex-wrap gap-1">
                  {model && <span className={chip}>{model}</span>}
                  {effort && <span className={chip}>{EFFORT_LABELS[effort] ?? effort}</span>}
                </div>
              </div>
            )}
            {agent.skills.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>{a.fieldSkills}</span>
                <div className="flex flex-wrap gap-1">
                  {agent.skills.map((sk) => (
                    <span key={sk} className={chip}>{sk}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {onEdit && (
          <div className="flex shrink-0 justify-end border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Pencil className="size-4" />
              {a.skillEdit}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SkillView({
  title,
  description,
  files,
  readFile,
  onClose,
  action,
}: {
  title: string;
  description?: string;
  /** Пути файлов. null — ещё грузятся. */
  files: string[] | null;
  readFile: (path: string) => Promise<string | null>;
  onClose: () => void;
  /** Кнопка в футере: у коробочного «Скопировать», у своего «Редактировать». */
  action?: { label: string; onClick: () => void; busy?: boolean };
}) {
  const t = useT();
  const a = t.agents;
  const [active, setActive] = React.useState<string>("SKILL.md");
  // Держим ПУТЬ вместе с содержимым, а не отдельный флаг «грузится». Иначе
  // пришлось бы сбрасывать содержимое в эффекте при смене файла — лишний
  // рендер и показ чужого текста в промежутке. Здесь несовпадение `path` с
  // выбранным файлом само значит «ещё не загружено».
  //
  // `text: null` — загружено, но показывать нечего: картинка, архив или файл
  // больше потолка. Это не ошибка, файл остаётся в дереве.
  const [loaded, setLoaded] = React.useState<{ path: string; text: string | null } | null>(
    null,
  );

  React.useEffect(() => {
    let alive = true;
    readFile(active).then((text) => alive && setLoaded({ path: active, text }));
    return () => {
      alive = false;
    };
    // readFile пересоздаётся вызывающим на каждый рендер; завязываться на неё
    // значит перечитывать файл вхолостую. Ключ здесь — путь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, title]);

  const content = loaded?.path === active ? loaded.text : undefined;
  const isMarkdown = active.endsWith(".md");
  const tree = React.useMemo(() => buildTree(files ?? []), [files]);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      className="flex h-[80dvh] w-full max-w-5xl flex-col max-md:h-[calc(100dvh-2rem)] max-md:p-4"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {description && (
          <p className="shrink-0 text-sm text-muted-foreground">{description}</p>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
          <div className="max-h-40 shrink-0 overflow-y-auto rounded-xl border border-border/60 p-1 md:max-h-none md:w-60">
            <FileTree nodes={tree} active={active} onPick={setActive} />
          </div>

          <div className="min-w-0 flex-1 overflow-auto rounded-xl border border-border/60 p-4">
            {content === undefined ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : content === null ? (
              <p className="text-sm text-muted-foreground">{a.skillFileNotShown}</p>
            ) : isMarkdown ? (
              <MessageResponse>{content}</MessageResponse>
            ) : (
              <pre className="overflow-x-auto text-xs leading-relaxed">
                <code>{content}</code>
              </pre>
            )}
          </div>
        </div>

        {/* Действие — в футере, а не в шапке: рядом с крестиком оно читалось бы
            как вторая кнопка того же веса, и выбирать между ним и «закрыть»
            приходилось бы глазами. Футер прибит к низу окна, поэтому кнопка
            видна всегда. */}
        {action && (
          <div className="flex shrink-0 justify-end border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.busy}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {action.busy && <Loader2 className="size-4 animate-spin" />}
              {action.label}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Карточка навыка — и коробочного, и своего.
 *
 *  Один компонент на оба вида намеренно: для человека это один список, и
 *  разделять его на две визуально разные половины значило бы подчёркивать
 *  происхождение навыка вместо того, что он делает. Отличие только в действиях:
 *  коробочный можно читать, свой — править и удалять.
 */
function SkillCard({
  skill,
  onEdit,
  onOpen,
  onView,
  onAdded,
  onDelete,
}: {
  skill: SkillInfo | MySkill;
  onEdit?: (skill: MySkill) => void;
  /** Открыть СВОЙ на чтение — тот же экран, что у коробочного. */
  onOpen?: (skill: MySkill) => void;
  /** Открыть коробочный на чтение: у него есть только имя каталога. */
  onView?: (name: string) => void;
  /** Добавить/убрать из набора ассистента — у ЛЮБОГО навыка каталога. */
  onAdded?: (skill: SkillInfo | MySkill, added: boolean) => void;
  onDelete?: (skill: MySkill) => void;
}) {
  const t = useT();
  const a = t.agents;
  // Свой навык отличается наличием id: у коробочного есть только имя каталога.
  const mine = "id" in skill ? (skill as MySkill) : null;
  // «Добавлен» у своего — enabled, у коробочного — added: одно и то же
  // состояние («в наборе ассистента»), просто хранится в разных местах.
  const added = mine ? mine.enabled : (skill as SkillInfo).added;

  return (
    <div
      className={cn(
        // Кликабельны оба вида и ведут в ОДНО И ТО ЖЕ — просмотр. Раньше свой
        // открывался сразу на правку, и посмотреть его, не рискуя что-то
        // задеть, было нельзя. Правка теперь в карандаше и в самом просмотре.
        // Колонкой и во всю высоту ячейки: в сетке карточки стоят рядом, и
        // без выравнивания действия «плавали» бы по вертикали — у одного
        // навыка описание в две строки, у соседнего в одну.
        // БЕЗ opacity у выключенного: приглушение читалось как «навык хуже»,
        // хотя это просто «не в наборе ассистента» — состояние, а не качество.
        // Что он не добавлен, говорит кнопка «Добавить» в самой карточке.
        "group flex h-full cursor-pointer flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-accent/40",
      )}
      onClick={mine ? () => onOpen?.(mine) : () => onView?.(skill.name)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <SkillIcon
            icon={mine ? "" : (skill as SkillInfo).icon}
            category={skill.category}
            className="size-4"
          />
          <span
            className="truncate text-sm font-medium text-foreground"
          >
            {skill.name}
          </span>
        </div>
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {skill.description}
          </p>
        )}
        {/* Категория — чипом, там же, где у агента модель и глубина: это тоже
            свойство, по которому список фильтруют. */}
        {skill.category && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {skill.category}
            </span>
          </div>
        )}
      </div>

      {/* Действия — ряд ЕСТЬ У КАЖДОЙ карточки (mt-auto прижимает его к низу,
          поэтому карточки в сетке одной высоты): правка и удаление — по
          наведению и только у своих, «Добавить/Убрать» — у всех и видна
          всегда: она и показывает состояние. */}
      <div className="mt-auto flex shrink-0 items-center gap-1 self-end">
        {mine && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(mine);
              }}
              aria-label={a.edit}
              className="rounded-md p-1.5 text-muted-foreground/60 opacity-0 transition [@media(hover:none)]:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(mine);
              }}
              aria-label={a.delete}
              className="rounded-md p-1.5 text-muted-foreground/60 opacity-0 transition [@media(hover:none)]:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
        {/* Одна иконка-кнопка на оба действия, она же показывает состояние:
            серый «+» — не в наборе, зелёная галка — в наборе. Подпись в
            aria-label и title. */}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={added ? a.skillRemove : a.skillAdd}
          title={added ? a.skillRemove : a.skillAdd}
          className={cn(
            added
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onAdded?.(skill, !added);
          }}
        >
          {added ? <Check /> : <Plus />}
        </Button>
      </div>
    </div>
  );
}

/** Управление списком иконками: поиск, категория, сортировка, «Мои».
 *
 *  Всё компактное и в один ряд со вкладками — это вспомогательные переключатели,
 *  и подписи у каждого занимали бы больше места, чем сам список.
 *
 *  Категории приходят ИЗ ДАННЫХ (поле category в SKILL.md), здесь не
 *  перечисляются: новый навык с новой категорией появляется в фильтре сам.
 */
function ListControls({
  query,
  onQuery,
  mineOnly,
  onMineOnly,
  categories,
  category,
  onCategory,
  sort,
  onSort,
}: {
  query: string;
  onQuery: (v: string) => void;
  mineOnly: boolean;
  onMineOnly: (v: boolean) => void;
  categories: string[];
  category: string | null;
  onCategory: (v: string | null) => void;
  sort: SortMode;
  onSort: (v: SortMode) => void;
}) {
  const t = useT();
  const a = t.agents;
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [menu, setMenu] = React.useState<null | "category" | "sort">(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Кнопка-иконка: подсвечена, когда фильтр применён — иначе неясно, почему
  // список короче, чем ожидалось.
  const iconBtn = (active: boolean) =>
    cn(
      "flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
      active
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:text-foreground",
    );

  const menuItem = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        onClick();
        setMenu(null);
      }}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent",
        active ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      {active && <Check className="size-3.5 shrink-0 text-primary" />}
    </button>
  );

  return (
    // На телефоне — своим рядом ПОД вкладками: первый ряд отдан вкладкам и
    // «+» справа, как у кнопки создания на десктопе.
    <div ref={rootRef} className="flex items-center gap-1.5 max-sm:order-last max-sm:w-full">
      {searchOpen ? (
        <div className="relative w-44">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              onQuery("");
              setSearchOpen(false);
            }}
            // Пустое поле схлопываем при потере фокуса; непустое оставляем —
            // иначе непонятно, почему список отфильтрован.
            onBlur={() => !query && setSearchOpen(false)}
            placeholder={a.searchPlaceholder}
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSearchOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label={a.searchPlaceholder}
          title={a.searchPlaceholder}
          className={iconBtn(Boolean(query))}
        >
          <Search className="size-4" />
        </button>
      )}

      {categories.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu(menu === "category" ? null : "category")}
            aria-label={a.filterAll}
            title={category ?? a.filterAll}
            className={iconBtn(category !== null)}
          >
            <SlidersHorizontal className="size-4" />
          </button>
          {menu === "category" && (
            <div className="absolute left-0 z-50 mt-1.5 w-52 rounded-lg border border-border/80 bg-popover p-1 shadow-md">
              {menuItem(category === null, a.filterAll, () => onCategory(null))}
              {categories.map((c) => menuItem(category === c, c, () => onCategory(c)))}
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenu(menu === "sort" ? null : "sort")}
          aria-label={a.sortLabel}
          title={a.sortLabel}
          className={iconBtn(sort !== "name")}
        >
          <ArrowUpDown className="size-4" />
        </button>
        {menu === "sort" && (
          <div className="absolute left-0 z-50 mt-1.5 w-44 rounded-lg border border-border/80 bg-popover p-1 shadow-md">
            {menuItem(sort === "name", a.sortName, () => onSort("name"))}
            {menuItem(sort === "recent", a.sortRecent, () => onSort("recent"))}
          </div>
        )}
      </div>

      {/* «Мои» — не категория, а другой вопрос: «что тут моё». Поэтому свой
          переключатель, а не пункт в фильтре. */}
      <button
        type="button"
        onClick={() => onMineOnly(!mineOnly)}
        aria-pressed={mineOnly}
        aria-label={a.filterMine}
        title={a.filterMine}
        className={iconBtn(mineOnly)}
      >
        <UserRound className="size-4" />
      </button>
    </div>
  );
}

export function AgentsScreen({
  onBackChange,
  onAskAssistant,
}: {
  /** Сообщить хедеру воркспейса текущий обработчик «назад» (или null на списке).
   *  Хедер рисует иконку ← и зовёт этот колбэк — как в разделе задач. */
  onBackChange?: (back: (() => void) | null) => void;
  /** Открыть новый чат и отправить туда заготовку — путь «с помощью ассистента».
   *  Раздел сам чат не знает: он только говорит, с чего начать разговор. */
  onAskAssistant?: (opener: string) => void;
}) {
  const t = useT();
  const a = t.agents;
  const { locale } = useLocale();
  const api = useAgentLibrary();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Agent | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Удаление спрашиваем: вместе с агентом уходит его память, и вернуть нечем.
  const [deleting, setDeleting] = React.useState<Agent | null>(null);
  const [viewingAgent, setViewingAgent] = React.useState<Agent | null>(null);
  const [tab, setTab] = React.useState<"agents" | "skills" | "connectors">("agents");
  // Окно «Свой сервер» на вкладке коннекторов: кнопка стоит в шапке раздела.
  const [customConnector, setCustomConnector] = React.useState(false);

  // Поиск, фильтры и сортировка — ОБЩИЕ для вкладок, а не свои у каждой:
  // человек ищет одинаково, и сброшенный при переключении запрос выглядел бы
  // как потеря ввода.
  const [query, setQuery] = React.useState("");
  const [mineOnly, setMineOnly] = React.useState(false);
  const [category, setCategory] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<SortMode>("name");

  // Коробочные и свои приходят из РАЗНЫХ ручек: у первых нет владельца и их
  // нельзя править, у вторых есть и то и другое. В списке они всё равно вместе —
  // для человека это один вид вещей, отличается только что с ними можно делать.
  const [builtinSkills, setBuiltinSkills] = React.useState<SkillInfo[] | null>(null);
  const [mySkills, setMySkills] = React.useState<MySkill[] | null>(null);
  // `fromView` — форму открыли из просмотра навыка, и туда же надо вернуться
  // после сохранения. Карандаш в списке этого флага не ставит: там просмотра не
  // было, и возврат в него был бы неожиданным.
  const [skillForm, setSkillForm] = React.useState<
    { skill: MySkill | null; fromView?: boolean } | null
  >(null);
  const [skillError, setSkillError] = React.useState<string | null>(null);
  const [deletingSkill, setDeletingSkill] = React.useState<MySkill | null>(null);
  // Открытый на просмотр коробочный — имя каталога. Своя ветка, а не skillForm:
  // тот про правку, а этот только читает.
  const [viewingBuiltin, setViewingBuiltin] = React.useState<string | null>(null);
  // Просмотр открыт ИЗ ФОРМЫ АГЕНТА — тогда он только на чтение: копировать и
  // править отсюда нельзя, человек настраивает агента, а не библиотеку.
  const [builtinReadOnly, setBuiltinReadOnly] = React.useState(false);
  // Свой навык на просмотре. Держим объект целиком, а не id: тело инструкции
  // уже пришло со списком, и перезапрашивать его ради показа незачем.
  const [viewingMine, setViewingMine] = React.useState<MySkill | null>(null);
  // Храним id ВМЕСТЕ со списком: иначе при смене навыка пришлось бы сбрасывать
  // состояние в теле эффекта (лишний рендер и чужие файлы в промежутке).
  // Несовпадение id с открытым навыком само значит «ещё не загружено».
  const [mineFiles, setMineFiles] = React.useState<
    { id: string; files: string[] } | null
  >(null);

  // Список файлов своего навыка — для дерева в просмотре. Тело SKILL.md лежит
  // в самом навыке, а файлы в S3, поэтому их читаем отдельно.
  React.useEffect(() => {
    if (!viewingMine) return;
    let alive = true;
    const id = viewingMine.id;
    fetchMySkillFiles(id).then((files) => alive && setMineFiles({ id, files }));
    return () => {
      alive = false;
    };
  }, [viewingMine]);

  // То же для коробочного: его состав приходит одним запросом вместе с
  // описанием (файлы лежат в образе, а не в БД).
  const [builtinDetail, setBuiltinDetail] = React.useState<SkillDetail | null>(null);

  React.useEffect(() => {
    if (!viewingBuiltin) return;
    let alive = true;
    fetchSkillDetail(viewingBuiltin).then((d) => alive && setBuiltinDetail(d));
    return () => {
      alive = false;
    };
  }, [viewingBuiltin]);
  const [forking, setForking] = React.useState(false);

  // Коннекторы грузим здесь, а не в панели: по ним работают те же поиск,
  // «Мои» и сортировка, что и по агентам с навыками, и общий поиск их тоже
  // показывает.
  const [connectors, setConnectors] = React.useState<ConnectorInfo[] | null>(null);
  const reloadConnectors = React.useCallback(() => {
    fetchConnectors().then(setConnectors);
  }, []);
  React.useEffect(reloadConnectors, [reloadConnectors]);

  const reloadMySkills = React.useCallback(async () => {
    setMySkills(await fetchMySkills());
  }, []);

  // «Добавить/Убрать» из набора ассистента — оптимистично, кнопка должна
  // отвечать сразу. Свой навык — это его enabled, коробочный — added
  // (user_skills_off на бэке); состояние одно, хранится в разных местах.
  const setSkillAdded = React.useCallback(
    async (sk: SkillInfo | MySkill, added: boolean) => {
      if ("id" in sk) {
        setMySkills((prev) =>
          (prev ?? []).map((x) => (x.id === sk.id ? { ...x, enabled: added } : x)),
        );
        const res = await updateMySkill(sk.id, { enabled: added });
        if (res.error) await reloadMySkills();
        return;
      }
      setBuiltinSkills((prev) =>
        (prev ?? []).map((x) => (x.name === sk.name ? { ...x, added } : x)),
      );
      if (!(await patchBuiltinSkill(sk.name, added))) {
        setBuiltinSkills(await fetchSkillsCatalog());
      }
    },
    [reloadMySkills],
  );

  React.useEffect(() => {
    let alive = true;
    fetchSkillsCatalog().then((list) => alive && setBuiltinSkills(list));
    fetchMySkills().then((list) => alive && setMySkills(list));
    return () => {
      alive = false;
    };
  }, []);

  // Свои ПЕРВЫМИ: человек пришёл в раздел за тем, что завёл сам, а коробочные
  // он уже видел. Внутри каждой половины — общая сортировка.
  const skills = React.useMemo<Array<SkillInfo | MySkill> | null>(
    () =>
      builtinSkills === null || mySkills === null
        ? null
        : [...mySkills, ...builtinSkills],
    [builtinSkills, mySkills],
  );

  const q = query.trim().toLowerCase();
  const hit = (...fields: Array<string | undefined>) =>
    !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

  // Категории — ИЗ ДАННЫХ, а не из списка в коде: их задают сами навыки полем
  // category, и новая категория должна появиться в фильтре сама.
  const categories = React.useMemo(
    () =>
      Array.from(new Set((skills ?? []).map((s) => s.category).filter(Boolean))).sort(),
    [skills],
  );

  // «Мои» = созданное мной или включённое мной.
  const visibleAgents = React.useMemo(() => {
    let list = (api.agents ?? []).filter((ag) => hit(ag.name, ag.description));
    if (mineOnly) list = list.filter((ag) => ag.editable || ag.enabled);
    // Категория задаётся навыками; у агентов её нет, поэтому выбранная
    // категория прячет агентов целиком, а не показывает их вперемешку.
    if (category) list = [];
    return [...list].sort((x, y) =>
      sort === "name"
        ? x.name.localeCompare(y.name)
        : (y.created_at ?? "").localeCompare(x.created_at ?? ""),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.agents, q, mineOnly, category, sort]);

  const visibleSkills = React.useMemo(() => {
    let list = (skills ?? []).filter((s) => hit(s.name, s.description, s.category));
    if (category) list = list.filter((s) => s.category === category);
    // «Мои» у навыков теперь значит именно своё: у коробочного нет id.
    if (mineOnly) list = list.filter((s) => "id" in s);
    // Сортировка ОБЩАЯ с агентами, но «сначала новые» имеет смысл только для
    // своих: у коробочных даты нет, они уезжают в конец и держат порядок имён.
    return [...list].sort((x, y) => {
      if (sort === "recent") {
        const dx = "created_at" in x ? (x.created_at ?? "") : "";
        const dy = "created_at" in y ? (y.created_at ?? "") : "";
        if (dx !== dy) return dy.localeCompare(dx);
      }
      return x.name.localeCompare(y.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, q, mineOnly, category, sort]);

  // «Мои» у коннекторов — подключённые и свои серверы: то, чем человек уже
  // пользуется. «Сначала новые» — по времени подключения, у остальных даты
  // нет, они держат порядок имён.
  const visibleConnectors = React.useMemo(() => {
    let list = (connectors ?? []).filter((c) =>
      hit(c.title, connectorSummary(c, locale), c.url ?? undefined),
    );
    if (mineOnly) list = list.filter((c) => c.connected || c.custom);
    if (category) list = [];
    return [...list].sort((x, y) => {
      if (sort === "recent") {
        const dx = x.connected ? (x.updated_at ?? "") : "";
        const dy = y.connected ? (y.updated_at ?? "") : "";
        if (dx !== dy) return dy.localeCompare(dx);
      }
      return x.title.localeCompare(y.title);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectors, q, mineOnly, category, sort, locale]);

  const submitSkill = async (body: MySkillInput, files: File[] = []) => {
    if (!skillForm) return;
    const creating = skillForm.skill === null;
    setBusy(true);
    setSkillError(null);
    const res = creating
      ? await createMySkill(body)
      : await updateMySkill(skillForm.skill!.id, body);
    if (res.error) {
      setBusy(false);
      setSkillError(res.error);
      return;
    }
    // Файлы, приложенные до создания, отправляем ТОЛЬКО ТЕПЕРЬ: до этого у
    // навыка не было слага, а они кладутся под него. Неудачу загрузки не
    // считаем провалом сохранения — навык уже создан, и терять из-за одного
    // файла введённый текст инструкции было бы хуже.
    if (creating && files.length > 0 && res.skill) {
      await uploadMySkillFiles(res.skill.id, files);
    }
    setBusy(false);
    await reloadMySkills();
    setSkillForm(null);
    // ПРАВКА ВОЗВРАЩАЕТ В ПРОСМОТР, из которого пришли: человек нажал
    // «Редактировать» на открытом навыке, и выкидывать его в список после
    // сохранения значит терять место, где он был. Показываем сохранённое —
    // res.skill, а не старый объект: иначе в просмотре осталось бы то, что он
    // только что переписал.
    //
    // При СОЗДАНИИ возвращаться некуда: просмотра не было, и открывать его
    // вместо списка означало бы навязать лишний экран.
    if (skillForm.fromView && res.skill) setViewingMine(res.skill);
  };

  React.useEffect(() => {
    const back = formOpen
      ? () => {
          setFormOpen(false);
          setEditing(null);
        }
      : skillForm
        ? () => {
            setSkillForm(null);
            setSkillError(null);
          }
        : null;
    onBackChange?.(back);
    return () => onBackChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, skillForm]);

  const submit = async (body: AgentInput) => {
    setBusy(true);
    const ok = editing
      ? await api.update(editing.id, body)
      : await api.create(body);
    setBusy(false);
    if (ok) {
      setFormOpen(false);
      setEditing(null);
    }
  };

  // Пустой список (ничего не найдено, «Мои» без подключённых): карточек нет,
  // но окно «Свой сервер» из шапки должно открываться — панель без разделов
  // рисует только его.
  const customConnectorDialog = (
    <ConnectorsPanel
      items={connectors ?? []}
      sections={[]}
      onChanged={reloadConnectors}
      customOpen={customConnector}
      onCustomOpenChange={setCustomConnector}
    />
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full flex-col gap-5 p-4 sm:p-6">
        {/* Один ряд: разделы, управление списком, кнопка создания. Заголовка
            здесь НЕТ — его рисует хедер воркспейса. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {([
              ["agents", a.tabAgents],
              ["skills", a.tabSkills],
              ["connectors", a.tabConnectors],
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

          <ListControls
            query={query}
            onQuery={setQuery}
            mineOnly={mineOnly}
            onMineOnly={setMineOnly}
            categories={categories}
            category={category}
            onCategory={setCategory}
            sort={sort}
            onSort={setSort}
          />

          <div className="ml-auto shrink-0">
            {tab === "agents" ? (
              <CreateButton
                label={a.create}
                manual={{ label: a.createManual, hint: a.createManualHint }}
                assisted={{ label: a.createWithAssistant, hint: a.createWithAssistantHint }}
                onManual={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                onAssisted={() => onAskAssistant?.(a.assistantOpener)}
              />
            ) : tab === "skills" ? (
              // Та же развилка, что у агентов, и тем же компонентом: форма
              // требует заранее знать процедуру, а разговор её вырабатывает —
              // причём у навыка второй путь встречается чаще, потому что
              // навык обычно пишется по следам только что сделанной работы.
              <CreateButton
                label={a.createSkill}
                manual={{ label: a.createManual, hint: a.createManualHint }}
                assisted={{ label: a.createWithAssistant, hint: a.createWithAssistantHint }}
                onManual={() => {
                  setSkillError(null);
                  setSkillForm({ skill: null });
                }}
                onAssisted={() => onAskAssistant?.(a.skillAssistantOpener)}
              />
            ) : (
              // У коннектора один путь — форма; тот же вид кнопки, что у
              // «Создать», но без меню выбора.
              <button
                type="button"
                onClick={() => setCustomConnector(true)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 max-sm:size-8 max-sm:justify-center max-sm:p-0"
              >
                <Plus className="size-4" />
                <span className="max-sm:sr-only">{t.connectors.custom}</span>
              </button>
            )}
          </div>
        </div>

        {/* ПОИСК ГЛОБАЛЬНЫЙ: пока есть запрос, вкладка не важна — показываем
            всё найденное одним списком с заголовками по типу. Иначе человек
            искал бы «pdf» на вкладке агентов и не узнал, что есть такой навык. */}
        {q ? (
          visibleAgents.length === 0 && visibleSkills.length === 0 && visibleConnectors.length === 0 ? (
            <>
              <div className="rounded-xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
                {a.nothingFound}
              </div>
              {customConnectorDialog}
            </>
          ) : (
            <div className="flex flex-col gap-5">
              {visibleAgents.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {a.groupAgents}
                  </h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleAgents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onOpen={() => setViewingAgent(agent)}
                      onEdit={() => {
                        setEditing(agent);
                        setFormOpen(true);
                      }}
                      onToggle={(enabled) => void api.toggle(agent.id, enabled)}
                      onDelete={() => setDeleting(agent)}
                      onConnectionsChanged={() => {
                        invalidateAgents();
                        void api.refresh();
                      }}
                    />
                  ))}
                  </div>
                </div>
              )}
              {visibleSkills.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {a.groupSkills}
                  </h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleSkills.map((sk) => (
                    <SkillCard
                  key={"id" in sk ? sk.id : `builtin:${sk.name}`}
                  skill={sk}
                  onOpen={setViewingMine}
                  onEdit={(target) => {
                    setSkillError(null);
                    setSkillForm({ skill: target });
                  }}
                  onView={setViewingBuiltin}
                  onAdded={setSkillAdded}
                  onDelete={setDeletingSkill}
                />
                  ))}
                  </div>
                </div>
              )}
              {/* Всегда в дереве: пустой раздел не рисуется, а окно «Свой
                  сервер» из шапки должно открываться и во время поиска. */}
              <ConnectorsPanel
                items={connectors ?? []}
                sections={[{ title: a.groupConnectors, items: visibleConnectors }]}
                onChanged={reloadConnectors}
                customOpen={customConnector}
                onCustomOpenChange={setCustomConnector}
              />
            </div>
          )
        ) : tab === "connectors" ? (
          connectors === null ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t.files.loading}
            </div>
          ) : visibleConnectors.length === 0 ? (
            <>
              <div className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
                {a.nothingFound}
              </div>
              {customConnectorDialog}
            </>
          ) : (
            <ConnectorsPanel
              items={connectors}
              sections={[
                { title: a.groupConnectorsMine, items: visibleConnectors.filter((c) => c.custom) },
                { title: a.groupLibrary, items: visibleConnectors.filter((c) => !c.custom) },
              ]}
              onChanged={reloadConnectors}
              customOpen={customConnector}
              onCustomOpenChange={setCustomConnector}
            />
          )
        ) : tab === "skills" ? (
          skills === null ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t.files.loading}
            </div>
          ) : visibleSkills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
              {skills.length === 0 ? a.skillsEmpty : a.nothingFound}
            </div>
          ) : (
            /* ДВА РАЗДЕЛА вместо одной сетки: свои навыки и коробочные —
               разные вещи (свои правятся и удаляются, коробочные только
               читаются). Свои — «Мои навыки», встроенные — «Библиотека». */
            <div className="flex flex-col gap-6">
              {([
                [a.groupSkillsMine, visibleSkills.filter((sk) => "id" in sk)],
                [a.groupLibrary, visibleSkills.filter((sk) => !("id" in sk))],
              ] as const).map(([title, items]) =>
                items.length === 0 ? null : (
                  <div key={title ?? "builtin"} className="flex flex-col gap-2">
                    {title && (
                      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {title}
                      </h2>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {items.map((sk) => (
                        <SkillCard
                          key={"id" in sk ? sk.id : `builtin:${sk.name}`}
                          skill={sk}
                          onOpen={setViewingMine}
                          onEdit={(target) => {
                            setSkillError(null);
                            setSkillForm({ skill: target });
                          }}
                          onView={setViewingBuiltin}
                          onAdded={setSkillAdded}
                          onDelete={setDeletingSkill}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          )
        ) : !api.loaded ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t.files.loading}
          </div>
        ) : visibleAgents.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            {api.agents.length === 0 ? a.empty : a.nothingFound}
          </div>
        ) : (
          /* Как у навыков: «Мои агенты» и «Библиотека». */
          <div className="flex flex-col gap-6">
            {([
              [a.groupAgentsMine, visibleAgents.filter((ag) => ag.editable)],
              [a.groupLibrary, visibleAgents.filter((ag) => !ag.editable)],
            ] as const).map(([title, items]) =>
              items.length === 0 ? null : (
                <div key={title ?? "builtin"} className="flex flex-col gap-2">
                  {title && (
                    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {title}
                    </h2>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((agent) => (
                      <AgentCard
                      key={agent.id}
                      agent={agent}
                      onOpen={() => setViewingAgent(agent)}
                      onEdit={() => {
                        setEditing(agent);
                        setFormOpen(true);
                      }}
                      onToggle={(enabled) => void api.toggle(agent.id, enabled)}
                      onDelete={() => setDeleting(agent)}
                      onConnectionsChanged={() => {
                        invalidateAgents();
                        void api.refresh();
                      }}
                    />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={a.deleteTitle}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            {a.deleteConfirm(deleting?.name ?? "")}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                if (target) void api.remove(target.id);
              }}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
            >
              {a.delete}
            </button>
            <button
              type="button"
              onClick={() => setDeleting(null)}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {a.cancel}
            </button>
          </div>
        </div>
      </Modal>

      {viewingAgent && (
        <AgentView
          agent={viewingAgent}
          onClose={() => setViewingAgent(null)}
          onEdit={
            viewingAgent.editable
              ? () => {
                  const target = viewingAgent;
                  setViewingAgent(null);
                  setEditing(target);
                  setFormOpen(true);
                }
              : undefined
          }
        />
      )}

      {/* Форма агента — поверх списка, как и всё остальное в разделе. Раньше
          она подменяла экран целиком, и раздел за ней исчезал. */}
      {formOpen && (
        <AgentForm
          agent={editing}
          busy={busy}
          onSubmit={submit}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onPreviewSkill={(n) => {
            setBuiltinReadOnly(true);
            setViewingBuiltin(n);
          }}
        />
      )}

      {/* Форма своего навыка — тоже поверх списка, как и просмотр: раздел
          остаётся на месте, и после сохранения возвращаться некуда. */}
      {skillForm && (
        <SkillForm
          skill={skillForm.skill}
          busy={busy}
          error={skillError}
          onSubmit={submitSkill}
          onCancel={() => {
            // Отмена возвращает туда же, откуда пришли, — как и сохранение.
            if (skillForm.fromView && skillForm.skill) setViewingMine(skillForm.skill);
            setSkillForm(null);
            setSkillError(null);
          }}
        />
      )}

      {/* Просмотр СВОЕГО навыка — тот же экран, что у коробочного: человек
          открывает навык, чтобы посмотреть, из чего он сделан, и происхождение
          тут ничего не меняет. Отличие одно — кнопка ведёт в правку, а не в
          копирование. */}
      {viewingMine && (
        <SkillView
          title={viewingMine.name}
          description={viewingMine.description}
          // SKILL.md не лежит в S3 — его тело хранится в самом навыке, поэтому
          // подставляем его в дерево первым, как у коробочного.
          files={
            mineFiles?.id === viewingMine.id
              ? ["SKILL.md", ...mineFiles.files]
              : null
          }
          readFile={(path) =>
            path === "SKILL.md"
              ? Promise.resolve(viewingMine.body)
              : fetchMySkillFile(viewingMine.id, path)
          }
          onClose={() => setViewingMine(null)}
          action={{
            label: a.skillEdit,
            onClick: () => {
              setViewingMine(null);
              setSkillError(null);
              setSkillForm({ skill: viewingMine, fromView: true });
            },
          }}
        />
      )}

      {/* Просмотр коробочного навыка. Рендерится ПОВЕРХ списка, а не вместо
          него: заглянуть внутрь и вернуться — не повод терять раздел. */}
      {viewingBuiltin && (
        <SkillView
          title={viewingBuiltin}
          description={
            builtinDetail?.name === viewingBuiltin ? builtinDetail.description : undefined
          }
          files={
            builtinDetail?.name === viewingBuiltin ? builtinDetail.files : null
          }
          readFile={(path) => fetchSkillFile(viewingBuiltin, path)}
          onClose={() => {
            setViewingBuiltin(null);
            setBuiltinReadOnly(false);
          }}
          action={builtinReadOnly ? undefined : {
            label: a.skillFork,
            busy: forking,
            onClick: async () => {
              // Повторный клик игнорируем: копирование идёт секунды, и второе
              // нажатие завело бы второй навык — «docx-2», «docx-3».
              if (forking) return;
              setForking(true);
              try {
                if (!(await forkBuiltinSkill(viewingBuiltin))) return;
                await reloadMySkills();
                // Просто закрываем просмотр. Открывать следом форму правки
                // нельзя: два окна подряд читаются как дёрганье, а человек
                // просил скопировать, а не редактировать. Копия ждёт его в
                // списке — там же, где он её и будет искать.
                setViewingBuiltin(null);
              } finally {
                // ОБЯЗАТЕЛЬНО в finally. Раньше сброс стоял после await, и
                // любое исключение (разбор ответа, обрыв сети) оставляло
                // спиннер крутиться навсегда — при том что навык на сервере
                // уже создан.
                setForking(false);
              }
            },
          }}
        />
      )}

      {/* Своя модалка, а не общая с агентами: текст предупреждения разный.
          У агента уходит память, у навыка — скрипты и шаблоны. */}
      <Modal
        open={deletingSkill !== null}
        onClose={() => setDeletingSkill(null)}
        title={a.delete}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            {a.skillDeleteConfirm(deletingSkill?.name ?? "")}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const target = deletingSkill;
                setDeletingSkill(null);
                if (!target) return;
                await deleteMySkill(target.id);
                await reloadMySkills();
              }}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
            >
              {a.delete}
            </button>
            <button
              type="button"
              onClick={() => setDeletingSkill(null)}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {a.cancel}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
