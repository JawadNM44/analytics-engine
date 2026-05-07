/**
 * Simple per-IP token bucket. Tokens replenish at `RATE` per second up
 * to `BURST`. Returns true if the request is allowed.
 *
 * In-memory only — resets on container restart, which is fine for
 * Cloud Run (one bucket per instance, max-instances 5 caps total
 * abuse irrespective of bucket precision).
 */
const RATE = 1; // tokens per second
const BURST = 60; // max tokens

type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function allow(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) {
      // Drop oldest 10% to keep map bounded.
      const kill = Math.ceil(MAX_BUCKETS * 0.1);
      const it = buckets.keys();
      for (let i = 0; i < kill; i++) {
        const k = it.next().value;
        if (k) buckets.delete(k);
      }
    }
    b = { tokens: BURST, updated: now };
    buckets.set(ip, b);
  }
  // Replenish.
  const elapsed = (now - b.updated) / 1000;
  b.tokens = Math.min(BURST, b.tokens + elapsed * RATE);
  b.updated = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}
