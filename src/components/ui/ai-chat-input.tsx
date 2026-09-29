"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Mic, Paperclip, ArrowUp, Square, Loader2, Check, Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AttachmentChip } from "@/components/chat/attachment-chip";
import { ContextMeter } from "@/components/chat/context-meter";
import {
  PASTED_TEXT_MARKER,
  PASTED_TEXT_MARKER_END,
  pastePreview,
} from "@/lib/chat-streams";
import { useT } from "@/i18n/i18n-context";
import type { AttachmentsApi, UploadedAttachment } from "@/hooks/use-attachments";
import { useAgentModel, useAgents } from "@/hooks/use-agents";
import { useModels } from "@/hooks/use-models";
import {
  fetchAgents,
  listSpaceAgents,
  listSpaces,
  type Agent,
  type Space,
} from "@/lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Порог вставки: текст длиннее — превращаем в чип-вложение (как ChatGPT), чтобы
// не забивать инпут портянкой. Модель всё равно получит его как обычный текст.
const PASTE_AS_ATTACHMENT_CHARS = 1500;
// Attachment/MAX_FILE_BYTES + логика вложений живут в useAttachments (владелец —
// чат, чтобы drag&drop работал по всей области). Инпут получает их пропсом.

export type EffortLevel = "low" | "medium" | "high" | "max";

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

export const EFFORT_ORDER: EffortLevel[] = ["low", "medium", "high", "max"];

// Модель чата — идентификатор из реестра бэкенда (AVY_LLM_MODELS), а не
// прошитый набор. Список и умолчание отдаёт /api/models (hooks/use-models.ts):
// в локальной сборке модель развёрнута в контуре и называется так, как её
// назвал администратор; прошитые здесь «Enso»/«Gaia» показывали модели,
// которых у человека нет, а бэкенд молча подменял их дефолтом.
export type ChatModelId = string;

/** Выбор АГЕНТА из библиотеки.
 *
 *  Пришёл на место кнопки «Глубокое исследование»: исследователь перестал быть
 *  режимом и стал обычной записью в библиотеке, а рядом с ним встают
 *  остальные — коробочные и пользовательские. Пустой выбор = универсальный
 *  агент, то есть прежнее поведение чата.
 *
 *  Устроен как ModelDropdown ниже: тот же портал, то же закрытие по клику вне.
 */
