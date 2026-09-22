"use client";

import * as React from "react";
import { Check, Loader2, Plug, ShieldCheck, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { connectionSubtitle } from "@/lib/connection-card";
import {
  deleteAgentConnection,
  fetchAgentConnections,
  saveAgentConnection,
  type AgentConnection,
  type ConnectionForm,
} from "@/lib/api";

/** Подключения агента — УНИВЕРСАЛЬНЫЕ.
 *
 *  Здесь нет ни одного имени вида подключения и ни одного имени поля: и то и
 *  другое приходит с бэкенда, который читает описание из конфига агента
 *  (agents/<slug>/connections/<вид>.yaml). Новый вид подключения — файл рядом
 *  с агентом, без правок этого файла.
 *
 *  ДВЕ ЧАСТИ. Кнопка-строка на карточке агента (состояние + действие) и окно
 *  с формой. Форма — прямо в окне, без вложенных модалок: окно на один вид
 *  показывает одну форму, на несколько — несколько секций подряд.
 */

// ── Кнопка на карточке ───────────────────────────────────────────────────────

function fromForms(forms: ConnectionForm[]): AgentConnection[] {
  return forms.map((f) => ({ ...f, connected: false, values: {}, updated_at: null }));
}

/** ОДНА кнопка на карточке агента: «Подключить» или «Подключено».
 *
 *  Состояние «нужно подключение» приходит с записью агента (missing) — кнопка
 *  рисуется верно с первого кадра, без запроса. Список подключений с
 *  открытыми полями подгружается, когда окно открыто.
 */
export function AgentConnectionsButton({
  slug,
  forms,
  missing,
  onChanged,
}: {
  slug: string;
  forms: ConnectionForm[];
  /** Есть подключения, которых у человека нет (из записи агента). */
  missing: boolean;
  /** После подключения/отключения: перечитать агентов — сервер решает,
   *  выключен ли агент, и выбор над полем ввода должен это увидеть. */
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<AgentConnection[] | null>(null);

  const reload = React.useCallback(() => {
    fetchAgentConnections(slug).then(setState);
  }, [slug]);

  React.useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  if (forms.length === 0) return null;

  const conns = state ?? fromForms(forms);
  const single = conns.length === 1;

  return (
    <>
      {/* Обычная серая кнопка; подключено — зеленеет. Без акцентного цвета:
          это действие настройки, а не призыв. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "min-w-28",
          !missing &&
            "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300",
        )}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {missing ? <Plug data-icon="inline-start" /> : <Check data-icon="inline-start" />}
        {missing ? "Подключить" : "Подключено"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Plug className="size-4" />
            </span>
            <h2 className="min-w-0 truncate text-lg font-semibold">
              {single ? conns[0].title : "Подключения"}
            </h2>
          </div>
        }
        className="max-w-lg"
      >
        <div className="flex flex-col gap-5">
          {conns.map((c, i) => (
            <React.Fragment key={c.kind}>
              {i > 0 && <div className="h-px bg-border" />}
              <ConnectionSection
                // Ключ включает сохранённые значения: после подключения или
                // отключения секция пересоздаётся с актуальными полями.
                key={`${c.kind}:${c.connected}:${JSON.stringify(c.values)}`}
                conn={c}
                slug={slug}
                showTitle={!single}
                loading={state === null}
                onChanged={() => {
                  reload();
                  onChanged();
                }}
                onDone={() => setOpen(false)}
              />
            </React.Fragment>
          ))}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            {/* Без «логин и пароль»: какие поля у подключения, знает описание —
                у токена или адреса шары та же судьба. */}
            <span>
              Данные подключения хранятся на этом компьютере в зашифрованном
              виде и никуда не отправляются.
            </span>
          </p>
        </div>
      </Modal>
    </>
  );
}

// ── Секция одного подключения в окне ────────────────────────────────────────

function formatUpdated(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function ConnectionSection({
  conn,
  slug,
  showTitle,
  loading,
  onChanged,
  onDone,
}: {
  conn: AgentConnection;
  slug: string;
  showTitle: boolean;
  loading: boolean;
  onChanged: () => void;
  onDone: () => void;
}) {
  // Открытые поля предзаполняем сохранённым: переподключаясь из-за смены
  // пароля, человек не должен вводить логин заново. Секретные остаются
  // пустыми — их значения сервер не отдаёт, и подставить туда звёздочки
  // значило бы отправить их назад как настоящий пароль.
  // Начальные значения — из пропса при монтировании; родитель перемонтирует
  // секцию ключом, когда сохранённые значения меняются (см. key выше), так что
  // эффекта «скопировать пропс в состояние» не нужно.
  const [values, setValues] = React.useState<Record<string, string>>(() => ({ ...conn.values }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await saveAgentConnection(slug, conn.kind, values);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    onChanged();
    // Дать увидеть «подключено», потом закрыть.
    window.setTimeout(onDone, 700);
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    await deleteAgentConnection(slug, conn.kind);
    setBusy(false);
    setValues({});
    onChanged();
  };

  const sub = connectionSubtitle(conn);
  const updated = formatUpdated(conn.updated_at);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit();
      }}
    >
      {/* Состояние: подключено чем и когда, либо зачем это нужно. */}
      <div className="flex flex-col gap-1.5">
        {showTitle && (
          <div className="text-sm font-semibold text-foreground">{conn.title}</div>
        )}
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            conn.connected
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : conn.connected ? (
            <Check className="size-4 shrink-0" />
          ) : (
            <Unplug className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {loading
              ? "Проверяю состояние…"
              : conn.connected
                ? `Подключено${sub ? ` · ${sub}` : ""}`
                : "Не подключено"}
          </span>
          {conn.connected && updated && (
            <span className="shrink-0 text-xs opacity-70">{updated}</span>
          )}
        </div>
        {conn.description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {conn.description}
          </p>
        )}
      </div>

      {/* Поля — по описанию вида. Тип по ПОМЕТКЕ ИЗ ОПИСАНИЯ, а не по имени:
          маскировка следует за тем же признаком, по которому бэкенд шифрует. */}
      <div className="flex flex-col gap-3">
        {conn.fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {f.label}
              {!f.required && (
                <span className="ml-1 font-normal text-muted-foreground">
                  — необязательно
                </span>
              )}
            </span>
            <Input
              type={f.secret ? "password" : "text"}
              autoComplete={f.secret ? "new-password" : "off"}
              placeholder={f.placeholder}
              value={values[f.name] ?? ""}
              disabled={busy}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.name]: e.target.value }))
              }
            />
            {f.hint && (
              <span className="text-[11px] leading-snug text-muted-foreground">
                {f.hint}
              </span>
            )}
          </label>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {conn.connected && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={disconnect}
          >
            <Unplug data-icon="inline-start" />
            Отключить
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={busy || saved}>
            {busy ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : saved ? (
              <Check data-icon="inline-start" />
            ) : null}
            {saved ? "Подключено" : conn.connected ? "Сохранить" : "Подключить"}
          </Button>
        </div>
      </div>
    </form>
  );
}
