"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/cn";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-9 w-16 rounded-full" aria-hidden />;
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative inline-flex h-9 w-16 items-center rounded-full",
        "border border-white/10 bg-white/5 backdrop-blur-xl",
        "[html.light_&]:border-black/10 [html.light_&]:bg-white/60",
        "transition-colors duration-300",
        "hover:border-white/20 [html.light_&]:hover:border-black/20",
      )}
    >
      <span
        className={cn(
          "absolute h-7 w-7 rounded-full",
          "bg-gradient-to-br from-white to-white/70 shadow-md",
          "[html.dark_&]:from-zinc-700 [html.dark_&]:to-zinc-900",
          "transition-all duration-300 ease-out",
          isDark ? "left-[calc(100%-2rem)]" : "left-1",
        )}
      />
      <Sun
        className={cn(
          "ml-2 h-4 w-4 text-amber-500 transition-opacity",
          isDark && "opacity-30",
        )}
      />
      <Moon
        className={cn(
          "ml-auto mr-2 h-4 w-4 text-blue-300 transition-opacity",
          !isDark && "opacity-30",
        )}
      />
    </button>
  );
}
