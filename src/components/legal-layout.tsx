"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-context";
import type { Locale } from "@/lib/locale";

// Обёртка юридических страниц (/privacy, /terms): шапка с «назад» и переключателем
// языка + читаемая колонка текста. Текст приходит абзацами, разделёнными \n\n.

export function LegalLayout({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const paragraphs = body.split("\n\n");

  return (
    <div className="mx-auto min-h-[100dvh] max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t.legal.back}
        </Link>
        <span className="inline-flex items-center rounded-full bg-muted p-0.5 text-xs font-medium">
          {(["ru", "en"] as Locale[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={
                locale === l
                  ? "rounded-full bg-primary px-3 py-1 text-primary-foreground"
                  : "rounded-full px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {l.toUpperCase()}
            </button>
          ))}
        </span>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.legal.lastUpdated}</p>

      <div className="mt-8 flex flex-col gap-4 text-[15px] leading-relaxed text-foreground/90">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  );
}
