"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Globe, MessageSquareText, Sparkles, type LucideIcon } from "lucide-react";
import { toolIcon } from "@/lib/tool-icons";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { FlowButton } from "@/components/ui/flow-button";
import { ImageThumb, imagePath, isImageRead } from "@/components/chat/image-thumb";
import { ClampedReasoning } from "@/components/chat/reasoning-clamp";
import { MiniFetchedFile } from "@/components/chat/fetched-file";
import { cn } from "@/lib/utils";
import { contentArgsText, describeTool, type ToolStatus } from "@/lib/tool-labels";
import type { Locale } from "@/lib/locale";
import type { ThoughtStep, WebSource } from "@/lib/chat-streams";

/**
 * Живая панель рассуждений. Пока агент работает — блок ФИКСИРОВАННОЙ высоты, в
 * котором текст рассуждения течёт снизу вверх (видна только последняя часть,
 * края растворяются в фон). Когда ход завершён — панель схлопывается в кнопку.
 *
 * Почему фиксированная высота: старая цепочка росла вниз на каждый шаг и дёргала
 * скролл ленты. Здесь размер блока не зависит от объёма рассуждений.
 */

const L: Record<
  Locale,
  { thinking: string; done: string; waiting: string }
> = {
  ru: { thinking: "Думаю", done: "Рассуждения", waiting: "Думаю" },
  en: { thinking: "Thinking", done: "Reasoning", waiting: "Thinking" },
};

/** Высота окна живого потока (px). ~5 строк — видно течение, но блок не растёт. */
const LIVE_H = 108;

/**
 * Живой поток работы агента: рассуждения и вызовы тулов ОДНОЙ лентой, в том
 * порядке, в каком они происходили. Окно фиксированной высоты, прокрученное к
 * низу — видно только последнее, остальное уезжает вверх и тает в градиенте.
 *
 * Показываем хвост из последних TAIL шагов: держать в DOM всю цепочку незачем,
 * видно всё равно ~5 строк, а при deep-research шагов бывают сотни.
 */
const TAIL = 6;

// Текст контентных аргументов (содержимое записи, задание субагенту) — общий
// хелпер с раскрытой лентой: contentArgsText в lib/tool-labels.ts.

/** Хост без www. — подпись источника в мини-списке. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Мини-версия найденных источников для живого превью: логотип сайта + заголовок,
 * по строке на источник. Полная карточка (с рамкой и доменами) живёт в
 * раскрытой ленте — здесь только намёк, что и откуда нашлось.
 *
 * Источники приходят с бэка ОДНИМ событием (весь массив разом), поэтому без
 * задержки они бы вылетели пачкой. Даём каждой строке свою `animation-delay` —
 * получается «стекание» вниз. Задержку копим до MAX_DELAY, иначе на 20
 * источниках хвост появлялся бы через несколько секунд после первого.
 *
 * Каскад — именно CSS, а не таймер в состоянии: поисков в ходе может быть
 * несколько (10 параллельных web_search — обычное дело для deep-research), и
 * каждый со своим setTimeout дёргал бы прокрутку вразнобой.
 */
const STEP_DELAY = 70; // мс между строками
const MAX_DELAY = 700; // потолок — дальше все появляются вместе

const MiniSources = memo(function MiniSources({
  sources,
}: {
  sources: WebSource[];
}) {
  // Дедуп по URL: один и тот же источник приходит из разных запросов, а
  // неуникальный key роняет рендер.
  const seen = new Set<string>();
  const unique = sources.filter((s) =>
    seen.has(s.url) ? false : (seen.add(s.url), true),
  );

  return (
    // Тот же кегль, что у текста рассуждений — источники продолжают поток, а не
    // выглядят вставленным списком другого сорта.
    <div className="mt-1 space-y-1">
      {unique.map((s, i) => (
        <div
          key={s.url}
          className="fade-in-0 slide-in-from-bottom-1 animate-in flex items-center gap-2 text-sm leading-relaxed text-muted-foreground/70"
          style={{
            animationDelay: `${Math.min(i * STEP_DELAY, MAX_DELAY)}ms`,
            // fill-mode: строка невидима ДО своей задержки, иначе она успевает
            // мигнуть на месте и только потом проявляется.
            animationFillMode: "backwards",
          }}
        >
          <Favicon url={s.url} />
          <span className="min-w-0 flex-1 truncate">
            {s.title || hostLabel(s.url)}
          </span>
        </div>
      ))}
    </div>
  );
});

