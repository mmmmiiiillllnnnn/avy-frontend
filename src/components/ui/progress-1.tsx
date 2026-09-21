"use client";

import { Progress } from "@ark-ui/react/progress";
import { cn } from "@/lib/utils";

/**
 * Кольцо прогресса загрузки для чипа вложения (21st anubra266/progress-1, но
 * круговой вариант Ark UI). value 0..1; error — красное кольцо ошибки.
 * Компактное — вписывается в угол/над иконкой чипа.
 */
export function UploadRing({
  value,
  error = false,
  size = 28,
  className,
}: {
  value: number; // 0..1
  error?: boolean;
  size?: number;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <Progress.Root
      value={pct}
      max={100}
      className={cn("inline-flex items-center justify-center", className)}
    >
      <Progress.Circle
        style={{ width: size, height: size, ["--size" as string]: `${size}px`, ["--thickness" as string]: "3px" }}
        className="[&_[data-part=circle-track]]:stroke-muted"
      >
        <Progress.CircleTrack className="stroke-muted" />
        <Progress.CircleRange
          className={cn(
            "transition-[stroke-dasharray] duration-200 ease-out",
            error ? "stroke-destructive" : "stroke-primary",
          )}
        />
      </Progress.Circle>
    </Progress.Root>
  );
}
