"use client";
import { cn } from "@/lib/cn";

interface Props {
  value: string;
  onChange: (s: string) => void;
  options: string[];
}

export function SymbolPicker({ value, onChange, options }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition",
            value === opt
              ? "bg-white text-black shadow"
              : "text-white/60 hover:text-white",
          )}
          type="button"
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
