import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use — Crypto Analytics",
};

export default function TermsPage() {
  const year = new Date().getFullYear();
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="text-sm text-white/60 hover:text-white [html.light_&]:text-zinc-600 [html.light_&]:hover:text-zinc-900"
      >
        ← Back
      </Link>

      <h1 className="mt-6 font-display text-5xl text-white [html.light_&]:text-zinc-900">
        Terms of Use
      </h1>
      <p className="mt-2 text-sm text-white/45 [html.light_&]:text-zinc-500">
        Last updated · {year}
      </p>

      <div className="mt-10 flex flex-col gap-8 text-white/75 [html.light_&]:text-zinc-700">
        <Section title="1. About this site">
          <p>
            This website (the <em>"Site"</em>) and the underlying analytics
            pipeline are a personal portfolio project authored, owned, and
            maintained by <strong className="text-white [html.light_&]:text-zinc-900">Jawad NM</strong>.
            The project demonstrates real-time data engineering and machine-learning
            patterns on Google Cloud.
          </p>
        </Section>

        <Section title="2. Ownership and licence">
          <p>
            All design, code, copy, branding, and visual assets on this Site
            are <strong className="text-white [html.light_&]:text-zinc-900">© {year} Jawad NM</strong>,
            with the following exceptions:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              The open-source repository at{" "}
              <a
                href="https://github.com/JawadNM44/analytics-engine"
                className="underline-offset-2 hover:underline"
              >
                github.com/JawadNM44/analytics-engine
              </a>{" "}
              is published under the MIT licence — you may study, fork, and
              re-use the code subject to that licence's terms.
            </li>
            <li>
              Third-party libraries (Next.js, React, Recharts, framer-motion,
              FastAPI, etc.) retain their own licences.
            </li>
            <li>
              Cryptocurrency price data is obtained from the public Coinbase
              Exchange WebSocket and remains the property of its source.
            </li>
          </ul>
        </Section>

        <Section title="3. Not financial, investment, or legal advice">
          <p>
            Nothing on this Site is intended as, and nothing should be construed
            as, financial, investment, trading, tax, or legal advice. The
            anomaly-detection signals, forecasts, KPIs, and any other figures
            shown are <strong>illustrative</strong> outputs of statistical and
            machine-learning models. They may be wrong, late, biased, or based
            on incomplete data.
          </p>
          <p className="mt-3">
            Do not make trading or investment decisions on the basis of anything
            shown here. If you act on information from this Site you do so
            entirely at your own risk.
          </p>
        </Section>

        <Section title="4. No warranty">
          <p>
            The Site is provided <em>"as is"</em> and <em>"as available"</em>,
            without warranty of any kind, express or implied, including but not
            limited to warranties of merchantability, fitness for a particular
            purpose, accuracy, completeness, or non-infringement. Service may
            be interrupted, paused, or discontinued at any time without notice.
          </p>
        </Section>

        <Section title="5. Acceptable use">
          <p>You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Attempt to overwhelm the Site, its API, or its underlying
              infrastructure with unreasonable traffic.
            </li>
            <li>
              Reverse-engineer, scrape at scale, or attempt to circumvent the
              rate limits and security measures.
            </li>
            <li>
              Use the Site for any unlawful purpose or in violation of
              applicable export, sanctions, or financial-services regulations.
            </li>
            <li>
              Republish or commercially distribute the visual design or branding
              without prior written permission.
            </li>
          </ul>
        </Section>

        <Section title="6. Privacy">
          <p>
            This Site does not require an account, does not set tracking
            cookies, and does not collect personally identifiable information
            from visitors. Standard request logs (IP, user-agent, timestamp,
            path) are retained by Google Cloud for operational and security
            purposes for a limited period.
          </p>
        </Section>

        <Section title="7. Changes">
          <p>
            These terms may be updated from time to time. Continued use of the
            Site after a change constitutes acceptance of the updated terms.
            The "Last updated" date at the top of this page indicates the most
            recent revision.
          </p>
        </Section>

        <Section title="8. Contact">
          <p>
            For licensing requests, security disclosures, or general questions,
            open a private security advisory on the GitHub repository or email
            the address listed on the project's GitHub profile.
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-2xl text-white [html.light_&]:text-zinc-900">
        {title}
      </h2>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}
