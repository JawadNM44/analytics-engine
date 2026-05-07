"use client";
import { useEffect, useState } from "react";
import { GlassCard } from "./glass-card";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Whale {
  trade_time: string;
  product_id: string;
  side: string;
  size: number;
  price: number;
  volume_usd: number;
}

export function WhalesTable() {
  const [rows, setRows] = useState<Whale[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/whales?limit=15");
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setRows(d.whales);
      } catch {}
    }
    load();
    const t = setInterval(load, 20_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <GlassCard className="animate-fade-in">
      <div className="mb-3">
        <div className="text-xs uppercase tracking-widest text-white/50">Largest trades · live</div>
        <h3 className="font-display text-xl text-white">Whales of the day</h3>
        <p className="text-xs text-white/50">
          Single trades large enough to land in the top 1% of all trades for that symbol today.
        </p>
      </div>
      {!rows && <div className="text-white/50">Loading…</div>}
      {rows && rows.length === 0 && <div className="text-white/50">No whale trades today yet.</div>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="py-2 pr-4">Time (UTC)</th>
                <th className="py-2 pr-4">Symbol</th>
                <th className="py-2 pr-4">Side</th>
                <th className="py-2 pr-4">USD value</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {rows.map((w, i) => (
                <tr key={`${w.trade_time}-${i}`} className="border-t border-white/5">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {new Date(w.trade_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="py-2 pr-4">{w.product_id}</td>
                  <td className={cn("py-2 pr-4 font-medium uppercase",
                    w.side === "buy" ? "text-good" : "text-bad")}>
                    {w.side}
                  </td>
                  <td className="py-2 pr-4">{fmt.usd(w.volume_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}
