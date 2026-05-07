"use client";
import { motion } from "framer-motion";
import { GlassCard } from "./glass-card";
import { cn } from "@/lib/cn";
import { Activity, Sparkles, ShieldCheck, ScanLine, Workflow, Cpu } from "lucide-react";

const AGENTS = [
  { icon: Activity, name: "Ingestor", desc: "Normalises Coinbase trade events", colour: "from-cyan-400/30 to-cyan-600/0" },
  { icon: ScanLine, name: "Z-score detector", desc: "Statistical baseline · 60-min rolling window", colour: "from-emerald-400/30 to-emerald-600/0" },
  { icon: Cpu, name: "ARIMA forecaster", desc: "BigQuery ML · retrained nightly", colour: "from-amber-400/30 to-amber-600/0" },
  { icon: Workflow, name: "Pipeline orchestrator", desc: "Routes events through stages", colour: "from-purple-400/30 to-purple-600/0" },
  { icon: Sparkles, name: "Insight generator", desc: "Adds context to anomalies (planned)", colour: "from-fuchsia-400/30 to-fuchsia-600/0" },
  { icon: ShieldCheck, name: "Hallucination guard", desc: "Verifies LLM claims (planned)", colour: "from-rose-400/30 to-rose-600/0" },
];

export function OrchestrationSection() {
  return (
    <section className="mb-16">
      <div className="mb-6 max-w-3xl">
        <div className="mb-2 text-xs uppercase tracking-widest text-accent">
          Model orchestration
        </div>
        <h2 className="font-display text-3xl font-medium leading-tight sm:text-4xl">
          Six specialised stages turn raw trades into watchable signal.
        </h2>
        <p className="mt-3 max-w-2xl text-white/60 [html.light_&]:text-zinc-600">
          Each stage is a single-purpose worker — a pattern modelled on
          modern AI orchestration. Two stages are planned (light text)
          and arrive in the next release: an LLM-powered insight generator
          and a hallucination guard for the explanations it produces.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((a, i) => (
          <motion.div
            key={a.name}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.05, duration: 0.45, ease: "easeOut" }}
          >
            <GlassCard
              className={cn(
                "h-full",
                "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:opacity-0 hover:before:opacity-100",
                "before:transition-opacity before:duration-500 before:-z-10",
              )}
              shimmer
            >
              <div className={cn("mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br", a.colour, "border border-white/10 [html.light_&]:border-black/10")}>
                <a.icon className="h-5 w-5" strokeWidth={1.6} />
              </div>
              <div className="font-display text-xl">{a.name}</div>
              <p className="mt-1 text-sm text-white/55 [html.light_&]:text-zinc-600">{a.desc}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
