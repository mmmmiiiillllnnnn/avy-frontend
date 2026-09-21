"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

function clamp(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100));
}

/**
 * Состояние зума, общее для просмотрщиков PDF и изображений.
 *
 * Если передать ref на scroll-контейнер, зум держится «от центра видимой
 * области»: после смены масштаба scroll пересчитывается так, чтобы точка,
 * бывшая в центре окна, осталась в центре (а не уезжала в левый-верхний угол,
 * куда контент растёт из-за выравнивания `mx-auto w-fit`). useLayoutEffect
 * срабатывает после ресайза контента, но до отрисовки — без мигания.
 */
export function useZoom(scrollRef?: RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  // Масштаб на момент прошлой раскладки — чтобы вычислить коэффициент роста.
  const prevScale = useRef(1);

  useLayoutEffect(() => {
    const el = scrollRef?.current;
    const prev = prevScale.current;
    prevScale.current = scale;
    if (!el || prev === scale) return;
    const ratio = scale / prev;
    // Центр видимой области в координатах контента -> тот же центр после зума.
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    el.scrollLeft = cx * ratio - el.clientWidth / 2;
    el.scrollTop = cy * ratio - el.clientHeight / 2;
  }, [scale, scrollRef]);

  const nudge = useCallback((delta: number) => {
    setScale((s) => clamp(s + delta));
  }, []);
  const reset = useCallback(() => setScale(1), []);
  return { scale, nudge, reset };
}

export type Zoom = ReturnType<typeof useZoom>;

/**
 * Панорамирование контента «хватанием»: drag по контейнеру двигает его scroll.
 * Работает только когда `enabled` (есть переполнение, т.е. зум > по размеру).
 * Возвращает курсор (grab/grabbing) и pointer-обработчики для scroll-контейнера.
 */
export function usePan(
  scrollRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  // Стартовая точка курсора + scroll контейнера на момент захвата.
  const start = useRef<{ x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current;
      if (!el || !enabled) return;
      e.preventDefault();
      start.current = {
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
      };
      setPanning(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [scrollRef, enabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current;
      if (!el || !start.current) return;
      el.scrollLeft = start.current.left - (e.clientX - start.current.x);
      el.scrollTop = start.current.top - (e.clientY - start.current.y);
    },
    [scrollRef],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    start.current = null;
    setPanning(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const cursor = enabled ? (panning ? "cursor-grabbing" : "cursor-grab") : undefined;

  return {
    panning,
    cursor,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

/** Обработчик Ctrl/⌘+колесо для зума (как в браузере/PDF-читалках). */
export function wheelZoom(zoom: Zoom) {
  return (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom.nudge(e.deltaY < 0 ? 0.1 : -0.1);
  };
}

/**
 * Плавающая панелька зума в углу просмотрщика: −, проценты (клик = сброс), +.
 * Сами просмотрщики применяют zoom.scale к контенту (ширине PDF-страниц или
 * масштабу изображения) и ловят Ctrl/⌘+колесо.
 */
export function ZoomControls({
  zoom,
  className,
}: {
  zoom: Zoom;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border bg-background/90 p-0.5 shadow-sm backdrop-blur",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => zoom.nudge(-0.1)}
        aria-label={t.zoom.zoomOut}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        onClick={zoom.reset}
        aria-label={t.zoom.resetZoom}
        title={t.zoom.resetZoom}
        className="min-w-[3rem] rounded-md px-1 py-1 text-center text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {Math.round(zoom.scale * 100)}%
      </button>
      <button
        type="button"
        onClick={() => zoom.nudge(0.1)}
        aria-label={t.zoom.zoomIn}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={zoom.reset}
        aria-label={t.zoom.fitToWindow}
        title={t.zoom.fitToWindow}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Maximize2 className="size-4" />
      </button>
    </div>
  );
}
