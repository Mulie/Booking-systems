// Fixed-window in-memory limiter. Per-instance only: on serverless it bounds abuse per warm
// instance; put a shared limiter (Upstash/Vercel WAF) in front if abuse appears.
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return true;
  }
  h.n++;
  return h.n <= max;
}
