import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  glow?: boolean;
}

export function GlassCard({ children, className, glow = false, ...rest }: GlassCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl",
        "shadow-[0_8px_32px_rgba(0,0,0,0.35)]",
        "transition duration-300 hover:border-white/20 hover:bg-white/[0.05]",
        glow && "before:absolute before:inset-0 before:rounded-2xl before:bg-accent-glow before:opacity-20 before:blur-2xl before:-z-10",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