/**
 * Логотип сайта по хосту (DuckDuckGo ip3 — отдаёт .ico сразу, без редиректа,
 * в отличие от google s2). Если иконки нет или домен битый — глобус, чтобы
 * строка не «прыгала» из-за пустого места на месте картинки.
 */
function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostLabel(url);
  if (failed || !host) {
    return <Globe className="size-3.5 shrink-0 text-muted-foreground/50" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      onError={() => setFailed(true)}
      className="size-3.5 shrink-0 rounded-sm"
    />
  );
}

/**
 * Строка живого таймлайна: узел на вертикальной линии + содержимое справа.
 *
 * Узел — иконка инструмента в кружке (как в раскрытой ленте), у рассуждений —
 * Sparkles. Кружок здесь мельче раскрытого (18px против 24px): в окне на ~5
 * строк крупные узлы съедали бы ширину. Активный шаг подсвечен акцентом.
 */
const TimelineRow = memo(function TimelineRow({
  icon: Icon,
  active,
  last,
  children,
}: {
  icon: LucideIcon;
  active: boolean;
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-2.5">
      {/* Колонка узла тянется на ВСЮ высоту шага (self-stretch), иначе линия,
          позиционированная от неё, обрывалась сразу под кружком: у высокого
          шага (write_file с длинным содержимым, картинка, источники) её просто
          не было видно. Кружок внутри прижат к верху и центрируется в полосе
          ровно в одну строку текста (leading-relaxed при text-sm = 22px) —
          так он стоит на одной оси с ПЕРВОЙ строкой. */}
      <div className="relative flex w-[18px] shrink-0 flex-col items-center self-stretch">
        <span className="z-10 flex h-[22px] shrink-0 items-center">
          <span
            className={cn(
              "flex size-[18px] items-center justify-center rounded-full border transition-colors",
              active
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-muted text-muted-foreground/70",
            )}
          >
            <Icon className="size-2.5" />
          </span>
        </span>
        {/* Зазор с ОБЕИХ сторон от кружков.
            Сверху: низ своего кружка на 20px (2px отступ полосы + 18px), + 3px.
            Снизу: bottom-0 тут НЕ зазор — колонка на self-stretch тянется на
            всю высоту строки вместе с отступом соседа (pb-2.5), и линия
            упиралась прямо в следующий кружок. Отступаем те же 3px явно. */}
        {!last && (
          <span className="absolute inset-x-0 top-[23px] bottom-[3px] mx-auto w-px bg-border" />
        )}
      </div>
      {/* Высота под одну строку, БЕЗ вертикальной центровки: у многострочного
          текста по узлу должна вставать первая строка, а не весь блок. */}
      <div
        className={cn(
          "min-h-[22px] min-w-0 flex-1 overflow-hidden",
          !last && "pb-2.5",
        )}
      >
        {children}
      </div>
    </div>
  );
});

