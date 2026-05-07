"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Render an invisible placeholder of the same size to avoid layout shift.
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
        "dark:border-white/10 dark:bg-white/5",
        "transition-colors duration-300",
        "hover:border-white/20",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={cn(
          "absolute h-7 w-7 rounded-full",
          "bg-gradient-to-br from-white to-white/70 shadow-md",
          "dark:from-zinc-900 dark:to-zinc-700",
          isDark ? "right-1" : "left-1",
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
