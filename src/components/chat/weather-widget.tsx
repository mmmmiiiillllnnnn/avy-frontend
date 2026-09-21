"use client";

/**
 * Виджет погоды под шагом get_weather — во всю ширину колонки чата.
 *
 * Показывается ВМЕСТО текста тулы: сам текст уходит только модели (см.
 * server/streaming.py, has_render_artifact). Поэтому здесь должны быть все
 * данные, которые пользователю нужны, — он больше их нигде не увидит.
 *
 * Сцена собирается из размытых слоёв, а не из фигур с чётким контуром: облако —
 * пять эллипсов разной плотности под общим blur, солнце — ядро плюс рассеянный
 * ореол. Осадки идут с разбросом по скорости и прозрачности, это читается как
 * глубина. Всё на CSS; при prefers-reduced-motion анимация выключается.
 */

import { useMemo } from "react";

import type { Weather, WeatherCondition, WeatherDay, WeatherHour } from "@/lib/chat-streams";
import { useLocale, useT } from "@/i18n/i18n-context";
import type { Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";

/** Фон сцены. Дневная и ночная палитры разведены: ночью небо не осветляется
 *  к горизонту так же сильно, иначе выглядит как пасмурный день. */
function gradient(c: WeatherCondition, isDay: boolean): string {
  if (!isDay) {
    if (c === "rain" || c === "drizzle" || c === "freezing-rain")
      return "linear-gradient(168deg,#1B2634 0%,#2B3B4E 55%,#3A4C63 100%)";
    if (c === "snow") return "linear-gradient(168deg,#223045 0%,#3B4E68 60%,#516782 100%)";
    if (c === "thunderstorm") return "linear-gradient(168deg,#121219 0%,#26232F 55%,#3A3548 100%)";
    if (c === "overcast" || c === "fog")
      return "linear-gradient(168deg,#1A2231 0%,#2C3849 55%,#3E4C60 100%)";
    return "linear-gradient(168deg,#0F1B33 0%,#1E2E4F 52%,#33456B 100%)";
  }
  switch (c) {
    case "clear": return "linear-gradient(168deg,#2E86D4 0%,#57A9E4 45%,#9AD4F2 100%)";
    case "mostly-clear": return "linear-gradient(168deg,#3C92D8 0%,#6DB6E6 48%,#AAD9EF 100%)";
    case "partly-cloudy": return "linear-gradient(168deg,#4C8DBD 0%,#7BAACD 50%,#AFC9DC 100%)";
    case "overcast": return "linear-gradient(168deg,#6E7E90 0%,#93A1B0 52%,#B4BFCA 100%)";
    case "fog": return "linear-gradient(168deg,#8B97A3 0%,#AEB8C1 50%,#CBD2D8 100%)";
    case "drizzle": return "linear-gradient(168deg,#4E6577 0%,#758B9C 52%,#9BADBB 100%)";
    case "rain": return "linear-gradient(168deg,#3B4C5C 0%,#5C7183 52%,#8496A6 100%)";
    case "freezing-rain": return "linear-gradient(168deg,#4A6270 0%,#728E9D 52%,#9DB6C3 100%)";
    case "snow": return "linear-gradient(168deg,#75899E 0%,#9FB2C6 52%,#CBD9E6 100%)";
    case "thunderstorm": return "linear-gradient(168deg,#22222F 0%,#3B3648 52%,#565068 100%)";
    default: return "linear-gradient(168deg,#61707F 0%,#8B99A6 52%,#AFBAC4 100%)";
  }
}

/** Комки облака: основание длинное и плоское, верх клубится. */
const CLOUD_PARTS: [number, number, number, number, number][] = [
  [0.0, 0.42, 0.62, 0.52, 0.95],
  [0.3, 0.1, 0.46, 0.78, 1.0],
  [0.52, 0.3, 0.4, 0.62, 0.9],
  [0.16, 0.34, 0.34, 0.58, 0.85],
  [0.62, 0.46, 0.44, 0.48, 0.8],
];

type CloudProps = {
  x: number; y: number; w: number; opacity: number;
  dur: number; delay: number; tint: string; blur: number; seed: number;
};

function Cloud({ x, y, w, opacity, dur, delay, tint, blur, seed }: CloudProps) {
  return (
    <div
      className="wx-cloud absolute"
      style={{
        left: `${x}%`, top: `${y}%`, width: w, height: w * 0.42,
        color: tint, opacity, filter: `blur(${blur}px)`,
        ["--x0" as string]: -w * 0.1,
        ["--x1" as string]: w * 0.1,
        ["--dy" as string]: (seed % 3) - 1,
        animation: `wx-float ${dur}s ease-in-out ${delay}s infinite alternate`,
      }}
    >
      {CLOUD_PARTS.map(([px, py, pw, ph, op], i) => (
        <i
          key={i}
          className="absolute block rounded-full"
          style={{
            left: `${(px + ((seed * (i + 3)) % 7) / 100) * 100}%`,
            top: `${py * 100}%`,
            width: `${pw * 100}%`,
            height: `${ph * 100}%`,
            opacity: op,
            background: "currentColor",
          }}
        />
      ))}
    </div>
  );
}

/** Погодная сцена — фон верхней части виджета. */
function Scene({
  condition,
  isDay,
}: {
  condition: WeatherCondition;
  isDay: boolean;
}) {
  const H = 300;

  // Пересобираем только при смене погоды: капли/снежинки — десятки узлов.
  const precip = useMemo(() => {
    const c = condition;
    if (c === "rain" || c === "drizzle" || c === "freezing-rain" || c === "thunderstorm") {
      const heavy = c === "rain" || c === "thunderstorm";
      return Array.from({ length: heavy ? 46 : 30 }, (_, i) => {
        const depth = (i % 5) / 4; // 0 — близко, 1 — далеко
        return (
          <span
            key={i}
            className="wx-drop absolute rounded-[2px]"
            style={{
              left: `${48 + ((i * 73) % 54)}%`,
              top: `${-8 - (i % 6) * 6}%`,
              width: 1.5 - depth * 0.5,
              height: (heavy ? 16 : 9) * (1 - depth * 0.45),
              opacity: 0.85 - depth * 0.45,
              transform: `rotate(${heavy ? 12 : 7}deg)`,
              ["--dist" as string]: H + 40,
              ["--drift" as string]: heavy ? 34 : 20,
              animationDuration: `${(heavy ? 0.62 : 1.15) + depth * 0.5}s`,
              animationDelay: `${-(i % 11) * 0.17}s`,
            }}
          />
        );
      });
    }
    if (c === "snow") {
      return Array.from({ length: 30 }, (_, i) => {
        const depth = (i % 4) / 3;
        const d = 5.5 - depth * 2.8;
        return (
          <span
            key={i}
            className="wx-flake absolute rounded-full"
            style={{
              left: `${48 + ((i * 67) % 54)}%`,
              top: `${-6 - (i % 5) * 7}%`,
              width: d, height: d,
              opacity: 0.95 - depth * 0.4,
              ["--dist" as string]: H + 40,
              ["--drift" as string]: 26 + (i % 5) * 9,
              animationDuration: `${7 + depth * 5 + (i % 3)}s`,
              animationDelay: `${-(i % 13) * 0.8}s`,
            }}
          />
        );
      });
    }
    return null;
  }, [condition]);

  const c = condition;
  const clearish = c === "clear" || c === "mostly-clear" || c === "partly-cloudy";
  const size = 62;
  const rx = 72;
  const ry = 10;

  const white = "rgba(255,255,255,.95)";
  const grey = isDay ? "rgba(226,232,240,.96)" : "rgba(150,164,184,.92)";
  const dark = isDay ? "rgba(190,200,213,.97)" : "rgba(104,116,136,.95)";
  const wet =
    c === "drizzle" || c === "rain" || c === "snow" ||
    c === "freezing-rain" || c === "thunderstorm";

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: gradient(c, isDay) }}>
      {clearish && (isDay ? (
        <>
          <div className="wx-sun-glow absolute rounded-full" style={{
            width: size * 2.6, height: size * 2.6, left: `${rx}%`, top: `${ry}%`,
            margin: `-${size * 0.8}px 0 0 -${size * 0.8}px`,
          }} />
          <div className="wx-sun absolute rounded-full" style={{
            width: size, height: size, left: `${rx}%`, top: `${ry}%`,
          }} />
        </>
      ) : (
        <>
          <div className="wx-moon-glow absolute rounded-full" style={{
            width: size * 2.2, height: size * 2.2, left: `${rx}%`, top: `${ry}%`,
            margin: `-${size * 0.6}px 0 0 -${size * 0.6}px`,
          }} />
          <div className="wx-moon absolute rounded-full" style={{
            width: size * 0.72, height: size * 0.72, left: `${rx}%`, top: `${ry}%`,
          }} />
        </>
      ))}

      {c === "mostly-clear" && (
        <Cloud x={62} y={52} w={120} opacity={0.55} dur={26} delay={0}
               tint={white} blur={5} seed={3} />
      )}
      {c === "partly-cloudy" && (
        <>
          <Cloud x={54} y={38} w={150} opacity={0.92} dur={30} delay={0}
                 tint={white} blur={4} seed={5} />
          <Cloud x={78} y={14} w={110} opacity={0.62} dur={38} delay={-6}
                 tint={white} blur={6} seed={2} />
        </>
      )}
      {(c === "overcast" || c === "fog") && (
        <>
          <Cloud x={50} y={2} w={200} opacity={0.86} dur={34} delay={0}
                 tint={grey} blur={7} seed={4} />
          <Cloud x={76} y={-6} w={180} opacity={0.78} dur={42} delay={-8}
                 tint={grey} blur={8} seed={7} />
        </>
      )}
      {wet && (
        <>
          <Cloud x={50} y={-4} w={210} opacity={0.92} dur={36} delay={0}
                 tint={dark} blur={6} seed={6} />
          <Cloud x={78} y={4} w={170} opacity={0.84} dur={44} delay={-9}
                 tint={dark} blur={8} seed={9} />
        </>
      )}

      {precip}
      {c === "thunderstorm" && <div className="wx-bolt absolute inset-0" />}
      {c === "fog" && ([[16, 32, 11], [44, 26, 15], [68, 34, 9]] as const).map(
        ([top, h, dur], i) => (
          <div key={i} className="wx-fog absolute" style={{
            top: `${top}%`, height: `${h}%`, opacity: 0.75 - i * 0.12,
            animationDuration: `${dur}s`, animationDelay: `${-i * 2.4}s`,
          }} />
        ),
      )}
    </div>
  );
}

