import Link from "next/link";
import { AnomaliesTable } from "@/components/anomalies-table";
import { WhalesTable } from "@/components/whales-table";

export default function AnomaliesPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <Link href="/" className="text-sm text-white/60 hover:text-white [html.light_&]:text-zinc-900">← Back</Link>
      <h1 className="mt-6 font-display text-5xl text-white [html.light_&]:text-zinc-900">Anomalies</h1>
      <p className="mt-3 max-w-2xl text-white/60 [html.light_&]:text-zinc-600">
        Two ways the system flags unusual market behaviour: a fast statistical
        baseline (rolling z-score over 60 minutes) and the ML forecast model
        on each symbol page.
      </p>
      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <AnomaliesTable />
        <WhalesTable />
      </div>
    </main>
  );
}
