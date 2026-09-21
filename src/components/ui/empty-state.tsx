import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Пустое состояние блока: по центру — медиа-иконка в скруглённой плашке,
 * ниже заголовок и описание, опционально действие. Форма повторяет shadcn
 * `Empty` (21st bundui/empty8), но на наших lucide-иконках и токенах — без
 * лишних зависимостей.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 py-8 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground [&_svg]:size-6">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-xs text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}
