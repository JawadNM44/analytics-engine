import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  glow?: boolean;
  shimmer?: boolean;
}

/**
 * Glass-morphism card. Theme-aware (dark + light).
 *   - dark:  bg-white/[0.03] border-white/10 text-white
 *   - light: bg-white/70     border-black/10 text-zinc-900
 * Optional `shimmer` adds a subtle animated sheen across the surface.
 */
export function GlassCard({
  children,
  className,
  glow = false,
  shimmer = false,
  ...rest
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border p-6 backdrop-blur-xl",
        // Dark (default)
        "border-white/10 bg-white/[0.03] text-white",
        "shadow-[0_8px_32px_rgba(0,0,0,0.35)]",
        // Light overrides via Tailwind dark: variant trick
        "[html.light_&]:border-black/10 [html.light_&]:bg-white/70 [html.light_&]:text-zinc-900",
        "[html.light_&]:shadow-[0_8px_32px_rgba(15,23,42,0.08)]",
        // Hover
        "transition duration-300",
        "hover:border-white/20 [html.light_&]:hover:border-black/20",
        "hover:bg-white/[0.05] [html.light_&]:hover:bg-white/80",
        glow &&
          "before:absolute before:inset-0 before:rounded-2xl before:bg-accent-glow before:opacity-20 before:blur-2xl before:-z-10",
        shimmer && "glass-shimmer",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
