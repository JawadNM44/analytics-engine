"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface AnimatedNumberProps {
  value: number | null | undefined;
  format: (n: number | null | undefined) => string;
  /** Minimum delta before flashing (avoids noise on tiny changes) */
  threshold?: number;
  className?: string;
  /** Roll the displayed digits over `durationMs` instead of snapping. */
  durationMs?: number;
}

/**
 * Number with two visual cues for liveness:
 *   1. Smooth easing of the displayed value over `durationMs` ms when it
 *      changes (counts up/down rather than snapping).
 *   2. A green/red flash of the colour for ~1.6s on each change above
 *      the threshold (configurable; default 0).
 *
 * Hook deliberately uses requestAnimationFrame, not setInterval, so it
 * is buttery on phones and laptops alike.
 */
export function AnimatedNumber({
  value,
  format,
  threshold = 0,
  className,
  durationMs = 600,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState<number | null | undefined>(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const rafRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRef = useRef<number | null | undefined>(value);

  useEffect(() => {
    const prev = previousRef.current;
    previousRef.current = value;

    if (value == null || prev == null) {
      setDisplay(value);
      return;
    }
    const delta = value - prev;
    if (Math.abs(delta) <= threshold) {
      setDisplay(value);
      return;
    }

    // Trigger flash
    setFlash(delta > 0 ? "up" : "down");
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 1700);

    // Tween from prev → value over durationMs using easeOutCubic
    const start = performance.now();
    const from = prev;
    const to = value;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, threshold, durationMs]);

  return (
    <span className={cn(flash === "up" && "flash-up", flash === "down" && "flash-down", className)}>
      {format(display)}
    </span>
  );
}
