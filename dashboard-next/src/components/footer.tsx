import Link from "next/link";
import { Logo } from "./logo";

/**
 * Site-wide footer. Shows clear authorship + a link to the terms.
 *
 * Author / copyright text is intentionally prominent — this is a
 * personal portfolio project and the work belongs to Jawad NM.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mx-auto mt-20 max-w-7xl border-t border-white/5 px-6 py-10 [html.light_&]:border-black/10">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <Logo size={22} />
          <p className="mt-3 text-sm text-white/60 [html.light_&]:text-zinc-600">
            A personal portfolio project: live cryptocurrency analytics with
            statistical and ML-based anomaly detection. Built on Google Cloud,
            fully Terraformed.
          </p>
          <p className="mt-3 text-xs text-white/45 [html.light_&]:text-zinc-500">
            Data sourced from the public Coinbase Exchange WebSocket. Nothing
            on this site is financial, investment, or trading advice.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 text-sm">
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-white/40 [html.light_&]:text-zinc-500">
              Project
            </div>
            <ul className="flex flex-col gap-1.5">
              <li>
                <a
                  href="https://github.com/JawadNM44/analytics-engine"
                  className="text-white/70 hover:text-white [html.light_&]:text-zinc-700 [html.light_&]:hover:text-zinc-900"
                >
                  Source code
                </a>
              </li>
              <li>
                <Link
                  href="/anomalies"
                  className="text-white/70 hover:text-white [html.light_&]:text-zinc-700 [html.light_&]:hover:text-zinc-900"
                >
                  Anomalies
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-white/40 [html.light_&]:text-zinc-500">
              Legal
            </div>
            <ul className="flex flex-col gap-1.5">
              <li>
                <Link
                  href="/terms"
                  className="text-white/70 hover:text-white [html.light_&]:text-zinc-700 [html.light_&]:hover:text-zinc-900"
                >
                  Terms of use
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/JawadNM44/analytics-engine/blob/main/SECURITY.md"
                  className="text-white/70 hover:text-white [html.light_&]:text-zinc-700 [html.light_&]:hover:text-zinc-900"
                >
                  Security
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-start justify-between gap-2 border-t border-white/5 pt-6 text-xs md:flex-row md:items-center [html.light_&]:border-black/10">
        <div className="text-white/55 [html.light_&]:text-zinc-600">
          © {year} <span className="font-medium text-white [html.light_&]:text-zinc-900">Jawad NM</span>. All rights reserved.
        </div>
        <div className="text-white/40 [html.light_&]:text-zinc-500">
          Built on Google Cloud · Terraformed · Workload Identity Federation
        </div>
      </div>
    </footer>
  );
}
