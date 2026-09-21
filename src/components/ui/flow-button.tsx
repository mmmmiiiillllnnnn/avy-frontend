// Кнопка из реестра 21st.dev (xubohuah/flow-button), адаптированная под проект.
//
// Против оригинала изменено:
// - цвета: #111111/#333333/white → токены темы (foreground, primary), иначе в
//   тёмной теме кнопка была бы чёрной по чёрному;
// - размеры: px-8 py-3 → px-5 py-1.5, стрелки left-4/right-4 → 1.5, сдвиг
//   текста 3 → 2 (на узкой кнопке стрелки наезжали на подпись);
// - рамка убрана, вместо неё мягкая подложка bg-muted/50;
// - скругление сразу 12px, без «пилюли»: в оригинале оно ехало 100px → 12px
//   под курсором, но в ленте кнопка должна выглядеть одинаково всегда;
// - `active`: залипание в «нажатом» виде, пока блок раскрыт.
//
// Механика и тайминги оригинала (перелёт стрелок, круг из центра, active:scale)
// сохранены.
'use client';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function FlowButton({
  text = "Modern Button",
  active = false,
  className,
  ...props
}: {
  text?: string;
  /**
   * Залипшее состояние: кнопка выглядит так же, как под курсором (залита,
   * стрелки перелетели, скругление уехало в прямоугольник). Нужно, чтобы
   * раскрытый блок оставался «нажатым», пока его не свернут.
   *
   * Пробрасывается ЧЕРЕЗ data-active и group-data-[active=true], а не
   * дублированием hover-классов без префикса: базовые классы круга
   * (w-4 h-4 opacity-0) и залипшие (w-[220px] opacity-100) — это одни и те же
   * CSS-свойства, и tailwind-merge не гасил конфликт произвольных значений с
   * фиксированными. Побеждал opacity-100, и КАЖДАЯ кнопка в ленте оказывалась
   * залитой оранжевым независимо от active.
   *
   * ВАЖНО: группа ИМЕНОВАННАЯ (group/flow), а не безымянная. Обёртка сообщения
   * (ai-elements/message.tsx) сама имеет класс `group` и растянута на 95%
   * ширины ленты. Безымянный group-hover цеплялся за неё, поэтому наведение на
   * ЛЮБОЕ место сообщения — текст ответа, пустое поле сбоку — заливало все
   * кнопки «Рассуждения» разом.
   */
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-active={active}
      className={cn(
        "group/flow relative flex cursor-pointer items-center gap-1 overflow-hidden rounded-lg border border-transparent bg-muted/50 px-5 py-1.5 text-sm font-semibold text-foreground transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-primary-foreground active:scale-[0.95] data-[active=true]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      {/* Left arrow (arr-2) */}
      <ArrowRight className="absolute left-[-25%] z-[9] h-4 w-4 fill-none stroke-foreground transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/flow:left-1.5 group-hover/flow:stroke-primary-foreground group-data-[active=true]/flow:left-1.5 group-data-[active=true]/flow:stroke-primary-foreground" />

      {/* Text */}
      <span className="relative z-[1] -translate-x-2 transition-all duration-[800ms] ease-out group-hover/flow:translate-x-2 group-data-[active=true]/flow:translate-x-2">
        {text}
      </span>

      {/* Circle */}
      <span className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-primary opacity-0 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)] group-hover/flow:h-[220px] group-hover/flow:w-[220px] group-hover/flow:opacity-100 group-data-[active=true]/flow:h-[220px] group-data-[active=true]/flow:w-[220px] group-data-[active=true]/flow:opacity-100"></span>

      {/* Right arrow (arr-1) */}
      <ArrowRight className="absolute right-1.5 z-[9] h-4 w-4 fill-none stroke-foreground transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/flow:right-[-25%] group-hover/flow:stroke-primary-foreground group-data-[active=true]/flow:right-[-25%]" />
    </button>
  );
}
