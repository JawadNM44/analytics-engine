"use client";
import { useEffect, useState } from "react";
import { GlassCard } from "./glass-card";
import { fmt } from "@/lib/format";

interface Anomaly {
  minute: string;
  product_id: string;
  volume_usd: number;
  z_score: number | null;
  method: string;
}

export function AnomaliesTable() {
  const [rows, setRows] = useState<Anomaly[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/anomalies?limit=15");
        if (!r.ok) throw new Error(`status ${r.status}`);
        const d = await r.json();
        if (!cancelled) setRows(d.anomalies);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <GlassCard className="animate-fade-in">
      <div className="mb-3">
        <div className="text-xs uppercase tracking-widest text-white/50">Statistical detection · live</div>
        <h3 className="font-display text-xl text-white">Recent unusual minutes</h3>
        <p className="text-xs text-white/50">
          Minutes where USD volume spiked beyond ±3 standard deviations of the rolling 60-min average.
        </p>
      </div>
      {error && <div className="text-amber-300">Couldn't load anomalies: {error}</div>}
      {!rows && !error && <div className="text-white/50">Loading…</div>}
      {rows && rows.length === 0 && <div className="text-white/50">No anomalies in the recent window.</div>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="py-2 pr-4">Time (UTC)</th>
                <th className="py-2 pr-4">Symbol</th>
                <th className="py-2 pr-4">USD volume</th>
                <th className="py-2 pr-4">Z-score</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {rows.map((a, i) => (
                <tr key={`${a.minute}-${a.product_id}-${i}`} className="border-t border-white/5">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {new Date(a.minute).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-2 pr-4">{a.product_id}</td>
                  <td className="py-2 pr-4">{fmt.usd(a.volume_usd)}</td>
                  <td className="py-2 pr-4 font-mono">
                    {a.z_score == null ? "—" : a.z_score.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}
