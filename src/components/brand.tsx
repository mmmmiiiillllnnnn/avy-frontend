import { Logo } from "@/components/ui/logo";

type BrandProps = {
  className?: string;
  logoSize?: number;
  /** Приглушённое слово после «Avy» (по умолчанию «Chat»; в админке — «Admin»). */
  label?: string;
};

/**
 * Бренд-блок «Avy Chat» — логотип + название, как в правом верхнем углу сайта.
 * Второе слово приглушено (как "Laboratory" на сайте); меняется через label.
 */
export function Brand({ className = "", logoSize = 28, label = "Chat" }: BrandProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Logo size={logoSize} />
      <span className="whitespace-nowrap font-[family-name:var(--font-brand)] text-base font-semibold tracking-tight text-brand-ink">
        Avy <span className="text-brand-ink/55">{label}</span>
      </span>
    </div>
  );
}
