type LogoProps = {
  size?: number | string;
  className?: string;
};

export function Logo({ size, className = "" }: LogoProps) {
  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={size ? { width: size, height: size } : { width: "100%", height: "100%" }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Лого по теме, как и акцент «графит»: светлая — графитовый квадрат
            с белым знаком, тёмная — светло-серый квадрат с тёмным знаком.
            Цвета = --primary / --primary-foreground обеих тем. */}
        <rect
          width="24"
          height="24"
          rx="6.24"
          ry="6.24"
          className="fill-[#333333] dark:fill-[#e4e4e4]"
        />
        <path
          d="M12 15.5l-5-5h10z"
          className="fill-white stroke-white dark:fill-[#121212] dark:stroke-[#121212]"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
