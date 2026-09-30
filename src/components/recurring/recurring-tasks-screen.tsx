"use client";

import * as React from "react";
import {
  Clock,
  Play,
  Trash2,
  Plus,
  Pencil,
  Power,
  KeyRound,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  FolderKanban,
} from "lucide-react";
// Кнопка-развилка «вручную / с помощью ассистента» — общая для всех
// абстракций (агенты, навыки, пространства, задачи), поэтому берём готовую.
import { CreateButton } from "@/components/agents/agents-screen";
import { useConnectorItems, useConnectorList } from "@/components/agents/connector-items";
import { ConnectorRulesDialog } from "@/components/agents/connector-rules-dialog";
import { PickerField } from "@/components/ui/picker-field";
import { Modal } from "@/components/ui/modal";
import { SelectNative } from "@/components/ui/select-native";
import { useAgents } from "@/hooks/use-agents";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";
import { useRecurringTasks } from "@/hooks/use-recurring-tasks";
import {
  listTaskRuns,
  deleteTaskRun,
  listTaskSecrets,
  setTaskSecret,
  deleteTaskSecret,
  type RecurringTask,
  type TaskRun,
  type SecretMeta,
  type TaskUpload,
  type ConnectorRules,
} from "@/lib/api";
import {
  attachTaskExtras,
  type PendingSecret,
  type TaskExtras,
} from "@/lib/task-extras";
import {
  type ScheduleSpec,
  specToCron,
  cronToSpec,
  defaultSpec,
  MINUTE_STEPS,
  HOUR_STEPS,
} from "@/lib/schedule";
import { PendingInputs, TaskFiles } from "@/components/recurring/task-files";

const FIELD =
  "w-full rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-primary/5";
const LABEL = "text-xs font-medium text-muted-foreground";

const pad = (n: number) => String(n).padStart(2, "0");

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function tzList(): string[] {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const all = anyIntl.supportedValuesOf?.("timeZone");
    if (all && all.length) return all;
  } catch {
    /* fall through */
  }
  return ["UTC", "Europe/Moscow", "Europe/London", "America/New_York", "Asia/Tokyo"];
}

/** Человеческая подпись расписания («Каждый день в 08:00»). */
function humanSchedule(spec: ScheduleSpec, t: ReturnType<typeof useT>): string {
  const rt = t.recurringTasks;
  const time = `${pad(spec.hour)}:${pad(spec.minute)}`;
  switch (spec.kind) {
    case "daily":
      return `${rt.scheduleDaily} ${rt.atTime} ${time}`;
    case "weekdays":
      return `${rt.scheduleWeekdays} ${rt.atTime} ${time}`;
    case "weekly":
      return `${rt.onDay} ${rt.weekdayNames[spec.weekday]} ${rt.atTime} ${time}`;
    case "interval": {
      const unit = spec.unit === "minutes" ? rt.unitMinutes : rt.unitHours;
      return `${rt.everyLabel.toLowerCase()} ${spec.every} ${unit}`;
    }
  }
}

// ── Форма создания/редактирования (человеческий конструктор, без JSON) ────────

// export: та же форма служит созданию задачи ИЗ ПРОСТРАНСТВА (spaces-screen) —
// единая точка создания, а не своя форма в каждом разделе.

/** agent_config задачи с правилами коннекторов — только выбранных: убранный
 *  коннектор уносит свои правила с собой. Пусто — ключа нет. */
function withConnectorRules(
  config: Record<string, unknown>,
  rules: ConnectorRules,
  connectors: string[],
): Record<string, unknown> {
  const kept = Object.fromEntries(Object.entries(rules).filter(([id]) => connectors.includes(id)));
  const out = { ...config };
  if (Object.keys(kept).length > 0) out.connector_rules = kept;
  else delete out.connector_rules;
  return out;
}

