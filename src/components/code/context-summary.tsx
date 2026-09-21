"use client";

// Свёрнутый блок «Контекст сжат» в ленте Avy Code — построен на тех же
// примитивах, что и блок «Рассуждения» (ChainOfThought*), чтобы выглядеть и
// вести себя одинаково: свёрнут по умолчанию, клик по заголовку раскрывает.
// Внутри — markdown-текст summary, который модель-суммаризатор передала в
// контекст после сжатия (server _summarization_event). Блок стоит в точке
// ленты, ГДЕ сжатие запустили (anchor_index события): старая часть истории
// выше ужата в этот summary, хвост из последних ~20 сообщений остаётся в
// контексте агента как есть.

import { useState } from "react";
import { Archive } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from "@/components/ai-elements/chain-of-thought";
import { MessageResponse } from "@/components/ai-elements/message";
import { useLocale } from "@/i18n/i18n-context";

/**
 * Токены в тысячах, как в Claude Code: 100_000 → «100к», 4_250 → «4.3к»,
 * 900 → «900». Суффикс тысяч локализован (к/k).
 */
function formatTokens(n: number, locale: string): string {
  const k = locale === "en" ? "k" : "к";
  if (n >= 10_000) return `${Math.round(n / 1000)}${k}`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}${k}`;
  return String(n);
}

export function ContextSummary({
  text,
  tokens,
}: {
  text: string;
  // Объём свёрнутой истории в токенах (до сжатия); null/undefined — не показываем
  // (старые события сжатия без этого поля).
  tokens?: number | null;
}) {
  // Свёрнут по умолчанию, как «Рассуждения». Контролируемое состояние — своё
  // открытие/закрытие сохраняется.
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  const base = locale === "en" ? "Context compressed" : "Контекст сжат";
  const label =
    tokens && tokens > 0
      ? locale === "en"
        ? `${base} (${formatTokens(tokens, locale)} tokens)`
        : `${base} (${formatTokens(tokens, locale)} токенов)`
      : base;

  return (
    <ChainOfThought className="mt-4" open={open} onOpenChange={setOpen}>
      {/* hideIcon: свой значок Archive вместо дефолтных «искр» (Sparkles). */}
      <ChainOfThoughtHeader hideIcon>
        <span className="inline-flex items-center gap-2">
          <Archive className="size-4" />
          {label}
        </span>
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        <MessageResponse className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm">
          {text}
        </MessageResponse>
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}
