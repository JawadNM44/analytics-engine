"use client";
import { useEffect, useState, useMemo } from "react";
import { GlassCard } from "./glass-card";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

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
      <div className="flex items-center justify-between text-xs text-white/50">
        <span className="uppercase tracking-widest">Live · last 24h</span>
        <span className={cn("flex items-center gap-2", connected ? "text-emerald-300" : "text-amber-300")}>
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-emerald-400 animate-pulse-slow" : "bg-amber-400",
            )}
          />
          {connected ? "Streaming" : "Reconnecting"}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(stats ?? Array.from({ length: 3 })).map((s, i) => {
          const sym = s as SymbolStat | undefined;
          return (
            <GlassCard key={sym?.product_id ?? i} className="animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="font-display text-2xl text-white">
                  {sym?.product_id ?? "—"}
                </div>
                <div
                  className={cn(
                    "text-[10px] uppercase tracking-widest",
                    "text-white/40",
                  )}
                >
                  24h
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-1">
                <div className="text-xs text-white/50">USD value traded</div>
                <div className="font-display text-3xl font-medium text-white">
                  {fmt.usdCompact(sym?.volume_usd)}
                </div>
                <div className="text-xs text-white/40">
                  {fmt.num(sym?.trades)} trades · last at {fmt.time(sym?.latest_trade)}
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <GlassCard>
          <div className="text-xs uppercase tracking-widest text-white/50">Trades captured · 24h</div>
          <div className="mt-2 font-display text-4xl font-medium text-white">{fmt.num(totalTrades)}</div>
        </GlassCard>
        <GlassCard>
          <div className="text-xs uppercase tracking-widest text-white/50">Total USD value · 24h</div>
          <div className="mt-2 font-display text-4xl font-medium text-white">{fmt.usdCompact(totalVol)}</div>
        </GlassCard>
      </div>
      {tickAt > 0 && (
        <div className="text-right text-[11px] text-white/30">
          Last update {fmt.time(new Date(tickAt).toISOString())}
        </div>
      )}
    </div>
  );
}
