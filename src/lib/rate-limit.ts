/**
 * Fixed-window limiter kept in process memory. Good enough for one instance; a multi-instance
 * deployment should move this to Redis/Upstash (noted in the TDD).
 */
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  h.count++;
  return h.count <= limit;
}
