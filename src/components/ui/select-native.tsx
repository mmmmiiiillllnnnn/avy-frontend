import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Нативный <select> в стиле темы (без primitive-библиотеки). Для админки
// (выбор роли) этого достаточно — доступность и поведение даёт сам браузер.

export function SelectNative({
  className,
  children,
  hideChevron = false,
  ...props
}: React.ComponentProps<"select"> & { hideChevron?: boolean }) {
  return (
    <div className="relative inline-flex w-full">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-border bg-foreground/5 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-primary/5",
          hideChevron ? "pr-3" : "pr-9",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {!hideChevron && (
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
    </div>
  );
}