/** День недели из ISO-даты, коротко. */
function dayName(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", { weekday: "short" });
}

/** Число и месяц: без них «пн/вт» не привязаны к календарю, а прогноз бывает
 *  и на произвольный диапазон дат, не только на ближайшие дни. */
function dayDate(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Иконка погоды для дня прогноза. Именно ИКОНКА, а не уменьшенная сцена:
 * миниатюра сцены на 30×22 давала цветные прямоугольники с обрезанным солнцем —
 * солнце позиционируется в процентах и вылезало за край, а облако под blur
 * превращалось в пятно. Сцена рассчитана на 300px высоты, не на 22.
 */
function DayIcon({ condition }: { condition: WeatherCondition }) {
  const sun = <circle cx="17" cy="10" r="5.5" fill="#FDB813" />;
  const cloudPath =
    "M8.5 21c-2.5 0-4.5-2-4.5-4.4 0-2.2 1.7-4.1 3.9-4.4C8.6 9.6 11 7.8 13.9 7.8c3.3 0 6 2.5 6.3 5.7 1.9.3 3.3 1.9 3.3 3.8 0 2.1-1.8 3.7-3.9 3.7H8.5z";

  const clouds = (fill: string, stroke?: string) => (
    <path d={cloudPath} fill={fill} stroke={stroke} strokeWidth={stroke ? 0.6 : 0} />
  );
  const drops = (color: string) =>
    [10, 15, 20].map((x, i) => (
      <line key={i} x1={x} y1={22.5} x2={x - 1.6} y2={26} stroke={color}
            strokeWidth="1.6" strokeLinecap="round" opacity={0.85} />
    ));

  let body: React.ReactNode;
  switch (condition) {
    case "clear":
      body = <circle cx="14" cy="14" r="7.5" fill="#FDB813" />;
      break;
    case "mostly-clear":
      body = <>{sun}{clouds("#E8EDF3")}</>;
      break;
    case "partly-cloudy":
      body = <>{sun}{clouds("#DCE3EB")}</>;
      break;
    case "overcast":
      body = <>{clouds("#B9C3CF")}{clouds("#D3DAE3")}</>;
      break;
    case "fog":
      body = (
        <>
          {clouds("#CFD6DE")}
          {[23, 26].map((y, i) => (
            <line key={i} x1="6" y1={y} x2="22" y2={y} stroke="#B4BEC9"
                  strokeWidth="1.5" strokeLinecap="round" opacity={0.8} />
          ))}
        </>
      );
      break;
    case "drizzle":
      body = <>{clouds("#AEB9C6")}{drops("#7FB2E0")}</>;
      break;
    case "rain":
    case "freezing-rain":
      body = <>{clouds("#94A2B2")}{drops("#4A90D9")}</>;
      break;
    case "snow":
      body = (
        <>
          {clouds("#B4C0CE")}
          {[10, 15, 20].map((x, i) => (
            <circle key={i} cx={x} cy={24.5} r="1.5" fill="#8FB8DC" />
          ))}
        </>
      );
      break;
    case "thunderstorm":
      body = (
        <>
          {clouds("#7C8A9A")}
          <path d="M15 21.5l-4 5.5h3l-1.5 4.5 5-6h-3l1.5-4z" fill="#F5C542" />
        </>
      );
      break;
    default:
      body = clouds("#C3CCD7");
  }
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      {body}
    </svg>
  );
}

