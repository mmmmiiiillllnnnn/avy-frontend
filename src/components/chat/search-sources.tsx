"use client";

import { useState } from "react";
import { Globe, Search } from "lucide-react";

export type WebSource = { title: string; url: string };

/** Хост без www. для подписи справа; "" если URL битый. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Фавиконка сайта по хосту. DuckDuckGo ip3, а НЕ google s2: s2 отдаёт 301-
 * редирект (браузеру два запроса на иконку → заметная задержка), а ip3 — сразу
 * 200 и маленький .ico (~1КБ). Без своего сервиса/прокси.
 */
function faviconUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch {
    return null;
  }
}

/**
 * Блок найденных источников под шагом web_search — карточка с рамкой. Сверху
 * (если передан query) — строка поискового запроса с лупой, под ней список
 * результатов: фавиконка + название + домен справа. На наведение строки —
 * лёгкая подсветка. Несворачиваемый: всё всегда видно.
 */
export function SearchSources({
  sources,
  query,
}: {
  sources: WebSource[];
  query?: string;
}) {
  if (!sources.length && !query) return null;
  // Дедуп по URL: источники могут повторяться (несколько web_search в одном
  // ходе; старые сессии, записанные до серверного дедупа) — иначе неуникальный
  // key роняет рендер.
  const seen = new Set<string>();
  const unique = sources.filter((s) =>
    seen.has(s.url) ? false : (seen.add(s.url), true),
  );
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background p-1">
      {query ? (
        <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm">
          <Search className="size-[18px] shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {query}
          </span>
        </div>
      ) : null}
      {query && unique.length ? (
        <div className="mx-2.5 my-0.5 border-t border-border/60" />
      ) : null}
      {unique.map((s) => (
        <SourceRow key={s.url} source={s} />
      ))}
    </div>
  );
}

function SourceRow({ source }: { source: WebSource }) {
  const [iconFailed, setIconFailed] = useState(false);
  const favicon = faviconUrl(source.url);
  const host = hostLabel(source.url);
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-muted/60"
    >
      {favicon && !iconFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={favicon}
          alt=""
          width={18}
          height={18}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onError={() => setIconFailed(true)}
          className="size-[18px] shrink-0 rounded"
        />
      ) : (
        <Globe className="size-[18px] shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">
        {source.title}
      </span>
      {/* Домен ужимается вместе с заголовком (min-w-0 + max-w), а не давит его:
          в узком окне `shrink-0` отдавал домену всю нужную ему ширину, и на
          заголовок не оставалось места. На совсем узком — домен прячем. */}
      {host && (
        <span className="hidden min-w-0 max-w-[40%] shrink truncate text-muted-foreground sm:inline">
          {host}
        </span>
      )}
    </a>
  );
}
