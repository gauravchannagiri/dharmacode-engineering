/**
 * Per-caller rate limiting for public endpoints, held in memory only.
 *
 * Each function instance keeps a fixed window per caller IP. The IP lives in memory for at most one
 * window and is never logged or stored, which keeps the privacy policy simple. Combined with a cap
 * on function instances, this bounds a flood without paying for a database write per request.
 */

/** The caller's IP (first x-forwarded-for entry), or "unknown". */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["x-forwarded-for"];
  const first = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim();
  return first || "unknown";
}

export function createLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }) {
  const { limit, windowMs, maxKeys = 5000 } = opts;
  const hits = new Map<string, { start: number; count: number }>();
  return {
    /** True if this request may go ahead. */
    allow(key: string, now = Date.now()): boolean {
      // Bound memory: drop expired windows first, and everything if still over the cap.
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        if (hits.size > maxKeys) hits.clear();
      }
      const h = hits.get(key);
      if (!h || now - h.start >= windowMs) {
        hits.set(key, { start: now, count: 1 });
        return true;
      }
      h.count += 1;
      return h.count <= limit;
    },
    /** For tests and monitoring. */
    size: () => hits.size,
  };
}
