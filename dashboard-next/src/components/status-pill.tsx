import { cn } from "@/lib/cn";

interface StatusPillProps {
  ok: boolean;
  label: string;
}

export function StatusPill({ ok, label }: StatusPillProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-300",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          ok ? "bg-emerald-400 animate-pulse-slow" : "bg-amber-400",
        )}
      />
      {label}
    </div>
  );
}
