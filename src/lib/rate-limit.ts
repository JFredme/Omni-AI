/**
 * A small in-memory sliding-window limiter. It lives in process memory, which is right for a single self-hosted
 * server: limits reset on restart and are not shared between several instances.
 */

interface Bucket {
  hits: number[];
}

const holder = globalThis as { __omniRateLimits?: Map<string, Bucket> };
const store: Map<string, Bucket> = (holder.__omniRateLimits ??= new Map<string, Bucket>());

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function hit(key: string, limit: number, windowMs: number, now: number = Date.now()): LimitResult {
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((time) => now - time < windowMs);
  if (bucket.hits.length >= limit) {
    store.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000)) };
  }
  bucket.hits.push(now);
  store.set(key, bucket);
  if (store.size > 5_000) prune(windowMs, now);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Counts a hit only without blocking, used to check a limit before the work is done. */
export function peek(key: string, limit: number, windowMs: number, now: number = Date.now()): LimitResult {
  const hits = (store.get(key)?.hits ?? []).filter((time) => now - time < windowMs);
  const allowed = hits.length < limit;
  return { allowed, remaining: Math.max(0, limit - hits.length), retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
}

export function reset(key: string): void {
  store.delete(key);
}

export function clearAllLimits(): void {
  store.clear();
}

function prune(windowMs: number, now: number) {
  for (const [key, bucket] of store) {
    if (bucket.hits.every((time) => now - time >= windowMs)) store.delete(key);
  }
}
