/**
 * Sliding-window-log rate limiter, in memory.
 *
 * Honest limitation: state lives in one process. On serverless (several instances)
 * or behind a load balancer the effective limit is `limit x instances`. For real
 * traffic swap the Map for Redis/Upstash (INCR + EXPIRE, or a token bucket) behind
 * the same `check()` interface.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0]!;
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }

    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(cutoff); // bound memory
    return { allowed: true, remaining: this.limit - recent.length, retryAfterSec: 0 };
  }

  private sweep(cutoff: number) {
    for (const [k, v] of this.hits) {
      if (!v.some((t) => t > cutoff)) this.hits.delete(k);
    }
  }
}

/** Best-effort client IP behind a proxy (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

// Module singletons, kept on globalThis so dev hot-reloads don't reset them.
const g = globalThis as unknown as {
  __slotlyLimiters?: { booking: RateLimiter; slots: RateLimiter; auth: RateLimiter };
};

export const limiters = (g.__slotlyLimiters ??= {
  booking: new RateLimiter(10, 60_000), // 10 booking attempts / minute / IP
  slots: new RateLimiter(60, 60_000), // 60 availability lookups / minute / IP
  auth: new RateLimiter(10, 15 * 60_000), // 10 login/signup attempts / 15 min / IP
});
