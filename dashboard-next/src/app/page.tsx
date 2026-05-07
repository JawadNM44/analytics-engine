import Link from "next/link";
import { LiveTape } from "@/components/live-tape";
import { GlassCard } from "@/components/glass-card";
import { AnomaliesTable } from "@/components/anomalies-table";
import { WhalesTable } from "@/components/whales-table";
import { OrchestrationSection } from "@/components/orchestration-section";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      {/* Hero */}
      <section className="mb-12 max-w-3xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/65 [html.light_&]:border-black/10 [html.light_&]:bg-white/60 [html.light_&]:text-zinc-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
          Live · 24/7
        </div>
        <h1 className="font-display text-5xl font-medium leading-tight sm:text-6xl">
          Crypto Analytics, in real time.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-white/65 [html.light_&]:text-zinc-600">
          Every trade on Coinbase for BTC, ETH and SOL — captured within two
          seconds, stored in BigQuery, and scanned for unusual market
          behaviour by two layers of anomaly detection.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/symbol/BTC-USD"
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/90 [html.light_&]:bg-zinc-900 [html.light_&]:text-white [html.light_&]:hover:bg-zinc-800"
          >
            Explore a symbol →
          </Link>
          <Link
            href="/anomalies"
            className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium transition hover:bg-white/10 [html.light_&]:border-black/15 [html.light_&]:bg-white/60 [html.light_&]:hover:bg-white/80"
          >
            See anomalies
          </Link>
        </div>
      </section>

      {/* Live tape */}
      <section className="mb-12">
        <LiveTape />
      </section>

      {/* Model orchestration — six-stage pipeline visual */}
      <OrchestrationSection />

      {/* Pipeline pitch */}
      <section className="mb-12 grid gap-4 sm:grid-cols-3">
        <GlassCard>
          <div className="text-xs uppercase tracking-widest text-white/45 [html.light_&]:text-zinc-500">Ingestion</div>
          <div className="mt-2 font-display text-xl">Coinbase WebSocket</div>
          <p className="mt-2 text-sm text-white/60 [html.light_&]:text-zinc-600">
            Public exchange feed, every match event captured continuously.
          </p>
        </GlassCard>
        <GlassCard>
          <div className="text-xs uppercase tracking-widest text-white/45 [html.light_&]:text-zinc-500">Processing</div>
          <div className="mt-2 font-display text-xl">Pub/Sub → BigQuery</div>
          <p className="mt-2 text-sm text-white/60 [html.light_&]:text-zinc-600">
            Idempotent stream inserts, partitioned + clustered tables, sub-2s end-to-end latency.
          </p>
        </GlassCard>
        <GlassCard>
          <div className="text-xs uppercase tracking-widest text-white/45 [html.light_&]:text-zinc-500">ML</div>
          <div className="mt-2 font-display text-xl">ARIMA_PLUS</div>
          <p className="mt-2 text-sm text-white/60 [html.light_&]:text-zinc-600">
            BigQuery ML model retrained nightly. Anomalies detected against its 95% confidence interval.
          </p>
        </GlassCard>
      </section>

      {/* Anomalies + whales */}
      <section className="mb-12 grid gap-4 lg:grid-cols-2">
        <AnomaliesTable />
        <WhalesTable />
      </section>

      <footer className="mt-16 border-t border-white/5 pt-6 text-xs text-white/45 [html.light_&]:border-black/10 [html.light_&]:text-zinc-500">
        <p>Built on Google Cloud · Terraformed · Workload Identity Federation · 0 long-lived credentials.</p>
        <p className="mt-1">
          Source:{" "}
          <a className="underline-offset-2 hover:underline" href="https://github.com/JawadNM44/analytics-engine">
            github.com/JawadNM44/analytics-engine
          </a>
        </p>
      </footer>
    </main>
  );
}
