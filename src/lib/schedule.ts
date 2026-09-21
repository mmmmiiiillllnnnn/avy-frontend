/**
 * Человеческий конструктор расписания ⇄ cron. Пользователь НИКОГДА не видит cron.
 * Расписание задаётся понятными выпадашками; cron собирается внутри (5 полей, как
 * ждёт бэк croniter), обратно разбирается, чтобы форма редактирования показала те
 * же выпадашки, а не «непонятную строку».
 *
 * Виды:
 *  - daily     — каждый день в ЧЧ:ММ
 *  - weekdays  — по будням (пн–пт) в ЧЧ:ММ
 *  - weekly    — раз в неделю в выбранный день в ЧЧ:ММ
 *  - interval  — «каждые N минут/часов» (гибкая частота: 5/10/15/30 мин, 1..12 ч)
 * «Своё расписание» = interval, тоже полностью человеческое (число + единица из
 * выпадашек), НИКАКОГО ручного cron.
 */

export type ScheduleKind = "daily" | "weekdays" | "weekly" | "interval";
export type IntervalUnit = "minutes" | "hours";

export type ScheduleSpec = {
  kind: ScheduleKind;
  hour: number; // 0..23 (daily/weekdays/weekly)
  minute: number; // 0..59 (daily/weekdays/weekly)
  weekday: number; // 0..6 (вс..сб), для weekly
  every: number; // N для interval (каждые N единиц)
  unit: IntervalUnit; // единица для interval
};

/** Спецификация → cron (5 полей). Всегда валиден: строим сами, не парсим ввод. */
export function specToCron(s: ScheduleSpec): string {
  const m = clampMinute(s.minute);
  const h = clampHour(s.hour);
  switch (s.kind) {
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${clampWeekday(s.weekday)}`;
    case "interval": {
      const n = clampEvery(s.every);
      // Каждые N минут: "*/N * * * *"; каждые N часов: "0 */N * * *".
      return s.unit === "minutes" ? `*/${n} * * * *` : `0 */${n} * * *`;
    }
  }
}

/** Разобрать cron в спецификацию (для формы редактирования). */
export function cronToSpec(cron: string): ScheduleSpec {
  const base = defaultSpec();
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return base;
  const [mn, hr, dom, mon, dow] = parts;
  const numOk = (v: string) => /^\d+$/.test(v);
  const m = Number(mn);
  const h = Number(hr);

  // Каждые N минут: "*/N * * * *"
  const minStep = /^\*\/(\d+)$/.exec(mn);
  if (minStep && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...base, kind: "interval", unit: "minutes", every: Number(minStep[1]) };
  }
  // Каждые N часов: "0 */N * * *" (или "M */N * * *")
  const hrStep = /^\*\/(\d+)$/.exec(hr);
  if (numOk(mn) && hrStep && dom === "*" && mon === "*" && dow === "*") {
    return { ...base, kind: "interval", unit: "hours", every: Number(hrStep[1]), minute: m };
  }
  // По будням: "M H * * 1-5"
  if (numOk(mn) && numOk(hr) && dom === "*" && mon === "*" && dow === "1-5") {
    return { ...base, kind: "weekdays", minute: m, hour: h };
  }
  // Раз в неделю: "M H * * D"
  if (numOk(mn) && numOk(hr) && dom === "*" && mon === "*" && numOk(dow)) {
    return { ...base, kind: "weekly", minute: m, hour: h, weekday: Number(dow) };
  }
  // Ежедневно: "M H * * *"
  if (numOk(mn) && numOk(hr) && dom === "*" && mon === "*" && dow === "*") {
    return { ...base, kind: "daily", minute: m, hour: h };
  }
  return base;
}

/** Дефолт для новой задачи: каждый день в 9:00. */
export function defaultSpec(): ScheduleSpec {
  return { kind: "daily", hour: 9, minute: 0, weekday: 1, every: 1, unit: "hours" };
}

/** Допустимые N для «каждые N минут» и «каждые N часов» (делители, дающие ровные слоты). */
export const MINUTE_STEPS = [5, 10, 15, 20, 30];
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];

const clampMinute = (n: number) => Math.max(0, Math.min(59, Math.floor(n || 0)));
const clampHour = (n: number) => Math.max(0, Math.min(23, Math.floor(n || 0)));
const clampWeekday = (n: number) => Math.max(0, Math.min(6, Math.floor(n || 0)));
const clampEvery = (n: number) => Math.max(1, Math.floor(n || 1));
