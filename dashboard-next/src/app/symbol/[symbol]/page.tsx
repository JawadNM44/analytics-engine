"use client";
import { useEffect, useState, use } from "react";
import { ForecastChart } from "@/components/forecast-chart";
import { SymbolPicker } from "@/components/symbol-picker";
import { KPI } from "@/components/kpi";
import { fmt } from "@/lib/format";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Footer } from "@/components/footer";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];

interface Price {
  symbol: string;
  price: number | null;
  pct_change_1h: number | null;
}

export default function SymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const decoded = decodeURIComponent(symbol).toUpperCase();
  const router = useRouter();
  const [price, setPrice] = useState<Price | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/price/${decoded}`);
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setPrice(d);
      } catch {}
    }
    load();
    const t = setInterval(load, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [decoded]);

  if (!SYMBOLS.includes(decoded)) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-16">
        <Link href="/" className="text-sm text-white/60 hover:text-white [html.light_&]:text-zinc-900">← Back</Link>
        <h1 className="mt-6 font-display text-4xl text-white [html.light_&]:text-zinc-900">Unknown symbol</h1>
        <p className="mt-2 text-white/60 [html.light_&]:text-zinc-600">Try {SYMBOLS.join(", ")}.</p>
      </main>
    );
  }

  const positive = price?.pct_change_1h == null ? null : price.pct_change_1h >= 0;
  const deltaText = price?.pct_change_1h == null
    ? "—"
    : fmt.signedPct(price.pct_change_1h) + " · last hour";

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-white/60 hover:text-white [html.light_&]:text-zinc-900">← Back</Link>
        <SymbolPicker
          value={decoded}
          options={SYMBOLS}
          onChange={(s) => router.push(`/symbol/${s}`)}
        />
      </div>

      <div className="mb-8 flex items-baseline gap-4">
        <h1 className="font-display text-5xl text-white [html.light_&]:text-zinc-900">{decoded}</h1>
        <span className="text-sm uppercase tracking-widest text-white/40 [html.light_&]:text-zinc-500">live</span>
      </div>

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <KPI
          label="Price"
          value={price ? fmt.usd(price.price) : "—"}
          delta={{ value: deltaText, positive }}
        />
        <KPI label="Change · last hour" value={fmt.signedPct(price?.pct_change_1h)} hint="Spot delta" />
        <KPI
          label="Source"
          value="Coinbase"
          hint="Public WebSocket · matches channel"
        />
      </section>

      <section className="mb-8">
        <ForecastChart symbol={decoded} />
      </section>

      <p className="mt-12 text-xs text-white/40 [html.light_&]:text-zinc-500">
        Forecast chart auto-refreshes every 30s. Price ticks every 5s.
      </p>

      <Footer />
    </main>
  );
}
