"use client";

/**
 * Список того, что агент запомнил, — общий для двух мест.
 *
 * Он показывается и в настройках (вся память), и в панели сессии (та же память,
 * рядом с выключателем этого чата). Компонент один, потому что это буквально
 * ОДИН И ТОТ ЖЕ список: человек, удаливший факт в панели чата, должен увидеть
 * его исчезнувшим и в настройках. Две копии кода рано или поздно разошлись бы
 * поведением удаления, и одна из них начала бы врать.
 *
 * Стиль — утверждённый макет панели (16.09): никаких карточек и рамок, вся
 * структура типографикой. Заголовок слоя — капсом со счётчиком, под ним тонкая
 * линия (как линии скролл-зоны в сайдбаре), факты — строки во всю ширину
 * панели, корзина и срок появляются тихо. Панель — не блок, а колонка на той
 * же поверхности, и её содержимое не должно рисовать коробок.
 */

import * as React from "react";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  fetchMemoryFact,
  forgetMemoryFact,
  type MemoryFact,
  type MemoryOwner,
} from "@/lib/api";
import { useLocale, useT } from "@/i18n/i18n-context";

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Один факт: строка индекса + раскрытие тела + удаление.
 *
 *  Тело грузим ЛЕНИВО, по клику: фактов бывает до двух сотен, и тянуть их
 *  целиком ради строки-заголовка незачем — бэкенд специально отдаёт список
 *  без body. */
export function MemoryFactRow({
  fact,
  onForget,
}: {
  fact: MemoryFact;
  onForget: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && body === null) {
      const full = await fetchMemoryFact(fact.id);
      setBody(full?.body ?? "");
    }
  };

  const forget = async (e: React.MouseEvent) => {
    // Клик по «удалить» не должен заодно раскрывать строку.
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    // Убираем сразу: ждать round-trip незачем, а промах вернётся при
    // следующем открытии.
    if (await forgetMemoryFact(fact.id)) onForget(fact.id);
    else setBusy(false);
  };

  const expiry = fact.expires_at
    ? t.settings.memoryExpires(fmtDate(fact.expires_at, locale))
    : null;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void toggle();
          }
        }}
        className="group flex w-full cursor-pointer items-center gap-2.5 py-1.5 pl-5 pr-3 text-left transition-colors hover:bg-accent/40"
      >
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-180",
          )}
        />
        {/* Заголовок в одну строку с многоточием: факты бывают длинными, а
            панель — узкой; перенос на три строки превращал список в кашу.
            Целиком текст виден в раскрытом теле. */}
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {fact.description}
        </span>
        {/* Срок — тихим текстом, не чипом: он есть у меньшинства фактов и не
            должен перетягивать взгляд. */}
        {expiry && (
          <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
            {expiry}
          </span>
        )}
        {/* Кнопка ЗАНИМАЕТ МЕСТО ВСЕГДА (меняется только видимость): при
            появлении по наведению строка дёргалась, а текст перескакивал. */}
        <button
          type="button"
          onClick={forget}
          aria-label={t.settings.memoryForget}
          disabled={busy}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Trash2 className="size-3" />
          )}
        </button>
      </div>
      {open && (
        // Тело — простым текстом с отступом под заголовок строки (20px паддинг
        // + 12px шеврон + 10px зазор), без плашек и рамок.
        <div className="pb-3 pl-[2.625rem] pr-5">
          {body === null ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {body || "—"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Плоский список фактов (без заголовка слоя). `dimmed` — память выключена:
 *  записи остаются видимыми, но приглушены, потому что никуда не делись и
 *  вернутся в работу, если человек передумает. */
export function MemoryList({
  facts,
  onForget,
  dimmed = false,
}: {
  facts: MemoryFact[];
  onForget: (id: string) => void;
  dimmed?: boolean;
}) {
  const t = useT();

  if (facts.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-foreground">{t.settings.memoryEmpty}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.settings.memoryEmptyHint}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("transition-opacity", dimmed && "opacity-50")}>
      {facts.map((f) => (
        <MemoryFactRow key={f.id} fact={f} onForget={onForget} />
      ))}
    </div>
  );
}

/** Один слой памяти: капс-заголовок со счётчиком, линия, строки фактов. */
function MemoryLayer({
  owner,
  onForget,
  dimmed,
}: {
  owner: MemoryOwner;
  onForget: (id: string) => void;
  dimmed: boolean;
}) {
  const t = useT();

  return (
    <section className={cn("transition-opacity", dimmed && "opacity-50")}>
      <div className="flex items-baseline gap-2 px-5 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {owner.scope === "space"
            ? t.settings.memoryScopeSpace(owner.name ?? "")
            : t.settings.memoryScopeUser}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">
          {owner.facts.length}
        </span>
      </div>
      <div className="h-px bg-border/60" />
      <div className="pt-0.5">
        {owner.facts.map((f) => (
          <MemoryFactRow key={f.id} fact={f} onForget={onForget} />
        ))}
      </div>
    </section>
  );
}

/** Память, РАЗЛОЖЕННАЯ по слоям: что агент знает о человеке и что — о каждом
 *  пространстве.
 *
 *  Раньше слои схлопывались в один список (flatMap по владельцам), и человек
 *  не мог понять, почему факт про рабочий проект всплывает в личном чате — или
 *  наоборот, куда делась запись, сделанная в пространстве. Заголовок слоя
 *  отвечает на этот вопрос до того, как он возникнет.
 *
 *  Пустые слои не рисуем: заголовок над пустотой сообщает только то, что
 *  разработчик предусмотрел группу. */
export function MemoryGroups({
  owners,
  onForget,
  dimmed = false,
}: {
  owners: MemoryOwner[];
  onForget: (id: string) => void;
  dimmed?: boolean;
}) {
  const filled = owners.filter((o) => o.facts.length > 0);

  if (filled.length === 0) {
    return <MemoryList facts={[]} onForget={onForget} dimmed={dimmed} />;
  }

  // Личный слой первым: он про самого человека и есть всегда, а пространств
  // может не быть вовсе.
  const sorted = [...filled].sort(
    (a, b) => Number(b.scope === "agent") - Number(a.scope === "agent"),
  );

  return (
    <div className="flex flex-col gap-5">
      {sorted.map((owner) => (
        <MemoryLayer
          key={owner.owner_id}
          owner={owner}
          onForget={onForget}
          dimmed={dimmed}
        />
      ))}
    </div>
  );
}