const LiveStream = memo(function LiveStream({
  steps,
  locale,
  running,
  threadId,
}: {
  steps: ThoughtStep[];
  locale: Locale;
  running: boolean;
  threadId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Держим окно у низа по мере дозаписи — ПЛАВНО, лента доезжает на глазах.
  //
  // Мгновенный scrollTop давал рывок: приходил шаг выше окна (источники,
  // длинные аргументы), картинка скачком уезжала на его конец, и казалось, что
  // блок опустел, а текст «налился» заново сверху.
  //
  // Здесь же — ПОСТЕПЕННЫЙ РОСТ блока: раньше он рождался сразу пустыми
  // LIVE_H px, теперь высота = контенту с потолком LIVE_H (transition на
  // контейнере сглаживает шаги роста). Прямой style, а не setState:
  // синхронный setState в эффекте — каскадный рендер (правило
  // set-state-in-effect), а мерить и ставить высоту можно мимо React.
  //
  // Эффект без списка зависимостей: дописаться может и текст шага, и новый шаг.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = boxRef.current;
    if (!el || !box) return;
    box.style.height = `${Math.min(el.scrollHeight, LIVE_H)}px`;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  });

  const tail = steps.slice(-TAIL);
  const lastIdx = steps.length - 1;

  return (
    <div
      ref={boxRef}
      className="relative transition-[height] duration-200 ease-out"
      style={{ height: 0 }}
    >
      <div ref={ref} className="h-full overflow-hidden">
        {tail.map((s, i) => {
          // У последнего шага линии вниз нет — под ним ничего, и она висела бы
          // в пустоте, обгоняя контент.
          const last = i === tail.length - 1;

          // Позиция шага в ПОЛНОЙ ленте — и «активность», и ключ. Индекс внутри
          // хвоста для ключа не годится: при добавлении шага хвост сдвигается,
          // индексы съезжают на соседей, React перемонтирует строки — и вся
          // видимая лента заново проигрывает анимацию появления.
          const idx = steps.indexOf(s);
          const active = running && idx === lastIdx;

          if (s.kind === "reasoning") {
            return (
              <TimelineRow key={idx} icon={Sparkles} active={active} last={last}>
                {/* Завершённый блок — фраза-сжатие; идущий — только первые
                    строки с растворением (сырой поток целиком не показываем
                    нигде и никогда — решение продукта). */}
                {s.summary ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {s.summary}
                  </p>
                ) : (
                  <ClampedReasoning text={s.text} />
                )}
              </TimelineRow>
            );
          }

          if (s.kind === "note") {
            // Реплика модели между тулами — как есть, она короткая.
            return (
              <TimelineRow key={idx} icon={MessageSquareText} active={active} last={last}>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.text}</p>
              </TimelineRow>
            );
          }

          // Стадия шага для ВРЕМЕНИ ГЛАГОЛА: «Изучаю навык» -> «Навык изучен».
          // Завершение в живом окне видно не только по result (обычный чат его
          // может не слать) — шаг закончился и когда агент пошёл ДАЛЬШЕ (шаг
          // не последний) или весь ход завершён.
          const finished =
            s.name === "web_search"
              ? Boolean(s.sources)
              : s.name === "web_fetch"
                ? Boolean(s.file)
                : Boolean(s.result);
          const past =
            s.state !== "streaming" && (finished || idx < lastIdx || !running);
          const status: ToolStatus =
            s.result && !s.result.ok ? "failed" : past ? "done" : "running";
          // В строке — ДЕЙСТВИЕ + цель: «Изучаю навык pdf/creating.md»,
          // «Пишу файл deck.html». Одна цель без глагола ничего не говорила о
          // том, ЧТО агент с ней делает.
          const { title, target } = describeTool(s.name, s.args, locale, status);
          // Ни команду bash, ни URL web_fetch в живом окне НЕ показываем:
          // шелл-строка и голая ссылка человеку не в теме читаются как шум. У
          // bash это только заголовок, у web_fetch — карточка файла (ниже),
          // когда он скачан.
          const hideTarget = s.name === "bash" || s.name === "web_fetch";
          const fetched = s.name === "web_fetch" ? s.file : undefined;
          const argsText = contentArgsText(s.args);
          // Прочитанная картинка — ТОЛЬКО миниатюрой, без строки с путём: имя
          // файла рядом с самой картинкой ничего не добавляет.
          const image = isImageRead(s) ? imagePath(s) : "";
          // read_file с ещё НЕДОПИСАННЫМ путём не рисуем вовсе: расширения в
          // нём пока нет, картинку от обычного файла не отличить — и шаг
          // мигал бы строкой «Читаю файл», подменяясь превью через мгновение.
          // Ждём один кадр: заголовок блока и так говорит, что агент читает.
          if (!image && s.name === "read_file" && s.state === "streaming") {
            return null;
          }
          return (
            <TimelineRow
              key={idx}
              icon={toolIcon(s.name)}
              active={active}
              last={last}
            >
              {image ? (
                <ImageThumb path={image} threadId={threadId} />
              ) : (
                <>
                  {/* line-clamp вместо truncate: в узком окне однострочная
                      обрезка съедала запрос почти целиком. Две строки — видно
                      суть, и блок при этом не растёт бесконтрольно. */}
                  <div className="line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground">
                    {hideTarget || !target ? title : `${title} ${target}`}
                  </div>
                  {/* Скачанный web_fetch — мини-карточкой файла (миниатюра/
                      иконка + имя), как в раскрытой ленте. */}
                  {fetched ? (
                    <MiniFetchedFile file={fetched} threadId={threadId} />
                  ) : null}
                  {/* Текст аргументов течёт так же, как текст рассуждения: они
                      дозревают по мере стрима, и видно, ЧТО агент передаёт. */}
                  {argsText ? (
                    <p className="mt-1 overflow-hidden whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground/70">
                      {argsText}
                    </p>
                  ) : null}
                </>
              )}
              {s.sources?.length ? <MiniSources sources={s.sources} /> : null}
            </TimelineRow>
          );
        })}
      </div>
      {/* Верх ленты тает — то, что уехало, не обрывается ножом. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-muted/30 to-transparent" />
    </div>
  );
});

export type ThinkingPanelProps = {
  /** Заголовок: что агент делает прямо сейчас (действие текущего шага). */
  label: string;
  /** Идёт ход: показываем живое окно вместо кнопки. */
  running: boolean;
  steps: ThoughtStep[];
  locale: Locale;
  /** Сессия — нужна для URL миниатюр прочитанных картинок. */
  threadId: string;
  /** Раскрыта ли полная лента — состояние держит родитель. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Полная лента шагов (таймлайн) — рендерит родитель. */
  children: React.ReactNode;
  className?: string;
};

