import { cn } from "@/lib/cn";

interface LogoProps {
  size?: number;
  withWord?: boolean;
  className?: string;
}

/**
 * Project logo. SVG, theme-aware (uses currentColor for the wordmark),
 * accent-coloured pulse ring for the glyph.
 *
 * To swap for your own logo: replace the <svg> contents with your design,
 * keep the same dimensions and stroke="currentColor" pattern so it
 * stays theme-aware.
 */
export function Logo({ size = 28, withWord = true, className }: LogoProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Crypto Analytics logo"
      >
        <defs>
          <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#20a4d8" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        {/* Outer ring */}
        <circle cx="16" cy="16" r="13" stroke="url(#logo-grad)" strokeWidth="2" />
        {/* Inner pulse */}
        <circle cx="16" cy="16" r="5.5" fill="url(#logo-grad)">
          <animate
            attributeName="r"
            values="5;6;5"
            dur="2.4s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
          />
        </circle>
        {/* Heartbeat line */}
        <path
          d="M3 16 H10 L12 12 L14 20 L16 16 L18 12 L20 18 L22 16 H29"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.4"
        />
      </svg>
      {withWord && (
        <span className="font-display text-xl font-medium tracking-tight">
          Crypto<span className="text-accent">/</span>Analytics
        </span>
      )}
    </div>
  );
}