export function TaskForm({
  initial,
  taskId,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  initial?: RecurringTask;
  // id СУЩЕСТВУЮЩЕЙ задачи: секреты и вложения идут сразу на сервер. При
  // создании его нет — задачи ещё не существует, и форма копит секреты и
  // вложения у себя (extras), а сохранение привязывает их к созданной задаче.
  taskId?: string;
  onCancel: () => void;
  onSubmit: (
    input: {
      title: string;
      instruction: string;
      schedule: string;
      timezone: string;
      agent_id: string;
      /** Прочие ключи сохраняются как были; форма правит только коннекторы. */
      agent_config: Record<string, unknown>;
      error_policy: Record<string, unknown>;
    },
    extras: TaskExtras,
  ) => void;
  submitting: boolean;
  /** Что не так с прошлым сохранением — показывается над формой. */
  error?: string | null;
}) {
  const t = useT();
  const rt = t.recurringTasks;
  // Набранное до сохранения (только при создании, см. taskId).
  const [pendingSecrets, setPendingSecrets] = React.useState<PendingSecret[]>([]);
  const [pendingFiles, setPendingFiles] = React.useState<TaskUpload[]>([]);
  const [title, setTitle] = React.useState(initial?.title ?? "");
  // Название, вынесенное в заголовок формы. Обновляем по уходу из поля (blur),
  // а не на каждый символ — иначе заголовок дёргался бы при наборе.
  const [savedTitle, setSavedTitle] = React.useState(initial?.title ?? "");
  const [instruction, setInstruction] = React.useState(initial?.instruction ?? "");
  const [tz, setTz] = React.useState(initial?.timezone ?? browserTz());
  // Агент прогона: пусто — универсальный ассистент. Список — готовые к
  // работе агенты (те же, что в выборе над полем ввода).
  const [agentId, setAgentId] = React.useState(initial?.agent_id ?? "");
  const { agents: libraryAgents } = useAgents();
  // Коннекторы прогона — явным списком id. Они ДОБАВЛЯЮТСЯ к набору самого
  // агента (как у пространства), а не заменяют его: пусто значит «ничего
  // сверх агента». Остальное из agent_config форма не трогает и при
  // сохранении возвращает как было.
  const initialAgentConfig = (initial?.agent_config ?? {}) as Record<string, unknown>;
  const [connectors, setConnectors] = React.useState<string[]>(
    Array.isArray(initialAgentConfig.connectors)
      ? (initialAgentConfig.connectors as string[])
      : [],
  );
  const connectorList = useConnectorList();
  const connectorItems = useConnectorItems(connectorList);
  // Правила коннекторов задачи: что прогону доступно и что подтверждать.
  // Прогон идёт без человека — окно об этом предупреждает (unattended).
  const [connectorRules, setConnectorRules] = React.useState<ConnectorRules>(
    (initialAgentConfig.connector_rules as ConnectorRules | undefined) ?? {},
  );
  const [rulesFor, setRulesFor] = React.useState<string | null>(null);
  // Политика ошибок — свёрнутый блок «Дополнительно»: дефолты разумные, но
  // задача может быть чувствительной к повторам (напр. постинг в канал).
  const initialPolicy = (initial?.error_policy ?? {}) as Record<string, unknown>;
  const [maxRetries, setMaxRetries] = React.useState(
    Number(initialPolicy.max_retries ?? 2),
  );
  const [backoffS, setBackoffS] = React.useState(Number(initialPolicy.backoff_s ?? 30));
  // Секреты — попапом, как на детальном экране задачи (значения чувствительные,
  // держать их развёрнутыми в форме незачем).
  const [secretsOpen, setSecretsOpen] = React.useState(false);
  const [spec, setSpec] = React.useState<ScheduleSpec>(
    initial ? cronToSpec(initial.schedule) : defaultSpec(),
  );
  const timeValue = `${pad(spec.hour)}:${pad(spec.minute)}`;

  const setTime = (v: string) => {
    const [h, m] = v.split(":").map((x) => Number(x));
    setSpec((s) => ({ ...s, hour: h || 0, minute: m || 0 }));
  };

  const cron = specToCron(spec);
  const canSave = Boolean(title.trim() && instruction.trim() && !submitting);

  const showTime = spec.kind === "daily" || spec.kind === "weekdays" || spec.kind === "weekly";
  const showWeekday = spec.kind === "weekly";
  const showInterval = spec.kind === "interval";
  const stepOptions = spec.unit === "minutes" ? MINUTE_STEPS : HOUR_STEPS;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full flex-col gap-5 p-6">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {/* Кнопка «назад» — в ХЕДЕРЕ воркспейса. Действия формы — здесь же, в
            строке заголовка. Сам заголовок показывает НАЗВАНИЕ задачи, как
            только пользователь его ввёл (подтверждается по уходу из поля) —
            дальше «Создать задачу» уже не сообщает ничего полезного. */}
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">
            {savedTitle || (initial ? rt.edit : rt.create)}
          </h1>
          <button
            type="button"
            onClick={() => setSecretsOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <KeyRound className="size-4" />
            {rt.secrets}
            {!taskId && pendingSecrets.length > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 text-[11px] text-primary">
                {pendingSecrets.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {rt.cancel}
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSubmit(
                {
                  title: title.trim(),
                  instruction: instruction.trim(),
                  schedule: cron,
                  timezone: tz,
                  agent_id: agentId,
                  agent_config: withConnectorRules(
                    { ...initialAgentConfig, connectors },
                    connectorRules,
                    connectors,
                  ),
                  error_policy: {
                    max_retries: maxRetries,
                    backoff_s: backoffS,
                  },
                },
                { secrets: pendingSecrets, files: pendingFiles },
              )
            }
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
          >
            {rt.save}
          </button>
        </div>

      {/* Две колонки: слева настройки задачи, справа — инструкция (она длинная,
          её удобно писать в полную высоту рядом, а не листать под настройками).
          На узком экране колонки схлопываются в одну. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">

      <div className="flex flex-col gap-1.5">
        <label className={LABEL}>{rt.nameLabel}</label>
        <input
          className={FIELD}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setSavedTitle(title.trim())}
          placeholder={rt.namePlaceholder}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={LABEL}>{rt.scheduleLabel}</label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[10rem] flex-1">
            <SelectNative
              value={spec.kind}
              onChange={(e) =>
                setSpec((s) => ({ ...s, kind: e.target.value as ScheduleSpec["kind"] }))
              }
            >
              <option value="daily">{rt.scheduleDaily}</option>
              <option value="weekdays">{rt.scheduleWeekdays}</option>
              <option value="weekly">{rt.scheduleWeekly}</option>
              <option value="interval">{rt.scheduleInterval}</option>
            </SelectNative>
          </div>
          {showWeekday && (
            <div className="min-w-[9rem]">
              <SelectNative
                value={spec.weekday}
                onChange={(e) => setSpec((s) => ({ ...s, weekday: Number(e.target.value) }))}
              >
                {rt.weekdayNames.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </SelectNative>
            </div>
          )}
          {showTime && (
            <input
              type="time"
              className={cn(FIELD, "w-auto")}
              value={timeValue}
              onChange={(e) => setTime(e.target.value)}
            />
          )}
          {showInterval && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{rt.everyLabel}</span>
              <div className="w-20">
                <SelectNative
                  value={spec.every}
                  onChange={(e) => setSpec((s) => ({ ...s, every: Number(e.target.value) }))}
                >
                  {stepOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div className="w-28">
                <SelectNative
                  value={spec.unit}
                  onChange={(e) => {
                    const unit = e.target.value as ScheduleSpec["unit"];
                    // Сбрасываем every на первый допустимый шаг новой единицы.
                    const steps = unit === "minutes" ? MINUTE_STEPS : HOUR_STEPS;
                    setSpec((s) => ({ ...s, unit, every: steps[0] }));
                  }}
                >
                  <option value="minutes">{rt.unitMinutes}</option>
                  <option value="hours">{rt.unitHours}</option>
                </SelectNative>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={LABEL}>{rt.timezoneLabel}</label>
        <SelectNative value={tz} onChange={(e) => setTz(e.target.value)}>
          {tzList().map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </SelectNative>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={LABEL}>{rt.agentLabel}</label>
        <SelectNative value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">{rt.agentDefault}</option>
          {libraryAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectNative>
      </div>

      {/* Коннекторы — сразу под агентом: это ответ на тот же вопрос «чем
          задача располагает». Выбранное карточками + «Добавить» в окно. */}
      <PickerField
        label={rt.connectorsLabel}
        hint={rt.connectorsHint}
        title={t.connectors.pickerTitle}
        items={connectorItems}
        value={connectors}
        onChange={setConnectors}
        onConfigure={setRulesFor}
        configuredIds={Object.keys(connectorRules)}
        emptyText={t.connectors.pickerEmpty}
      />
      {rulesFor && connectorList?.find((x) => x.id === rulesFor) && (
        <ConnectorRulesDialog
          connector={connectorList.find((x) => x.id === rulesFor)!}
          rule={connectorRules[rulesFor]}
          unattended
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

      {/* Поведение при сбое — не свёрнутый «Дополнительно», а живая фраза с
          полями внутри: так видно СМЫСЛ настройки («повторить 2 раза с паузой
          30 с»), а не два безымянных числовых поля. */}
      <div className="flex flex-col gap-2.5">
        <label className={LABEL}>{rt.onFailure}</label>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-foreground">
          <span>{rt.retryPrefix}</span>
          <input
            type="number"
            min={0}
            max={10}
            className={cn(FIELD, "w-16 text-center tabular-nums")}
            value={maxRetries}
            onChange={(e) =>
              setMaxRetries(Math.min(10, Math.max(0, Number(e.target.value) || 0)))
            }
          />
          <span>{rt.retryTimes(maxRetries)}</span>
          {maxRetries > 0 && (
            <>
              <span>{rt.retryPause}</span>
              <input
                type="number"
                min={0}
                max={3600}
                step={5}
                className={cn(FIELD, "w-20 text-center tabular-nums")}
                value={backoffS}
                onChange={(e) =>
                  setBackoffS(Math.min(3600, Math.max(0, Number(e.target.value) || 0)))
                }
              />
              <span>{rt.secondsShort}</span>
            </>
          )}
        </div>
      </div>

      </div>{/* /левая колонка */}

      {/* Правая колонка — инструкция. Тянется на всю высоту колонки: это
          основной текст задачи, его пишут длинным. */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className={LABEL}>{rt.instructionLabel}</label>
        <textarea
          className={cn(FIELD, "min-h-[240px] flex-1 resize-y leading-relaxed")}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={rt.instructionPlaceholder}
        />
        <span className="text-[11px] text-muted-foreground">{rt.instructionHint}</span>

        {/* Вложения — под инструкцией. Артефактов тут нет намеренно: это
            результаты прогонов, у создаваемой задачи их не существует. */}
        <div className="mt-3">
          {taskId ? (
            <TaskFiles taskId={taskId} showOutputs={false} />
          ) : (
            <PendingInputs files={pendingFiles} onChange={setPendingFiles} />
          )}
        </div>
      </div>

      </div>{/* /две колонки */}

      </div>

      <Modal
        open={secretsOpen}
        onClose={() => setSecretsOpen(false)}
        title={rt.secrets}
        className="max-w-xl"
      >
        {taskId ? (
          <SecretsPanel taskId={taskId} />
        ) : (
          <SecretsPanel pending={{ items: pendingSecrets, onChange: setPendingSecrets }} />
        )}
      </Modal>
    </div>
  );
}

// ── Секреты задачи ────────────────────────────────────────────────────────────

/** Привести ввод к имени env, которое примет бэкенд: `^[A-Z][A-Z0-9_]*$`.
 *
 * Раньше поле делало только `toUpperCase()`, а он не трогает дефис, точку,
 * пробел и кириллицу — `TG-TOKEN` выглядел правильным, но бэкенд отвечал 400.
 * Разделители переводим в `_` (так их обычно и пишут в env), остальное лишнее
 * отбрасываем.
 *
 * Ведущие цифры НЕ срезаем: из `2FA` вышло бы `FA` — молча не то имя, которое
 * человек вводил, а секрет потом читается из env по имени. Пусть такой ввод
 * дойдёт до бэкенда и вернётся внятным отказом. По той же причине не трогаем
 * префикс `AVY_` (зарезервирован сервером) — это отказ, а не опечатка.
 * Валидацию это НЕ заменяет: бэкенд по-прежнему проверяет сам.
 */
function normalizeSecretName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s.\-/]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

/**
 * Секреты задачи. Два режима с одним видом:
 *  - taskId — задача существует, значения уходят на сервер сразу;
 *  - pending — форма СОЗДАНИЯ: задачи ещё нет, пары копятся у формы и
 *    привязываются после сохранения (attachTaskExtras). Валидацию имени сервер
 *    сделает тогда же; здесь — та же нормализация, что и в первом режиме.
 */
function SecretsPanel({
  taskId,
  pending,
}: {
  taskId?: string;
  pending?: { items: PendingSecret[]; onChange: (items: PendingSecret[]) => void };
}) {
  const t = useT();
  const rt = t.recurringTasks;
  const local = !taskId;
  const [secrets, setSecrets] = React.useState<SecretMeta[] | null>(null);
  const [name, setName] = React.useState("");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    if (!taskId) return;
    listTaskSecrets(taskId).then(setSecrets);
  }, [taskId]);
  React.useEffect(reload, [reload]);

  // Что показываем: набранное (создание) либо имена с сервера (правка).
  const shown: { key: string }[] | null = local ? (pending?.items ?? []) : secrets;

  const add = async () => {
    if (!name.trim() || !value.trim()) return;
    if (local) {
      const key = name.trim();
      const rest = (pending?.items ?? []).filter((s) => s.key !== key);
      pending?.onChange([...rest, { key, value }]);
      setName("");
      setValue("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setTaskSecret(taskId!, name.trim(), value);
      setName("");
      setValue("");
      reload();
    } catch (e) {
      // Ошибку ОБЯЗАТЕЛЬНО показываем. Раньше здесь был пустой catch, и панель
      // молча ничего не делала: бэкенд отвечал 400 (имя не UPPER_SNAKE) или 503
      // (AVY_SECRETS_KEY не задан/битый), а пользователь видел лишь то, что
      // секрет не появился — причину было не угадать. Наступали 11.08 на проде:
      // ключ приехал из секрета GitHub без хвостового «=», все PUT падали 503.
      setError((e as Error)?.message?.trim() || rt.secretSaveFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: string) => {
    if (local) {
      pending?.onChange((pending?.items ?? []).filter((s) => s.key !== key));
      return;
    }
    await deleteTaskSecret(taskId!, key);
    reload();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {rt.secretsHint}
        {local && ` ${rt.pendingSaveHint}`}
      </p>
      <div className="flex flex-col gap-2">
        {shown === null ? (
          <div className="text-xs text-muted-foreground">{t.files.loading}</div>
        ) : shown.length === 0 ? (
          <div className="text-xs text-muted-foreground">{rt.noSecrets}</div>
        ) : (
          shown.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-2 rounded-lg border bg-background/40 px-3 py-2"
            >
              <KeyRound className="size-4 text-muted-foreground" />
              <span className="flex-1 font-mono text-sm">{s.key}</span>
              <span className="text-[11px] text-muted-foreground">••••••</span>
              <button
                type="button"
                onClick={() => remove(s.key)}
                title={rt.deleteSecret}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input
          className={cn(FIELD, "flex-1 font-mono")}
          value={name}
          onChange={(e) => setName(normalizeSecretName(e.target.value))}
          placeholder={rt.secretName}
          aria-invalid={error ? true : undefined}
        />
        <input
          type="password"
          className={cn(FIELD, "flex-1")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={rt.secretValue}
        />
        <button
          type="button"
          disabled={busy || !name.trim() || !value.trim()}
          onClick={add}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="size-4" />
          {rt.addSecret}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">{rt.secretNameHint}</p>
      )}
    </div>
  );
}

// ── Прогоны задачи ────────────────────────────────────────────────────────────

function runStatusMeta(status: string, t: ReturnType<typeof useT>) {
  const rt = t.recurringTasks;
  if (status === "ok") return { Icon: CheckCircle2, label: rt.runOk, cls: "text-emerald-500" };
  if (status === "error") return { Icon: XCircle, label: rt.runError, cls: "text-destructive" };
  return { Icon: Loader2, label: rt.runRunning, cls: "text-amber-500 animate-spin" };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const RUNS_PER_PAGE = 4; // максимум карточек прогона на странице, дальше пагинация

// Высота ТЕЛА блоков «Инструкция» и «Прогоны» — ровно под 4 карточки прогона.
// Общая константа: блоки стоят в одном ряду и их низ должен совпадать, а тело
// не должно прыгать при листании пагинации или расти под длинную инструкцию.
const RUNS_BODY_H = "h-[236px]";

function RunsPanel({
  taskId,
  onOpenRun,
}: {
  taskId: string;
  onOpenRun: (threadId: string) => void;
}) {
  const t = useT();
  const rt = t.recurringTasks;
  const [runs, setRuns] = React.useState<TaskRun[] | null>(null);
  const [deleting, setDeleting] = React.useState<Set<string>>(new Set());
  const [page, setPage] = React.useState(0);

  const reload = React.useCallback(() => {
    listTaskRuns(taskId).then(setRuns);
  }, [taskId]);
  React.useEffect(() => {
    reload();
    // Пока есть выполняющийся прогон — периодически обновляем.
    const iv = setInterval(reload, 4000);
    return () => clearInterval(iv);
  }, [reload]);

  const del = React.useCallback(
    async (runId: string) => {
      setDeleting((s) => new Set(s).add(runId));
      // Оптимистично убираем из списка; при ошибке перечитаем.
      setRuns((prev) => (prev ? prev.filter((r) => r.id !== runId) : prev));
      try {
        await deleteTaskRun(taskId, runId);
      } catch {
        reload();
      } finally {
        setDeleting((s) => {
          const n = new Set(s);
          n.delete(runId);
          return n;
        });
      }
    },
    [taskId, reload],
  );

  const list = runs ?? [];
  const pages = Math.max(1, Math.ceil(list.length / RUNS_PER_PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = list.slice(cur * RUNS_PER_PAGE, cur * RUNS_PER_PAGE + RUNS_PER_PAGE);

  return (
    <section className="flex flex-col gap-2">
      {/* Заголовок + пагинация на одной строке (пагинация по правому краю).
          Так тело блока не расширяется под контролы. */}
      <div className="flex h-7 items-center gap-2">
        <h3 className="text-sm font-semibold">{rt.runs}</h3>
        {pages > 1 && (
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, cur - 1))}
              disabled={cur === 0}
              className="flex size-6 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span>{cur + 1} / {pages}</span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pages - 1, cur + 1))}
              disabled={cur >= pages - 1}
              className="flex size-6 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      {/* Фикс-высота тела под ровно 4 карточки — блок статичен независимо от
          числа карточек на странице (не прыгает при листании пагинации).
          Та же константа у «Инструкции» — низ блоков совпадает. */}
      <div className={cn(RUNS_BODY_H, "overflow-y-auto")}>
      {runs === null ? (
        <div className="text-xs text-muted-foreground">{t.files.loading}</div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-muted-foreground">{rt.noRuns}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {slice.map((r) => {
        const { Icon, label, cls } = runStatusMeta(r.status, t);
        const openable = !!r.thread_id;
        const isRunning = r.status === "running";
        return (
          <div
            key={r.id}
            role={openable ? "button" : undefined}
            tabIndex={openable ? 0 : undefined}
            onClick={() => r.thread_id && onOpenRun(r.thread_id)}
            onKeyDown={(e) => {
              if (openable && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                r.thread_id && onOpenRun(r.thread_id);
              }
            }}
            className={cn(
              "group flex items-center gap-3 rounded-lg border bg-background/40 px-3 py-2 text-left transition-colors",
              openable ? "cursor-pointer hover:border-foreground/30 hover:bg-sidebar-accent" : "opacity-70",
              deleting.has(r.id) && "pointer-events-none opacity-50",
            )}
          >
            <Icon className={cn("size-4 shrink-0", cls)} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">
                {label}
                {r.attempt > 1 && (
                  <span className="text-muted-foreground"> · {rt.attempt} {r.attempt}</span>
                )}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {fmtTime(r.started_at)}
              </span>
            </div>
            {openable && (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            )}
            {/* Удалить прогон — не удаляет файлы задачи (общее облако проекта).
                Идущий прогон удалять нельзя (бэк вернёт 409). */}
            {!isRunning && (
              <button
                type="button"
                title={rt.deleteRun}
                onClick={(e) => {
                  e.stopPropagation();
                  del(r.id);
                }}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        );
          })}
        </div>
      )}
      </div>
    </section>
  );
}

// ── Детальный экран задачи (обзор + секреты + прогоны) ────────────────────────

function TaskDetail({
  task,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
  onOpenRun,
}: {
  task: RecurringTask;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void | Promise<void>;
  onOpenRun: (threadId: string) => void;
}) {
  const t = useT();
  const rt = t.recurringTasks;
  const [running, setRunning] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [secretsOpen, setSecretsOpen] = React.useState(false);
  const spec = cronToSpec(task.schedule);

  const runNow = async () => {
    setRunning(true);
    try {
      await onRunNow();
    } finally {
      setTimeout(() => setRunning(false), 1500);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full flex-col gap-6 p-6">
        {/* Кнопка «назад» — в ХЕДЕРЕ воркспейса (не здесь). */}
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-xl font-semibold">{task.title}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" />
              <span>{humanSchedule(spec, t)}</span>
              <span>·</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  task.enabled
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {task.enabled ? rt.enabled : rt.disabled}
              </span>
            </div>
          </div>
        </div>

        {/* Действия */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? rt.running : rt.runNow}
          </button>
          <button
            type="button"
            onClick={() => onToggle(!task.enabled)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Power className="size-4" />
            {task.enabled ? rt.disable : rt.enable}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Pencil className="size-4" />
            {rt.edit}
          </button>
          <button
            type="button"
            onClick={() => setSecretsOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <KeyRound className="size-4" />
            {rt.secrets}
          </button>
          {/* Заглушка: привязка задачи к пространству. Пространств пока нет —
              кнопка неактивна, тултип объясняет «скоро». */}
          <button
            type="button"
            disabled
            title={rt.projectsSoon}
            className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
          >
            <FolderKanban className="size-4" />
            {rt.addToProject}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            {rt.delete}
          </button>
        </div>

        {/* Инструкция (2/3 слева) + Прогоны (1/3 справа) в один ряд.
            Высота тела ОБОИХ блоков фиксирована (RUNS_BODY_H) — низ инструкции
            совпадает с низом прогонов, а длинная инструкция скроллится внутри.

            Раньше тут стоял `flex-1` с расчётом «высоту ряда задают прогоны».
            Это работает только пока инструкция КОРОЧЕ: items-stretch тянет
            колонки до самой высокой, поэтому длинная инструкция становилась
            высокой сама, ряд рос под неё, и overflow-y-auto было нечего
            скроллить — блок уезжал вниз. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
          <section className="flex flex-col gap-2 lg:col-span-2">
            <div className="flex h-7 items-center">
              <h2 className="text-sm font-semibold">{rt.instructionLabel}</h2>
            </div>
            <p className={cn(
              RUNS_BODY_H,
              "overflow-y-auto whitespace-pre-wrap rounded-lg border bg-background/40 px-3 py-2.5 text-sm leading-relaxed",
            )}>
              {task.instruction}
            </p>
          </section>

          {/* Заголовок «Прогоны» + пагинация + тело рисует сам RunsPanel. */}
          <div className="min-w-0 lg:col-span-1">
            <RunsPanel taskId={task.id} onOpenRun={onOpenRun} />
          </div>
        </div>

        {/* Файлы: вложения (/inputs) + артефакты (/outputs) — на всю ширину.
            Свой заголовок «Файлы» не нужен: у каждого блока свой (Вложения/Артефакты). */}
        <TaskFiles taskId={task.id} />
      </div>

      <Modal
        open={secretsOpen}
        onClose={() => setSecretsOpen(false)}
        title={rt.secrets}
        className="max-w-xl"
      >
        <SecretsPanel taskId={task.id} />
      </Modal>

      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} title={rt.delete}>
        <p className="text-sm text-muted-foreground">{rt.deleteConfirm}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmDel(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {rt.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDel(false);
              onDelete();
            }}
            className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            {rt.delete}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Список задач + карточка ───────────────────────────────────────────────────

function TaskCard({
  task,
  onOpen,
}: {
  task: RecurringTask;
  onOpen: () => void;
}) {
  const t = useT();
  const rt = t.recurringTasks;
  const spec = cronToSpec(task.schedule);
  const last = task.last_status ? runStatusMeta(task.last_status, t) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-xl border bg-background/40 px-4 py-3 text-left transition-colors hover:border-foreground/30 hover:bg-sidebar-accent"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          task.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Clock className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{task.title}</span>
        <span className="truncate text-xs text-muted-foreground">{humanSchedule(spec, t)}</span>
        {/* Файл TASK.md не разобрался — причина на карточке; планировщик
            такую задачу не берёт, пока файл не починят. */}
        {task.error && (
          <span className="truncate text-xs text-destructive">{task.error}</span>
        )}
      </div>
      {last && <last.Icon className={cn("size-4 shrink-0", last.cls)} />}
      {!task.enabled && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {rt.disabled}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/**
 * Полноэкранный раздел «Регулярные задачи» — тело области чата (хедер остаётся).
 * Виды: список задач → детальный экран задачи. Прогон открывается как НАСТОЯЩАЯ
 * живая сессия чата (onOpenRunThread → воркспейс делает её активной), с полем
 * ввода и возможностью продолжить общение — не read-only пародия.
 */
export function RecurringTasksScreen({
  onOpenRunThread,
  initialTaskId,
  onConsumedInitial,
  onBackChange,
  onAskAssistant,
}: {
  /** Открыть тред прогона как активную сессию чата (живую, с продолжением). */
  onOpenRunThread: (threadId: string) => void;
  /** Начать разговор с ассистентом заготовкой — второй путь создания задачи. */
  onAskAssistant?: (opener: string) => void;
  /** Открыть сразу детальный экран этой задачи (возврат «К задаче» из прогона). */
  initialTaskId?: string | null;
  /** Сообщить наверх, что initialTaskId применён (чтобы сбросить его). */
  onConsumedInitial?: () => void;
  /** Сообщить хедеру воркспейса текущий обработчик «назад» (или null на списке).
   *  Хедер рисует иконку ← и зовёт этот колбэк. */
  onBackChange?: (back: (() => void) | null) => void;
}) {
  const t = useT();
  const rt = t.recurringTasks;
  const api = useRecurringTasks();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RecurringTask | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // «Активные» — работающие задачи, «Архив» — выключенные.
  const [tab, setTab] = React.useState<"active" | "archive">("active");
  const [formError, setFormError] = React.useState<string | null>(null);

  // Возврат «К задаче» из прогона: открываем сразу её детальный экран.
  React.useEffect(() => {
    if (initialTaskId) {
      setSelectedId(initialTaskId);
      onConsumedInitial?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  // Сообщаем хедеру обработчик «назад» по текущему виду:
  //  форма → закрыть форму; детали → к списку; список → назад нечего (null).
  React.useEffect(() => {
    let back: (() => void) | null = null;
    if (formOpen) back = () => { setFormOpen(false); setEditing(null); };
    else if (selectedId) back = () => setSelectedId(null);
    onBackChange?.(back);
    return () => onBackChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, selectedId]);

  const selected = api.tasks.find((x) => x.id === selectedId) ?? null;

  const visible = api.tasks.filter((task) => (tab === "active" ? task.enabled : !task.enabled));

  // Черновиков нет: задача рождается при сохранении формы. Секреты и вложения,
  // набранные до этого, форма держит у себя и привязывает следом (extras).
  const openCreateForm = React.useCallback(() => {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const closeForm = React.useCallback(() => {
    setFormOpen(false);
    setEditing(null);
    setFormError(null);
  }, []);

  const submit = async (
    input: {
      title: string;
      instruction: string;
      schedule: string;
      timezone: string;
      agent_id: string;
      agent_config: Record<string, unknown>;
      error_policy: Record<string, unknown>;
    },
    extras: TaskExtras,
  ) => {
    setSubmitting(true);
    setFormError(null);
    try {
      if (editing) {
        await api.update(editing.id, input);
        closeForm();
        return;
      }
      const created = await api.create(input);
      const problems = await attachTaskExtras(created.id, extras);
      if (problems.length > 0) {
        // Задача уже есть — переводим форму в правку ЕЁ, с объяснением, что
        // не прикрепилось: молча закрыть значило бы потерять введённый секрет.
        setEditing(created);
        setFormError(rt.createdWithProblems(problems.join("; ")));
        return;
      }
      setSelectedId(created.id);
      closeForm();
    } catch {
      setFormError(rt.saveFailed);
    } finally {
      setSubmitting(false);
    }
  };

  // Форма создания/редактирования — отдельный ВИД раздела на весь экран (не попап).
  // ВАЖНО: проверяем ДО selected — иначе «Изменить» (открытое с детального экрана,
  // где selectedId ещё установлен) не показало бы форму, а осталось на деталях.
  if (formOpen) {
    return (
      <TaskForm
        initial={editing ?? undefined}
        taskId={editing?.id}
        submitting={submitting}
        error={formError}
        onCancel={closeForm}
        onSubmit={submit}
      />
    );
  }

  // Детальный экран выбранной задачи.
  if (selected) {
    return (
      <TaskDetail
        task={selected}
        onEdit={() => {
          setEditing(selected);
          setFormOpen(true);
        }}
        onDelete={async () => {
          await api.remove(selected.id);
          setSelectedId(null);
        }}
        onToggle={(en) => api.toggle(selected.id, en)}
        onRunNow={() => api.runNow(selected.id)}
        onOpenRun={onOpenRunThread}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full flex-col gap-5 p-6">
        {/* Один ряд: вкладки + кнопка создания. Заголовка здесь НЕТ — его
            рисует хедер воркспейса (как в «Моих агентах»). */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {([
              ["active", rt.tabActive],
              ["archive", rt.tabArchive],
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
          {/* Та же развилка и тем же компонентом, что у агентов, навыков и
              пространств: форма требует заранее знать расписание и текст
              задачи, а разговор это вырабатывает — ассистент заодно подберёт
              время и соберёт саму работу, чего форма не умеет. */}
          <div className="ml-auto shrink-0">
            <CreateButton
              label={rt.create}
              manual={{ label: rt.createManual, hint: rt.createManualHint }}
              assisted={{
                label: rt.createWithAssistant,
                hint: rt.createWithAssistantHint,
              }}
              onManual={() => void openCreateForm()}
              onAssisted={() => onAskAssistant?.(rt.assistantOpener)}
            />
          </div>
        </div>

        {!api.loaded ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t.files.loading}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            {tab === "archive" ? rt.emptyArchive : rt.empty}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onOpen={() => setSelectedId(task.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
