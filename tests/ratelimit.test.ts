import { describe, expect, it } from "vitest";
import { RateLimiter, clientIp } from "../lib/ratelimit";

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks with a Retry-After", () => {
    let t = 1_000_000;
    const rl = new RateLimiter(3, 60_000, () => t);
    expect(rl.check("ip").allowed).toBe(true);
    expect(rl.check("ip").allowed).toBe(true);
    const third = rl.check("ip");
    expect(third).toMatchObject({ allowed: true, remaining: 0 });

    t += 10_000;
    const blocked = rl.check("ip");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(50);
  });

  it("recovers as the window slides", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    rl.check("a");
    rl.check("a");
    expect(rl.check("a").allowed).toBe(false);
    t = 1001;
    expect(rl.check("a").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter(1, 1000, () => 0);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to 'unknown'", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