export function WeatherWidget({ weather }: { weather: Weather }) {
  const { locale } = useLocale();
  const t = useT().chat.weather;
  const place = [weather.city, weather.country].filter(Boolean).join(", ");
  const days: WeatherDay[] = weather.forecast ?? [];
  const hours: WeatherHour[] = weather.hours ?? [];

  // Режим виджета (решает бэкенд по тому, ЧТО спросили):
  //   now    — сегодня: крупная текущая температура + часы до конца суток;
  //   day    — другой конкретный день: вверху ЕГО погода + его часы;
  //   period — несколько дней: низкая сцена + таблица дней.
  const view = weather.view ?? (days.length > 1 ? "period" : "now");
  const isPeriod = view === "period";
  const showHours = view !== "period" && hours.length > 0;

  // День, про который спрашивали (для view=day: его температуры и заголовок).
  const target =
    days.find((d) => d.date === weather.targetDate) ?? days[0] ?? null;
  // Сводка дня для чипов: у «сегодня» — сегодняшняя, у другого дня — его.
  const dayInfo = view === "now" ? (weather.today ?? target) : target;

  // Время места приходит от API уже пересчитанным по его часовому поясу,
  // поэтому берём подстроку, а не new Date() — иначе браузер сдвинет его
  // ещё раз, в пояс пользователя.
  const localTime = view === "now" ? (weather.observedAt ?? "").slice(11, 16) : "";
  const sunEvent = dayInfo
    ? weather.isDay && view === "now"
      ? dayInfo.sunset
        ? { label: t.sunset, value: dayInfo.sunset }
        : null
      : dayInfo.sunrise
        ? { label: t.sunrise, value: dayInfo.sunrise }
        : null
    : null;

  return (
    <div className="my-2 w-full overflow-hidden rounded-2xl border border-border/70 shadow-sm">
      {/* period (несколько дней) — сцена НИЗКАЯ и без крупной температуры:
          «сейчас 24°» не отвечает на вопрос про неделю и съедало пол-виджета.
          now/day — полная сцена с температурой того дня. */}
      <div className={cn("relative", isPeriod ? "min-h-[76px]" : "min-h-[178px]")}>
        <Scene condition={weather.condition} isDay={weather.isDay} />
        {/* text-white только здесь: низ виджета живёт в палитре чата. */}
        {/* Всё содержимое — компактной группой слева сверху. На всю ширину
            чата растягивается СЦЕНА, а не текст: иначе между городом и
            температурой зияет дыра, а цифра тонет внизу широкой карточки. */}
        <div
          className={cn(
            "relative flex flex-col items-start gap-2 p-[18px] text-white",
            isPeriod ? "min-h-[76px] justify-center py-3.5" : "min-h-[178px] pb-4",
          )}
        >
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-white/20 bg-white/15 px-3 py-[5px] text-xs font-medium backdrop-blur-md">
              {place}
            </div>
            {/* Время МЕСТА: «сейчас 11:15» в Дубае осмысленнее, чем 10:15 по
                часам пользователя. У других дней времени нет — там дата. */}
            {localTime ? (
              <span
                className="text-xs tabular-nums opacity-90"
                style={{ textShadow: "0 1px 3px rgba(0,0,0,.3)" }}
              >
                {localTime}
              </span>
            ) : null}
            {view !== "now" && target ? (
              <span
                className="text-xs opacity-90"
                style={{ textShadow: "0 1px 3px rgba(0,0,0,.3)" }}
              >
                {isPeriod && days.length > 1
                  ? `${dayDate(days[0].date, locale)} — ${dayDate(days[days.length - 1].date, locale)}`
                  : `${dayName(target.date, locale)}, ${dayDate(target.date, locale)}`}
              </span>
            ) : null}
          </div>

          {!isPeriod && (
            <>
              <div>
                <div className="flex items-baseline gap-3">
                  <div
                    className="text-[56px] font-normal leading-none tracking-[-.02em] tabular-nums"
                    style={{ textShadow: "0 2px 10px rgba(0,0,0,.25)" }}
                  >
                    {/* Для «сегодня» — текущая температура, для другого дня —
                        его максимум: «сейчас» там показывать нечего. */}
                    {view === "now"
                      ? Math.round(weather.temperature)
                      : Math.round(target?.max ?? weather.temperature)}
                    °
                  </div>
                  {dayInfo ? (
                    <div
                      className="text-[15px] tabular-nums opacity-90"
                      style={{ textShadow: "0 1px 3px rgba(0,0,0,.3)" }}
                    >
                      {Math.round(dayInfo.max)}° / {Math.round(dayInfo.min)}°
                    </div>
                  ) : null}
                </div>
                <div
                  className="mt-1.5 text-[13px] opacity-95"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,.25)" }}
                >
                  {/* Описание берём из словаря по machine-коду condition:
                      weather.description приходит с бэкенда всегда по-русски. */}
                  {t.conditions[weather.condition] ?? weather.description}
                  {/* Осадки — то, ради чего погоду обычно и смотрят. */}
                  {dayInfo?.precipitation ? (
                    <> · {t.precip} {dayInfo.precipitation}%</>
                  ) : null}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-[7px]">
                {view === "now" ? (
                  <>
                    <Chip label={t.feels} value={`${Math.round(weather.feelsLike)}°`} />
                    <Chip label={t.humidity} value={`${weather.humidity}%`} />
                    <Chip label={t.wind} value={`${weather.windSpeed}`} suffix={t.kmh} />
                  </>
                ) : dayInfo?.windMax ? (
                  <Chip label={t.wind} value={`${dayInfo.windMax}`} suffix={t.kmh} />
                ) : null}
                {sunEvent ? <Chip label={sunEvent.label} value={sunEvent.value} /> : null}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Спросили про сегодня — внизу ЧАСЫ («будет ли дождь к вечеру»), про
          несколько дней — дни. Режим выбирает бэкенд по запрошенному
          диапазону (weather.view). */}
      {showHours ? (
        <div className="bg-card text-card-foreground">
          <div className="px-3.5 pb-1 pt-2 text-[10.5px] uppercase tracking-[.06em] text-muted-foreground">
            {t.today}
          </div>
          <div className="flex gap-1 overflow-x-auto px-2 pb-2.5">
            {hours.map((h) => (
              <div
                key={h.time}
                className="flex min-w-[54px] flex-1 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center transition-colors hover:bg-muted/60"
              >
                <div className="text-[11px] font-semibold tabular-nums leading-tight">
                  {h.time}
                </div>
                <DayIcon condition={h.condition} />
                <div className="text-[12.5px] font-semibold tabular-nums">
                  {h.temp === null ? "—" : `${Math.round(h.temp)}°`}
                </div>
                <div
                  className="flex h-[14px] items-center justify-center gap-[2px] text-[10px] tabular-nums text-sky-600 dark:text-sky-400"
                  title={t.precip}
                >
                  {h.precipitation ? (
                    <>
                      <svg width="7" height="9" viewBox="0 0 9 11" fill="currentColor" aria-hidden="true">
                        <path d="M4.5 0C4.5 0 0 5.2 0 7.2 0 9.3 2 11 4.5 11S9 9.3 9 7.2C9 5.2 4.5 0 4.5 0z" />
                      </svg>
                      {h.precipitation}%
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : days.length > 0 ? (
        <div className="bg-card text-card-foreground">
          {/* Заголовок колонок: без него проценты внизу читались как загадка —
              «84%» чего именно, было непонятно. */}
          <div className="px-3.5 pb-1 pt-2 text-[10.5px] uppercase tracking-[.06em] text-muted-foreground">
            {t.forecast}
          </div>
          <div className="flex gap-1 overflow-x-auto px-2 pb-2.5">
          {days.map((d) => (
            <div
              key={d.date}
              className="flex min-w-[62px] flex-1 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center transition-colors hover:bg-muted/60"
            >
              <div className="text-[11px] font-semibold capitalize leading-tight">
                {dayName(d.date, locale)}
              </div>
              <div className="text-[10px] leading-tight text-muted-foreground">
                {dayDate(d.date, locale)}
              </div>
              {/* Иконка, а не уменьшенная сцена: на 30×22 сцена давала
                  обрезанный круг солнца — в ясные дни читалась как цветной
                  прямоугольник. */}
              <DayIcon condition={d.condition} />
              <div className="text-[12.5px] tabular-nums">
                <b className="font-semibold">{Math.round(d.max)}°</b>
                <i className="ml-1 not-italic text-muted-foreground">{Math.round(d.min)}°</i>
              </div>
              {/* Капля вместо заголовка колонки: объясняет, что за процент,
                  и не занимает строку над прогнозом. Высота фиксирована —
                  день без осадков не должен быть ниже соседних. */}
              <div
                className="flex h-[14px] items-center justify-center gap-[2px] text-[10px] tabular-nums text-sky-600 dark:text-sky-400"
                title={t.precip}
              >
                {d.precipitation ? (
                  <>
                    <svg width="7" height="9" viewBox="0 0 9 11" fill="currentColor" aria-hidden="true">
                      <path d="M4.5 0C4.5 0 0 5.2 0 7.2 0 9.3 2 11 4.5 11S9 9.3 9 7.2C9 5.2 4.5 0 4.5 0z" />
                    </svg>
                    {d.precipitation}%
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
          ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-border/60 bg-card px-3.5 pb-2 pt-1.5 text-right text-[10.5px] text-muted-foreground">
        {t.source}:{" "}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Open-Meteo
        </a>
      </div>
    </div>
  );
}

function Chip({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex items-baseline gap-[5px] whitespace-nowrap rounded-lg border border-white/[.17] bg-white/[.13] px-2.5 py-1.5 text-[11.5px] tabular-nums backdrop-blur-md">
      <span className="opacity-[.74]">{label}</span>
      <b className="font-semibold">{value}</b>
      {suffix ? <span className="opacity-[.74]">{suffix}</span> : null}
    </div>
  );
}
