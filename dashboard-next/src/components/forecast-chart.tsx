"use client";
import { useEffect, useState } from "react";
import {
  Area, ComposedChart, Line, ResponsiveContainer, Tooltip,
  XAxis, YAxis, CartesianGrid, ReferenceDot,
} from "recharts";
import { GlassCard } from "./glass-card";
import { fmt } from "@/lib/format";

interface Point {
  minute: string;
  volume_usd: number;
  lower_bound: number | null;
  upper_bound: number | null;
  forecast: number | null;
  is_anomaly: boolean;
  ts: number;
}

interface Props { symbol: string }

export function ForecastChart({ symbol }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function load() {
      try {
        const res = await fetch(`/api/forecast/${symbol}?hours=6`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const mapped: Point[] = data.points
          .filter((p: any) => p.lower_bound != null && p.upper_bound != null)
          .map((p: any) => ({
            minute: p.minute,
            volume_usd: p.volume_usd,
            lower_bound: Math.max(0, p.lower_bound),
            upper_bound: p.upper_bound,
            forecast: (Math.max(0, p.lower_bound) + p.upper_bound) / 2,
            is_anomaly: p.is_anomaly,
            ts: new Date(p.minute).getTime(),
          }));
        setPoints(mapped);
        setLoading(false);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    }
    load();
    timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [symbol]);

  if (loading) {
    return <GlassCard><div className="text-white/50 [html.light_&]:text-zinc-500">Loading forecast…</div></GlassCard>;
  }
  if (error || points.length === 0) {
    return (
      <GlassCard>
        <div className="text-white/70 [html.light_&]:text-zinc-700">
          Forecast not yet available — the model needs ~24h of recent data and
          the producer needs to be running. Restart the producer and check back.
        </div>
      </GlassCard>
    );
  }

  const anomalies = points.filter((p) => p.is_anomaly);
  const inBand =
    points.length === 0
      ? null
      : points.filter((p) => p.volume_usd >= (p.lower_bound ?? 0) && p.volume_usd <= (p.upper_bound ?? Infinity)).length / points.length;
  const medianErr = (() => {
    const errs = points
      .filter((p) => p.forecast && p.forecast > 0)
      .map((p) => Math.abs(p.volume_usd - (p.forecast ?? 0)) / (p.forecast ?? 1));
    if (errs.length === 0) return null;
    errs.sort((a, b) => a - b);
    return errs[Math.floor(errs.length / 2)];
  })();

  return (
    <GlassCard className="animate-fade-in">
      <div className="mb-4 flex flex-col gap-1">
        <div className="text-xs uppercase tracking-widest text-white/55 [html.light_&]:text-zinc-500">ML model</div>
        <h3 className="font-display text-2xl text-white [html.light_&]:text-zinc-900">
          What the model predicted vs what really happened — {symbol}
        </h3>
        <p className="max-w-3xl text-sm text-white/60 [html.light_&]:text-zinc-600">
          The orange dashed line is what the ML model expected. The blue solid
          line is what actually traded. The shaded band is the model's 95%
          confidence range. Red dots are minutes where reality fell outside
          the band — flagged as ML anomalies.
        </p>
      </div>
      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="ts" type="number" domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => fmt.time(new Date(v).toISOString())}
              tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.15)", strokeDasharray: "3 3" }}
              contentStyle={{ background: "rgba(10,10,10,0.92)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
              labelFormatter={(v) => new Date(v as number).toLocaleString()}
              formatter={(value: number, name) => [fmt.usd(value), name]}
            />
            <Area
              dataKey="upper_bound" stroke="none"
              fill="rgba(255,154,0,0.12)" fillOpacity={1}
              isAnimationActive={false} legendType="none"
            />
            <Area
              dataKey="lower_bound" stroke="none"
              fill="rgba(10,10,10,1)" fillOpacity={1}
              isAnimationActive={false} legendType="none"
            />
            <Line
              dataKey="forecast" name="Forecast" stroke="#ff9a00"
              strokeWidth={2} strokeDasharray="6 4" dot={false}
              isAnimationActive
            />
            <Line
              dataKey="volume_usd" name="Actual" stroke="#20a4d8"
              strokeWidth={2.5} dot={false}
              isAnimationActive
            />
            {anomalies.map((a) => (
              <ReferenceDot
                key={a.ts} x={a.ts} y={a.volume_usd}
                r={5} fill="#ef4444" stroke="#7f1d1d" strokeWidth={1.5}
                ifOverflow="extendDomain"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="text-xs uppercase tracking-widest text-white/45 [html.light_&]:text-zinc-500">Median forecast error</div>
          <div className="font-display text-xl text-white [html.light_&]:text-zinc-900">{medianErr == null ? "—" : fmt.pct(medianErr)}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="text-xs uppercase tracking-widest text-white/45 [html.light_&]:text-zinc-500">Minutes inside band</div>
          <div className="font-display text-xl text-white [html.light_&]:text-zinc-900">{inBand == null ? "—" : fmt.pct(inBand)}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="text-xs uppercase tracking-widest text-white/45 [html.light_&]:text-zinc-500">Anomalies flagged</div>
          <div className="font-display text-xl text-white [html.light_&]:text-zinc-900">{anomalies.length}</div>
        </div>
      </div>
    </GlassCard>
  );
}