function AgentDropdown({
  agentId,
  onAgentChange,
  onSpacePick,
  activeSpaceId,
  onSpaceClear,
  locked,
}: {
  agentId?: string | null;
  onAgentChange?: (id: string | null) => void;
  /** Новый чат в пространстве: клик по имени — универсальный ассистент,
   *  пункт подменю — агент его команды. */
  onSpacePick?: (spaceId: string, agentId: string | null) => void;
  /** Пространство АКТИВНОГО чата — капсула обязана показывать, где работает
   *  пользователь, а не молча перекидывать. */
  activeSpaceId?: string | null;
  /** Сброс выбранного пространства: строки «по умолчанию» нет, повторный
   *  клик по активному — и есть возврат к умолчанию (как у агентов). */
  onSpaceClear?: () => void;
  /** Сессия уже началась: режим ЗАФИКСИРОВАН — капсула только показывает,
   *  где идёт работа. Смена агента/пространства посреди сессии — билеберда:
   *  контекст, облако и промпт уже принадлежат выбранному режиму. */
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { agents } = useAgents();
  const t = useT();

  // Пространства — секция на месте бывшего «По умолчанию». Грузим один раз:
  // список короткий и меняется редко.
  //
  // Зависимость — ФАКТ наличия колбэка, а не сам колбэк: родитель передаёт
  // его стрелкой, новой на каждый рендер, и эффект с `[onSpacePick]` стрелял
  // на каждую перерисовку. Во время стрима чат перерисовывается на каждый
  // кадр — на проде 21.09 это дало до 1000 GET /api/spaces в минуту, вкладка
  // захлёбывалась и не успевала открыть ленты субагентов («карточки встали»).
  const [spaces, setSpaces] = useState<Space[]>([]);
  const wantSpaces = !!onSpacePick;
  useEffect(() => {
    let alive = true;
    if (wantSpaces) listSpaces().then((ss) => alive && setSpaces(ss));
    return () => { alive = false; };
  }, [wantSpaces]);
  // Команды пространств — по наведению, с кэшем. Резолвим по ПОЛНОЙ
  // библиотеке (fetchAgents без only_enabled), а не по useAgents: тот отдаёт
  // только включённых, и агент команды, ещё не включённый в «Моих агентах»,
  // молча выпадал из подменю (ловили на «Сборщике дайджеста»).
  const [teams, setTeams] = useState<Record<string, Agent[]>>({});
  const allAgentsRef = useRef<Promise<Agent[]> | null>(null);
  const allAgents = () =>
    (allAgentsRef.current ??= fetchAgents().catch(() => []));
  const [hovered, setHovered] = useState<{ id: string; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) { setOpen(false); setHovered(null); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Команды всех пространств — на открытие меню, не по наведению: стрелка у
  // строки должна честно говорить, есть ли у пространства агенты, ДО ховера.
  useEffect(() => {
    if (!open || spaces.length === 0) return;
    const missing = spaces.filter((sp) => !(sp.id in teams));
    if (missing.length === 0) return;
    void allAgents().then(async (all) => {
      for (const sp of missing) {
        const ids = await listSpaceAgents(sp.id).catch(() => []);
        setTeams((prev) =>
          sp.id in prev
            ? prev
            : {
                ...prev,
                [sp.id]: ids
                  .map((id) => all.find((a) => a.id === id))
                  .filter((a): a is Agent => a != null),
              },
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spaces]);

  // Ни агентов, ни пространств — капсулы нет вовсе: выбирать не из чего,
  // а мёртвый элемент только мешает.
  if (agents.length === 0 && spaces.length === 0) return null;

  // Агент ищется и в командах: агент команды может быть выключен в библиотеке
  // (useAgents отдаёт только включённых), но выбранный режим обязан быть виден.
  const active =
    agents.find((a) => a.id === agentId)
    ?? Object.values(teams).flat().find((a) => a.id === agentId)
    ?? null;
  // Пространство активного чата: капсула показывает, ГДЕ работает пользователь.
  const activeSpace = spaces.find((s) => s.id === activeSpaceId) ?? null;
  const label = active && activeSpace
    ? `${activeSpace.name} · ${active.name}`
    : active?.name ?? activeSpace?.name ?? t.input.agentPick;

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Сессия началась — режим не переключается, капсула лишь показывает его.
    if (locked) return;
    // Режим активен — клик по капсуле СБРАСЫВАЕТ его к умолчанию (строки
    // «по умолчанию» в списке нет, это и есть выключатель). Следующий клик
    // по уже неактивной капсуле открывает меню как обычно.
    if (active || activeSpace) {
      if (activeSpace) onSpaceClear?.();
      if (active) onAgentChange?.(null);
      setOpen(false);
      setHovered(null);
      return;
    }
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top - 4, left: r.left });
    setOpen((v) => !v);
    setHovered(null);
  };

  const pick = (id: string | null) => {
    onAgentChange?.(id);
    setOpen(false);
    setHovered(null);
  };

  const pickSpace = (spaceId: string, teamAgentId: string | null) => {
    // Повторный клик по активному пространству — сброс к умолчанию (как
    // повторный клик по активному агенту).
    if (spaceId === activeSpaceId && !teamAgentId) onSpaceClear?.();
    else onSpacePick?.(spaceId, teamAgentId);
    setOpen(false);
    setHovered(null);
  };

  const hoverSpace = (spaceId: string, rowTop: number) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Команды загружены на открытии меню; ховер только позиционирует подменю.
    setHovered({ id: spaceId, top: rowTop });
  };

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(null), 150);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onMouseDown={handleOpen}
        title={active?.description || activeSpace?.description || t.input.agentPick}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
          active || activeSpace
            ? "bg-accent text-accent-foreground outline outline-ring/60"
            : "bg-muted text-muted-foreground"
        } ${locked ? "cursor-default" : "hover:bg-accent hover:text-accent-foreground"}`}
      >
        {label}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
          className="z-[9999] max-h-[60vh] w-[320px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {/* Пространства — на месте бывшего «По умолчанию»: строки «по
              умолчанию» больше нет, невыбранный режим и ЕСТЬ умолчание
              (снять агента — повторный клик по нему). Клик по имени
              пространства — новый чат в нём с универсальным ассистентом,
              наведение — выбор агента команды. */}
          {spaces.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t.input.spacesGroup}
              </div>
              {spaces.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onMouseDown={(e) => { e.stopPropagation(); pickSpace(sp.id, null); }}
                  onMouseEnter={(e) =>
                    hoverSpace(sp.id, e.currentTarget.getBoundingClientRect().top)
                  }
                  onMouseLeave={scheduleClose}
                  className={`flex w-full items-center gap-1 rounded-md px-3 py-2 text-left text-sm transition hover:bg-accent ${
                    hovered?.id === sp.id || activeSpaceId === sp.id
                      ? "bg-accent/60"
                      : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{sp.name}</span>
                  {/* Стрелка только у пространств С КОМАНДОЙ: без агентов
                      подменю нет — клик сразу открывает сессию. */}
                  {(teams[sp.id]?.length ?? 0) > 0 && (
                    <span className="shrink-0 text-muted-foreground/60">›</span>
                  )}
                </button>
              ))}
              {agents.length > 0 && <div className="my-1 h-px bg-border" />}
            </>
          )}
          {agents.map((a) => (
            <div
              key={a.id}
              className={`flex items-center gap-1 rounded-md pr-1 transition hover:bg-accent ${
                active?.id === a.id ? "bg-accent/60" : ""
              }`}
            >
              <button
                type="button"
                // Повторный клик по активному — снять выбор: явной строки
                // «по умолчанию» в списке больше нет.
                onMouseDown={(e) => {
                  e.stopPropagation();
                  pick(a.id === active?.id ? null : a.id);
                }}
                className="flex min-w-0 flex-1 items-center px-3 py-2 text-left text-sm"
              >
                <span className="truncate font-medium">{a.name}</span>
              </button>
              {/* Описание — под «i», а не строкой под именем. В списке из
                  десятка агентов описания превращают меню в простыню, а нужны
                  они редко: имя обычно говорит само за себя. */}
              {a.description && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        className="flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/60 transition hover:bg-muted hover:text-foreground"
                        // Клик по «i» не должен выбирать агента — только
                        // показывать описание.
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Info size={13} />
                      </span>
                    }
                  />
                  {/* Выше меню: оно в своём портале с z-9999, а подсказка по
                      умолчанию z-50 — иначе всплыла бы ПОД списком. */}
                  <TooltipContent
                    side="right"
                    className="max-w-[260px] whitespace-normal"
                    positionerClassName="z-[10000]"
                  >
                    {a.description}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
      {/* Подменю команды пространства — сосед меню в том же портале, фиксом
          на высоте строки. Таймер в scheduleClose даёт мыши перескочить
          зазор между строкой и подменю, не закрыв его. */}
      {open && hovered && (teams[hovered.id]?.length ?? 0) > 0 && createPortal(
        <div
          style={{
            position: "fixed",
            // -4 по вертикали компенсирует p-1 контейнера: первый пункт
            // подменю ложится ровно на строку пространства. Лёгкий наезд
            // влево убирает щель между панелями (сквозь неё просвечивала
            // страница) и заодно даёт мыши сплошной путь без мёртвой зоны.
            top: hovered.top - 4,
            left: (menuRef.current?.getBoundingClientRect().right ?? pos.left + 320) - 4,
          }}
          onMouseEnter={() => {
            if (closeTimer.current) clearTimeout(closeTimer.current);
          }}
          onMouseLeave={scheduleClose}
          className="z-[10000] max-h-[50vh] w-max min-w-[180px] max-w-[280px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {/* Только агенты команды — без строки «по умолчанию»: универсальный
              выбирается кликом по самому имени пространства. */}
          {(teams[hovered.id] ?? []).map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => { e.stopPropagation(); pickSpace(hovered.id, a.id); }}
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition hover:bg-accent"
            >
              <span className="truncate font-medium">{a.name}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Выбор МОДЕЛИ и ГЛУБИНЫ РАССУЖДЕНИЯ — одна капсула на два параметра.
 *
 *  Раньше это были два отдельных дропдауна. Они стояли рядом, открывались
 *  одинаково и относились к одному решению — «чем и как думать», — а панель
 *  под инпутом занимали вдвое. Объединены в один список с двумя разделами.
 *
 *  На капсуле оба значения — «Enso - Medium»: после ухода иконок и стрелок
 *  панель стала компактной, и глубина уместилась; так текущая настройка видна
 *  без открытия меню.
 */
function ModelDropdown({
  model,
  onModelChange,
  effort,
  onEffortChange,
  agentModel,
}: {
  model: ChatModelId;
  onModelChange?: (m: ChatModelId) => void;
  effort: EffortLevel;
  onEffortChange?: (e: EffortLevel) => void;
  /** Модель, заданная выбранному агенту: показываем только её, без выбора —
   *  ход всё равно пойдёт на ней (бэкенд, app._agent_model). */
  agentModel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top - 4, left: r.left });
    setOpen((v) => !v);
  };

  // Имена — настоящие, с эндпоинта; подменять их марками нечем. Модель,
  // заданная агенту, показывается вместо выбранной в чате.
  const { models } = useModels();
  const label = agentModel ?? model;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onMouseDown={handleOpen}
        className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
      >
        {label} - {EFFORT_LABELS[effort]}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
          className="z-[9999] min-w-[260px] rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {/* Заголовок раздела — как у «Глубины рассуждения» ниже: без него
              список моделей выглядел безымянным блоком над подписанным. */}
          <div className="px-3 pb-1 pt-1 text-xs font-medium text-muted-foreground">
            {t.input.modelSection}
          </div>
          {agentModel ? (
            <div className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-sm text-foreground font-medium">
              <span className="flex min-w-0 flex-col items-start text-left">
                {agentModel}
                <span className="text-xs font-normal text-muted-foreground">{t.input.modelByAgent}</span>
              </span>
              <Check size={13} className="shrink-0 text-primary" />
            </div>
          ) : models.map((m) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                onModelChange?.(m);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm transition hover:bg-accent hover:text-accent-foreground ${
                model === m ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              {/* Подпись «чем отличается» — только если она есть в словаре:
                  у моделей контура её нет, и пустая строка под именем не нужна. */}
              <span className="flex min-w-0 flex-col items-start text-left">
                {m}
                {t.input.modelHints[m] && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t.input.modelHints[m]}
                  </span>
                )}
              </span>
              {model === m && <Check size={13} className="shrink-0 text-primary" />}
            </button>
          ))}

          {/* Глубина рассуждения — вторым разделом. Разделитель и заголовок
              нужны, чтобы список не читался как продолжение моделей: значения
              («Средний») сами по себе не говорят, к чему относятся. */}
          <div className="my-1 h-px bg-border" />
          <div className="px-3 pb-1 pt-1 text-xs font-medium text-muted-foreground">
            {t.input.effortSection}
          </div>
          {EFFORT_ORDER.map((level) => (
            <button
              key={level}
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                onEffortChange?.(level);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition hover:bg-accent hover:text-accent-foreground ${
                effort === level ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              <span>{EFFORT_LABELS[level]}</span>
              {effort === level && <Check size={13} className="shrink-0 text-primary" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

/** Выбор режима подтверждений Avy Code (Спрашивать / Авто-правки / План). */

type AIChatInputProps = {
  /** Вызывается при отправке (Enter/Send): текст + УЖЕ загруженные вложения
   *  (файлы грузятся в песочницу при прикреплении, а не здесь). */
  onSend?: (message: string, uploaded: UploadedAttachment[]) => void | Promise<void>;
  /** Идёт ответ агента: кнопка Send заменяется на Stop, поле блокируется. */
  streaming?: boolean;
  /** Остановить идущий ход (кнопка Stop / Esc). */
  onStop?: () => void;
  /** Во время хода отправка НЕ блокируется: Enter/Send отдаёт реплику агенту
   *  на ходу (он прочтёт её перед следующим шагом), Stop остаётся рядом.
   *  Обычный чат — да; Avy Code — нет (там ход стоит на approval-паузах). */
  allowInterject?: boolean;
  /** Заполненность окна контекста (для индикатора в капсуле). null — нет данных. */
  contextUsage?: { used_tokens: number; max_tokens: number } | null;
  /** Идёт ручное сжатие контекста. */
  compacting?: boolean;
  /** Сжать контекст сейчас (клик по индикатору). */
  onCompact?: () => void;
  /** Отменить идущее сжатие контекста (Esc). */
  onCancelCompact?: () => void;
  /** Уровень рассуждения модели (low/medium/high/max). Обязателен: значение по
   *  умолчанию задаётся в одном месте — стейте ChatWorkspace, а не дублируется
   *  фолбэком пропа здесь. */
  effort: EffortLevel;
  /** Смена уровня рассуждения. */
  onEffortChange?: (effort: EffortLevel) => void;
  /** Выбранная модель чата. Как и effort, значение по умолчанию задаётся в
   *  стейте ChatWorkspace, а не фолбэком здесь. */
  model?: ChatModelId;
  /** Смена модели. Не передан — селектор не показываем (напр. в режимах, где
   *  модель задаётся не пользователем). */
  onModelChange?: (model: ChatModelId) => void;
  /** Выбранный агент из библиотеки. null/undefined = универсальный чат. */
  agentId?: string | null;
  /** Смена агента. Не передан — капсулу выбора не показываем. */
  onAgentChange?: (id: string | null) => void;
  /** Новый чат в пространстве из «Режима» (клик по имени — универсальный,
   *  подменю — агент команды). Не передан — секции пространств нет. */
  onSpacePick?: (spaceId: string, agentId: string | null) => void;
  /** Пространство активного чата — капсула показывает, где работает
   *  пользователь. */
  activeSpaceId?: string | null;
  /** Сброс пространства повторным кликом по активному (строки «по
   *  умолчанию» в списке нет). */
  onSpaceClear?: () => void;
  /** Сессия началась — режим зафиксирован (капсула только показывает). */
  modeLocked?: boolean;
  disabled?: boolean;
  className?: string;
  /** Состояние вложений (владелец — чат, чтобы drag&drop работал по всей области).
   *  Инпут показывает превью, добавляет из выбора/пейста и забирает на отправке. */
  attachmentsApi: AttachmentsApi;
};

const AIChatInput = ({
  onSend,
  streaming = false,
  onStop,
  allowInterject = false,
  contextUsage,
  compacting = false,
  onCompact,
  onCancelCompact,
  effort,
  onEffortChange,
  model,
  onModelChange,
  agentId,
  onAgentChange,
  onSpacePick,
  activeSpaceId,
  onSpaceClear,
  modeLocked,
  disabled = false,
  className = "",
  attachmentsApi,
}: AIChatInputProps) => {
  const t = useT();
  // Агент, открытый как режим, работает на СВОЕЙ модели, если она задана.
  const agentModel = useAgentModel(agentId);
  const { attachments, rejected, allReady, addFiles, removeFile, takeUploaded } =
    attachmentsApi;
  const [isActive, setIsActive] = useState(false);
  const [inputValue, setInputValue] = useState("");
  // Сенсорный ввод (палец, а не мышь) — от него зависит поведение Enter,
  // см. onKeyDown ниже. Считаем в эффекте, а не при первом рендере: matchMedia
  // на сервере нет, а расхождение разметки сломало бы гидрацию.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarsePointer(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);
  // Вставленные большие куски текста — показываем чипами, на отправке вклеиваем
  // в текст сообщения (модель получает обычный текст, не файл).
  const [pastedTexts, setPastedTexts] = useState<string[]>([]);
  // Капсула (для drop-зоны и пр.) и весь корень композера. «Клик вне» считаем по
  // КОРНЮ: превью-чипы вставок/файлов лежат НАД капсулой, вне wrapperRef, и клик
  // по их крестику иначе ловится как «вне» → инпут сворачивается раньше удаления.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // «В поле есть текст» — булево, а не сама строка. Эффекты и motion-варианты
  // ниже зависят ТОЛЬКО от факта непустоты, поэтому завязывать их на inputValue
  // значит дёргать их на каждый символ: пересоздавать слушатель document,
  // перезапускать эффекты и заново прогонять motion.animate. hasText меняется
  // ровно дважды — на первом символе и на очистке поля.
  const hasText = inputValue !== "";

  // Авто-рост textarea (замена field-sizing-content), отложенный в rAF.
  //
  // Замер высоты — это `height="auto"` + чтение scrollHeight, то есть forced
  // synchronous layout. В обработчике onChange он попадал внутрь того же кадра,
  // где motion пересчитывает layout капсулы, и стоимость складывалась — отсюда
  // микрофризы при наборе. В rAF замер уходит в фазу перед отрисовкой, а
  // повторные вызовы за один кадр схлопываются (быстрый набор = один замер).
  const growFrame = useRef<number | undefined>(undefined);
  const autoGrow = useCallback((el: HTMLTextAreaElement) => {
    if (growFrame.current !== undefined) cancelAnimationFrame(growFrame.current);
    growFrame.current = requestAnimationFrame(() => {
      growFrame.current = undefined;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    });
  }, []);
  useEffect(() => () => {
    if (growFrame.current !== undefined) cancelAnimationFrame(growFrame.current);
  }, []);

  // Бегающей подсказки (ротация фраз с побуквенной анимацией) БОЛЬШЕ НЕТ —
  // вместе с ней ушла и вся её обвязка: три состояния, интервал с вложенным
  // таймаутом и страховки от «залипшего плейсхолдера поверх текста». Подсказка
  // теперь нативный placeholder текстарии: браузер сам решает, когда её видно.

  // Close input when clicking outside.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        if (!hasText) setIsActive(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [hasText]);

  // Esc во время ответа агента — остановить ход (наравне с кнопкой Stop).
  // Esc прерывает текущую длительную операцию: идущий ход агента (стрим) → onStop,
  // ручное сжатие контекста → onCancelCompact. Вешаем обработчик, пока активно
  // хоть что-то из двух.
  useEffect(() => {
    if (!streaming && !compacting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (streaming) onStop?.();
      else if (compacting) onCancelCompact?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [streaming, compacting, onStop, onCancelCompact]);

  // Чат занят: идёт ответ агента ИЛИ сжатие контекста. Влияет только на
  // ОТПРАВКУ — пока агент работает, новый ход начать нельзя (наложился бы на
  // тот же thread). Но ПЕЧАТАТЬ при этом разрешаем всегда: пользователь может
  // набирать следующий вопрос заранее — он уйдёт, как только операция завершится.
  // С allowInterject идущий ход отправку не блокирует: реплика уйдёт агенту
  // на ходу, а не наложится вторым ходом (это решает chatStreams.interject).
  const busy = compacting || (streaming && !allowInterject);
  // Реплика посреди хода набрана: на месте Stop — Send, одна кнопка. Стёрли
  // текст — снова Stop. Остановить ход при набранном тексте можно Esc.
  // Раньше Stop оставался рядом «в тени» — две кнопки читались как «стоп всё
  // ещё главное», и человек не понимал, что реплику можно просто отправить.
  const interjecting = streaming && allowInterject && inputValue.trim().length > 0;
  // Идёт загрузка вложений в песочницу (грузятся при прикреплении): хотя бы одно
  // вложение ещё не `done`. Пока так — Send заблокирован, плашка «Загружаю…»
  // висит, основной плейсхолдер скрыт.
  const uploading = attachments.length > 0 && !allReady;
  // Поле блокируем ТОЛЬКО на время сжатия контекста (тогда история перестраивается
  // и набор бессмысленен + есть оверлей). Во время стрима поле живое.
  const inputLocked = compacting;

  const handleActivate = () => {
    if (inputLocked) return;
    setIsActive(true);
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (
      busy ||
      disabled ||
      // Пока вложения ещё грузятся (или упали) — отправку не пускаем.
      !allReady ||
      (!text && attachments.length === 0 && pastedTexts.length === 0)
    )
      return;
    // Вставленные тексты вклеиваем в сообщение блоками — модель получает обычный
    // текст. Каждый блок обрамляем маркером, чтобы бабл показал его чипом, а не
    // портянкой (как делается для прикреплённых файлов).
    const pastedBlocks = pastedTexts
      .map((t) => `${PASTED_TEXT_MARKER}\n${t}\n${PASTED_TEXT_MARKER_END}`)
      .join("\n\n");
    const fullText = [text, pastedBlocks].filter(Boolean).join("\n\n");
    // Файлы УЖЕ загружены в песочницу (при прикреплении) — забираем их метаданные
    // и очищаем композер. Повторной загрузки на отправке больше нет.
    const uploaded = takeUploaded();
    setInputValue("");
    setPastedTexts([]);
    // Сбрасываем ручную высоту textarea: авто-рост задаёт inline style.height
    // по scrollHeight, и после очистки значения он остаётся от многострочного
    // текста — поле «залипало» раздутым. Возвращаем к базовой.
    // Сначала снимаем отложенный замер: иначе rAF от последнего набранного
    // символа выполнится ПОСЛЕ сброса и вернёт раздутую высоту (Enter сразу
    // после ввода — ровно этот случай).
    if (growFrame.current !== undefined) {
      cancelAnimationFrame(growFrame.current);
      growFrame.current = undefined;
    }
    if (textInputRef.current) textInputRef.current.style.height = "auto";
    // Схлопываем капсулу обратно: снимаем активность и фокус, иначе условие
    // `isActive || inputValue` держит её развёрнутой даже после очистки текста.
    setIsActive(false);
    textInputRef.current?.blur();

    void onSend?.(fullText, uploaded);
  };

  const containerVariants = {
    collapsed: {
      height: 68,
      boxShadow: "0 2px 8px 0 rgba(0,0,0,0.20)",
      transition: { type: "spring" as const, stiffness: 120, damping: 18 },
    },
    expanded: {
      // height: "auto" + minHeight: капсула не короче 128, но РАСТЁТ под
      // содержимое (textarea переносит строки) — блок растёт, а не режется.
      height: "auto" as const,
      minHeight: 128,
      boxShadow: "0 8px 32px 0 rgba(0,0,0,0.32)",
      transition: { type: "spring" as const, stiffness: 120, damping: 18 },
    },
  };

  // Drag&drop файлов ловит вся область чата (#chat-area в Chat), а не капсула —
  // файл прикрепляется, куда бы его ни бросили. Здесь своей drop-зоны нет.

  return (
    <div className={`w-full flex justify-center ${className}`}>
      <div ref={rootRef} className="relative w-full max-w-3xl">
        {/* Превью прикреплённых файлов и вставленных текстов — над капсулой. */}
        {(attachments.length > 0 || pastedTexts.length > 0 || rejected > 0) && (
          <div className="mb-2 px-1">
            {(attachments.length > 0 || pastedTexts.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {pastedTexts.map((txt, i) => (
                  <AttachmentChip
                    key={`pasted-${i}`}
                    name={`${t.chat.pastedText} ${pastedTexts.length > 1 ? i + 1 : ""}`.trim()}
                    mime="text/plain"
                    preview={pastePreview(txt)}
                    onRemove={() =>
                      setPastedTexts((prev) => prev.filter((_, j) => j !== i))
                    }
                  />
                ))}
                {attachments.map((a) => (
                  <AttachmentChip
                    key={a.id}
                    name={a.file.name}
                    mime={a.file.type || "application/octet-stream"}
                    size={a.file.size}
                    thumbUrl={a.url}
                    uploadStatus={a.status}
                    uploadProgress={a.progress}
                    onRemove={() => removeFile(a)}
                  />
                ))}
              </div>
            )}
            {rejected > 0 && (
              <p className="mt-1 px-1 text-xs text-destructive">
                {rejected === 1
                  ? t.input.fileTooBig
                  : t.input.filesTooBig(String(rejected))}
              </p>
            )}
          </div>
        )}

        {/* Оверлей зоны drop живёт в Chat (#chat-area) — покрывает всю область. */}

      {/* Скругление — ТОКЕНОМ, А НЕ ЧИСЛОМ. Здесь стояло borderRadius: 32 —
          вдвое круглее модалки и втрое круглее кнопок, из-за чего поле выпадало
          из общего языка форм. --radius-2xl тот же, что у модалки: это ближайший
          примитив по размеру и роли — крупная поверхность, а не контрол. */}
      <motion.div
        ref={wrapperRef}
        className="w-full rounded-2xl border border-border bg-card text-card-foreground"
        variants={containerVariants}
        animate={isActive || hasText ? "expanded" : "collapsed"}
        initial="collapsed"
        style={{ overflow: "hidden" }}
        onClick={handleActivate}
      >
        <div className="flex flex-col items-stretch w-full">
          {/* Input Row. items-start: кнопки прижаты к верхней строке текста
              (как в эталоне), а не центрируются по растущей textarea. */}
          {/* py-3.5, а не p-3: свёрнутая капсула 68px, кнопки 40px — паддинг
              14px добивает ряд ровно до 68, и кнопки с текстом стоят по её
              вертикальному центру. С p-3 ряд был 64 и всплывал на 4px. */}
          <div className="flex items-start gap-2 px-3 py-3.5 max-w-3xl w-full">
            <button
              className="p-2.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition disabled:opacity-40 disabled:hover:bg-transparent"
              title={t.input.attachFile}
              type="button"
              disabled={inputLocked}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <Paperclip size={20} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = ""; // повторный выбор того же файла
              }}
            />

            {/* Text Input & Placeholder */}
            <div className="relative flex-1 min-w-0">
              {/* field-sizing-content: браузер сам растит textarea по содержимому
                  (без JS). rows=1 — базовая одна строка; max-h-40 — потолок,
                  дальше внутренний скролл. Всё прочее — как у прежнего input. */}
              <textarea
                ref={textInputRef}
                rows={1}
                value={inputValue}
                placeholder={
                  streaming && allowInterject
                    ? t.input.placeholderStreaming
                    : t.input.placeholder
                }
                disabled={inputLocked}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  autoGrow(e.target);
                }}
                onKeyDown={(e) => {
                  // Enter — отправка; Shift+Enter — перенос строки.
                  //
                  // НА СЕНСОРНОМ ВВОДЕ НАОБОРОТ: Enter переносит строку. Shift-а
                  // на экранной клавиатуре нет, поэтому «Enter = отправка» не
                  // оставляет способа сделать абзац — сообщение улетало на
                  // середине мысли. Отправка там — кнопкой, она всегда на виду.
                  //
                  // Проверяем УКАЗАТЕЛЬ, а не ширину окна: узкое окно на
                  // десктопе — всё ещё физическая клавиатура, где Enter обязан
                  // отправлять. `pointer: coarse` — это палец, а не мышь.
                  if (e.key === "Enter" && !e.shiftKey && !coarsePointer) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                onPaste={(e) => {
                  // Вставка файлов из буфера (скриншот по Ctrl+V, копированный
                  // файл) — прикрепляем как вложение, минуя текстовое поле.
                  const pastedFiles = Array.from(e.clipboardData.files || []);
                  if (pastedFiles.length) {
                    e.preventDefault();
                    addFiles(pastedFiles);
                    handleActivate();
                    return;
                  }
                  // Большую вставку текста превращаем в чип-вложение, а не льём в поле.
                  const pasted = e.clipboardData.getData("text");
                  if (pasted.length > PASTE_AS_ATTACHMENT_CHARS) {
                    e.preventDefault();
                    setPastedTexts((prev) => [...prev, pasted]);
                    handleActivate();
                  }
                }}
                className="flex-1 min-w-0 border-0 outline-0 rounded-none py-2 text-base bg-transparent w-full resize-none max-h-40 font-normal text-foreground placeholder:text-muted-foreground disabled:opacity-60 break-words whitespace-pre-wrap"
                style={{ position: "relative", zIndex: 1 }}
                onFocus={handleActivate}
              />
              {/* Оверлей на время сжатия контекста: явная подпись + спиннер
                  поверх поля (поле заблокировано, текст в нём скрыт opacity). */}
              <AnimatePresence>
                {compacting && (
                  <motion.div
                    key="compacting"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-10 flex items-center gap-2 px-3 text-muted-foreground"
                  >
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">{t.input.compressingContext}</span>
                  </motion.div>
                )}
                {/* Плашки «Загружаю вложения…» поверх поля БОЛЬШЕ НЕТ: прогресс
                    загрузки виден на кольцах чипов, а поле остаётся свободным —
                    можно печатать сообщение параллельно с загрузкой файлов. */}
              </AnimatePresence>
            </div>

            {/* Голосовой ввод ещё не сделан: кнопку не прячем (место в панели
                за ней остаётся), но держим выключенной — иначе выглядит
                рабочей и молча ничего не делает. */}
            <button
              className="p-2.5 rounded-lg text-muted-foreground opacity-40 cursor-not-allowed"
              title={t.input.voiceInputSoon}
              aria-label={t.input.voiceInputSoon}
              type="button"
              tabIndex={-1}
              disabled
            >
              <Mic size={20} />
            </button>
            {/* Набрана реплика посреди хода (interjecting): вместо Stop —
                Send, остановить можно Esc. Стёрли текст — Stop возвращается. */}
            {streaming && !interjecting ? (
              <button
                // p-3, а не p-2.5 как у отправки: иконка стопа 14px против 18
                // у стрелки, и без компенсации паддингом кнопка выходила 34px
                // против 38 — размер бокса обязан совпадать с отправкой.
                className="flex items-center gap-1 bg-primary hover:bg-primary/90 text-primary-foreground p-3 rounded-lg font-medium justify-center"
                title={t.input.stop}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStop?.();
                }}
              >
                {/* Заливной квадрат — классический «стоп» без кружка вокруг.
                    14px, а не 18: заливная фигура оптически крупнее контурной. */}
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                className="flex items-center gap-1 bg-primary hover:bg-primary/90 text-primary-foreground p-2.5 rounded-lg font-medium justify-center disabled:opacity-50"
                title={compacting ? t.input.compressingContext : t.input.send}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleSend();
                }}
                disabled={
                  busy ||
                  // Вложения ещё грузятся/упали — отправлять нельзя.
                  uploading ||
                  disabled ||
                  (!inputValue.trim() &&
                    attachments.length === 0 &&
                    pastedTexts.length === 0)
                }
              >
                {compacting || uploading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  // Обводка жирнее иконочной базы: стрелка легче самолётика
                  // по массе, на заливке кнопки базовые 2 читались бы бледнее
                  // соседних иконок.
                  <ArrowUp size={18} strokeWidth={2.5} />
                )}
              </button>
            )}
          </div>

          {/* Expanded Controls */}
          <motion.div
            className="w-full flex justify-start px-4 pb-3 items-center text-sm"
            variants={{
              hidden: {
                opacity: 0,
                y: 20,
                pointerEvents: "none" as const,
                transition: { duration: 0.25 },
              },
              visible: {
                opacity: 1,
                y: 0,
                pointerEvents: "auto" as const,
                transition: { duration: 0.35, delay: 0.08 },
              },
            }}
            initial="hidden"
            animate={isActive || hasText ? "visible" : "hidden"}
            style={{ marginTop: 8 }}
          >
            <div className="flex gap-3 items-center">
              {/* Кнопки «Глубокое исследование» здесь БОЛЬШЕ НЕТ. Исследователь
                  перестал быть режимом-переключателем и стал обычной записью в
                  библиотеке агентов — отдельная кнопка дублировала бы первый же
                  пункт выпадающего списка. */}

              {/* Агент из библиотеки. Как и модель — только с обработчиком:
                  без него капсула была бы мёртвой. */}
              {onAgentChange && (
                <AgentDropdown
                  agentId={agentId}
                  onAgentChange={onAgentChange}
                  onSpacePick={onSpacePick}
                  activeSpaceId={activeSpaceId}
                  onSpaceClear={onSpaceClear}
                  locked={modeLocked}
                />
              )}

              {/* Модель + глубина рассуждения одной капсулой: оба параметра
                  про «чем и как думать», и держать под них две капсулы значило
                  бы занимать панель вдвое ради одного решения. */}
              {model && onModelChange && (
                <ModelDropdown
                  model={model}
                  onModelChange={onModelChange}
                  effort={effort}
                  onEffortChange={onEffortChange}
                  agentModel={agentModel}
                />
              )}
            </div>

            {/* Индикатор заполненности контекста + ручное сжатие. Прижат вправо;
                показываем только когда есть данные (активная сессия с историей). */}
            {contextUsage && (
              <div className="ml-auto">
                <ContextMeter
                  usedTokens={contextUsage.used_tokens}
                  maxTokens={contextUsage.max_tokens}
                  compacting={compacting}
                  onCompact={onCompact}
                />
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
      </div>
    </div>
  );
};

export { AIChatInput };
