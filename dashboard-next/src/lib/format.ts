const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("en-US");
const pct = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  usd: (n: number | null | undefined) => (n == null ? "—" : usd.format(n)),
  usdCompact: (n: number | null | undefined) => (n == null ? "—" : usdCompact.format(n)),
  num: (n: number | null | undefined) => (n == null ? "—" : num.format(n)),
  pct: (n: number | null | undefined) => (n == null ? "—" : pct.format(n)),
  signedPct: (n: number | null | undefined) => {
    if (n == null) return "—";
    const s = pct.format(n);
    return n > 0 ? `+${s}` : s;
  },
  time: (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  },
};
