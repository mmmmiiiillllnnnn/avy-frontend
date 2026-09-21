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
        {/* Лого по теме, как и акцент: светлая — прежний бренд-оранжевый
            (медь на белом тусклая в любой глубине — пробовали #b0714a и
            #a06336), тёмная — медь «медного монохрома». */}
        <rect
          width="24"
          height="24"
          rx="6.24"
          ry="6.24"
          className="fill-[#e05d38] dark:fill-[#c58963]"
        />
        <path
          d="M12 15.5l-5-5h10z"
          fill="white"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
