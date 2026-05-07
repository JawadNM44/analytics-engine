import { cn } from "@/lib/cn";
import { GlassCard } from "./glass-card";

interface KPIProps {
  label: string;
  value: string;
  delta?: { value: string; positive?: boolean | null } | null;
  hint?: string;
  className?: string;
}

export function KPI({ label, value, delta, hint, className }: KPIProps) {
  return (
    <GlassCard className={cn("flex flex-col gap-2", className)}>
      <div className="text-xs uppercase tracking-widest text-white/50">{label}</div>
      <div className="font-display text-3xl font-medium leading-none text-white sm:text-4xl">
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "text-sm font-medium",
            delta.positive === true && "text-good",
            delta.positive === false && "text-bad",
            delta.positive == null && "text-white/60",
          )}
        >
          {delta.value}
        </div>
      )}
      {hint && <div className="text-xs text-white/40">{hint}</div>}
    </GlassCard>
  );
}
