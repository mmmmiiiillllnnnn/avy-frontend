"use client";

/**
 * Панель действий под сообщением (копировать, ретрай, лайк/дизлайк, edit).
 *
 * Совместимо по API с AI Elements `Actions`/`Action` (Vercel): контейнер-ряд
 * кнопок + одна кнопка-иконка с тултипом. Реализовано на наших `Button`/`Tooltip`
 * (CLI ai-elements требует авторизации, поэтому компонент заведён вручную).
 */

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ActionsProps = ComponentProps<"div">;

/** Контейнер ряда действий. По умолчанию проявляется на hover родителя группы. */
export function Actions({ className, children, ...props }: ActionsProps) {
  return (
    <div className={cn("flex items-center gap-0.5", className)} {...props}>
      {children}
    </div>
  );
}

export type ActionProps = ComponentProps<typeof Button> & {
  /** Текст тултипа при наведении. */
  tooltip?: string;
  /** Подпись для скринридеров (если у кнопки только иконка). */
  label?: string;
};

/**
 * Одна кнопка-иконка. Оборачивается в тултип, если задан `tooltip`.
 * `active` подсветим через variant снаружи (напр. лайк выбран).
 */
export function Action({
  tooltip,
  label,
  children,
  className,
  variant = "ghost",
  size = "icon-sm",
  type = "button",
  ...props
}: ActionProps) {
  const button = (
    <Button
      type={type}
      variant={variant}
      size={size}
      className={cn(
        "relative text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-label={label || tooltip}
      {...props}
    >
      {children}
      {label ? <span className="sr-only">{label}</span> : null}
    </Button>
  );

  if (!tooltip) return button;

  // Base UI: Trigger сливается с дочерним элементом через `render`, не `asChild`.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