export function ThinkingPanel({
  label,
  running,
  steps,
  locale,
  threadId,
  open,
  onOpenChange,
  children,
  className,
}: ThinkingPanelProps) {
  const t = L[locale];

  // Секундомер хода — показывает, что агент жив, даже если текст не идёт.
  // Считаем от МОНТАЖА панели: точного времени старта хода в шагах нет.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Раскрывает И сворачивает клик по ВСЕМУ блоку, а не только по шапке — как
  // строка в панели субагентов. Шеврон — только индикатор состояния.
  //
  // Внутри раскрытой ленты есть свои интерактивные блоки (аргументы тула,
  // источники, кнопка субагента, ссылки). Глушить весь контейнер нельзя —
  // тогда лента перестаёт сворачиваться кликом по себе; поэтому пропускаем
  // клик к тогглу, только если он не попал в такой элемент.
  const toggle = () => onOpenChange(!open);
  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement | null;
    // Ищем интерактивный элемент СТРОГО между целью клика и контейнером.
    // Без ограничения `closest` доходил до самого контейнера (у него тоже
    // role="button") и отсекал КАЖДЫЙ клик — блок переставал открываться.
    const hit = el?.closest("button, a, input, textarea, select");
    if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) {
      return;
    }
    toggle();
  };
  const keys = (e: React.KeyboardEvent) => {
    // Только собственные нажатия: Enter/Пробел на вложенной кнопке — её дело.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  // Пока ход идёт — карточка в ленте: текущее действие с шиммером, секундомер
  // и живой поток (рассуждения + вызовы тулов одной лентой).
  if (running) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onClick}
        onKeyDown={keys}
        className={cn(
          "my-2 cursor-pointer rounded-xl border border-border/70 bg-muted/30 p-3 transition-colors hover:border-foreground/30",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <Shimmer
            as="span"
            className="text-sm font-medium"
            duration={1.5}
            accentColor="var(--color-primary)"
          >
            {label || t.thinking}
          </Shimmer>
          <span className="text-xs tabular-nums text-muted-foreground/70">
            {elapsed}s
          </span>
          <ChevronRight
            className={cn(
              "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        </div>

        {/* Свёрнуто — живой поток; раскрыто — тот же поток целиком таймлайном.
            Клик по ленте сворачивает блок; вложенные кнопки/ссылки отсекает
            фильтр в onClick. */}
        {!open ? (
          <div className="mt-1.5">
            <LiveStream
              steps={steps}
              locale={locale}
              running={running}
              threadId={threadId}
            />
          </div>
        ) : (
          <div className="mt-3 border-t border-border/60 pt-3">{children}</div>
        )}
      </div>
    );
  }

  // Ход завершён — карточка схлопывается в одну кнопку. Ничего под ней не
  // показываем: ход закончен, вся лента доступна по клику.
  //
  // Здесь, в отличие от ветки running, роль кнопки несёт сам FlowButton, а не
  // контейнер: вложенный <button> внутри role="button" — невалидная разметка и
  // сломанная клавиатура (Enter срабатывал бы дважды).
  return (
    <div className={cn("my-2", !open && "w-fit", className)}>
      {/* Тоггл висит на самой кнопке: фильтр в onClick отсекает клики по
          вложенным <button>, иначе клик по ней проглатывался бы. */}
      <FlowButton
        text={t.done}
        active={open}
        aria-expanded={open}
        onClick={toggle}
      />
      {open ? (
        // Клик по раскрытой ленте сворачивает её — как в ветке running.
        // cursor-pointer тут НЕ ставим: он висел бы на всей ширине и наведение
        // на любой текст рассуждений подсвечивало бы блок как кликабельный.
        <div
          onClick={onClick}
          className="mt-2 rounded-xl border border-border/70 bg-muted/30 p-3"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
