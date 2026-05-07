"use client";
import { useEffect, useState, useMemo } from "react";
import { GlassCard } from "./glass-card";
import { AnimatedNumber } from "./animated-number";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { motion } from "framer-motion";

interface SymbolStat {
  product_id: string;
  trades: number;
  volume_usd: number;
  latest_trade: string;
}

export function LiveTape() {
  const [stats, setStats] = useState<SymbolStat[] | null>(null);
  const [tickAt, setTickAt] = useState<number>(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/stream/trades");
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("stats", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        setStats(data.by_symbol);
        setTickAt(Date.now());
      } catch {}
    });
    es.addEventListener("error", () => setConnected(false));
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const totalTrades = useMemo(
    () => (stats ? stats.reduce((a, b) => a + b.trades, 0) : null),
    [stats],
  );
  const totalVol = useMemo(
    () => (stats ? stats.reduce((a, b) => a + b.volume_usd, 0) : null),
    [stats],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs">
        <span className="uppercase tracking-widest text-white/55 [html.light_&]:text-zinc-500">
          Live · last 24h
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-2 font-medium",
            connected ? "text-emerald-500 [html.dark_&]:text-emerald-400" : "text-amber-500 [html.dark_&]:text-amber-400",
          )}
        >
          <span className="relative flex h-2 w-2">
            {connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                connected ? "bg-emerald-400" : "bg-amber-400",
              )}
            />
          </span>
          {connected ? "Streaming" : "Reconnecting"}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(stats ?? Array.from({ length: 3 })).map((s, i) => {
          const sym = s as SymbolStat | undefined;
          return (
            <motion.div
              key={sym?.product_id ?? i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.4, ease: "easeOut" }}
            >
              <GlassCard shimmer>
                <div className="flex items-center justify-between">
                  <div className="font-display text-2xl">
                    {sym?.product_id ?? "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-white/40 [html.light_&]:text-zinc-500">
                    24h
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-1">
                  <div className="text-xs text-white/55 [html.light_&]:text-zinc-500">USD value traded</div>
                  <div className="font-display text-3xl font-medium tabular-nums">
                    <AnimatedNumber value={sym?.volume_usd} format={fmt.usdCompact} threshold={100} />
                  </div>
                  <div className="text-xs text-white/45 [html.light_&]:text-zinc-500">
                    <AnimatedNumber value={sym?.trades} format={fmt.num} threshold={0} /> trades · last at {fmt.time(sym?.latest_trade)}
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <GlassCard shimmer>
          <div className="text-xs uppercase tracking-widest text-white/55 [html.light_&]:text-zinc-500">
            Trades captured · 24h
          </div>
          <div className="mt-2 font-display text-4xl font-medium tabular-nums">
            <AnimatedNumber value={totalTrades} format={fmt.num} threshold={0} />
          </div>
        </GlassCard>
        <GlassCard shimmer>
          <div className="text-xs uppercase tracking-widest text-white/55 [html.light_&]:text-zinc-500">
            Total USD value · 24h
          </div>
          <div className="mt-2 font-display text-4xl font-medium tabular-nums">
            <AnimatedNumber value={totalVol} format={fmt.usdCompact} threshold={1000} />
          </div>
        </GlassCard>
      </div>
      {tickAt > 0 && (
        <div className="text-right text-[11px] text-white/35 [html.light_&]:text-zinc-500">
          Last update {fmt.time(new Date(tickAt).toISOString())}
        </div>
      )}
    </div>
  );
}
