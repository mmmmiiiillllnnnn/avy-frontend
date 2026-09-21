"use client";

import { useState } from "react";
import { Code } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/locale";

const LABEL: Record<Locale, string> = { ru: "Пишу код", en: "Coding" };

/**
 * Блок кода внутри рассуждения, свёрнутый в пилюлю «Пишу код» / «Coding».
 * По клику разворачивается в обычный код-блок (тот же рендер, что и везде —
 * прогоняем исходный ```fence``` через Streamdown ради подсветки/копирования).
 *
 * Пока блок активен (агент печатает этот код прямо сейчас) — на метке shimmer;
 * как закончил — статичная метка. Свёрнут по умолчанию, чтобы длинный код не
 * раздувал ленту рассуждений.
 */
export function CodingBlock({
  markdown,
  active,
  locale,
}: {
  /** Полный ```fence```-блок (с ограждениями) — отдаём его Streamdown как есть. */
  markdown: string;
  /** Агент печатает этот код прямо сейчас → shimmer на метке. */
  active: boolean;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const label = LABEL[locale];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-1">
      <CollapsibleTrigger
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1",
          "text-xs text-muted-foreground transition-colors hover:text-foreground",
        )}
      >
        <Code className="size-3.5" />
        {active ? (
          <Shimmer as="span" duration={1.2}>
            {label}
          </Shimmer>
        ) : (
          <span>{label}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5">
        {/* Рендерим тот же fence обычным образом — получаем подсветку и кнопку
            копирования, как у кода в основном ответе. */}
        <MessageResponse className="text-sm">{markdown}</MessageResponse>
      </CollapsibleContent>
    </Collapsible>
  );
}
