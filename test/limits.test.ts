import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/store/memoryStore";
import { clientIp, createLimiter } from "../src/limits/rateLimiter";
import { claimSlot, dailyCap, dayKey, decideSlot, DEFAULT_DAILY_CAP } from "../src/limits/dailyCap";
import { decideRender, RENDERS_PER_DAY, RENDERS_PER_REPORT_PER_HOUR } from "../src/limits/renderBudget";

describe("rate limiter", () => {
  it("allows up to the limit in a window, then refuses, then resets", () => {
    const l = createLimiter({ limit: 3, windowMs: 1000 });
    const t = 10_000;
    expect([1, 2, 3, 4].map(() => l.allow("ip", t))).toEqual([true, true, true, false]);
    expect(l.allow("ip", t + 1000)).toBe(true);
  });

  it("keeps callers separate", () => {
    const l = createLimiter({ limit: 1, windowMs: 1000 });
    expect(l.allow("a", 0)).toBe(true);
    expect(l.allow("b", 0)).toBe(true);
    expect(l.allow("a", 1)).toBe(false);
  });

  it("bounds memory under a flood of distinct callers", () => {
    const l = createLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.allow(`ip${i}`, 0);
    expect(l.size()).toBeLessThanOrEqual(101);
  });

  it("reads the first forwarded IP", () => {
    expect(clientIp({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toBe("203.0.113.7");
    expect(clientIp({})).toBe("unknown");
  });
});

describe("daily LLM cap", () => {
  it("counts up to the cap, then holds work and asks for one alert", () => {
    expect(decideSlot(undefined, 2)).toEqual({ ok: true, used: 1, alertNow: false });
    expect(decideSlot({ count: 1 }, 2)).toEqual({ ok: true, used: 2, alertNow: false });
    expect(decideSlot({ count: 2 }, 2)).toEqual({ ok: false, used: 2, alertNow: true });
    expect(decideSlot({ count: 2, alerted: true }, 2)).toEqual({ ok: false, used: 2, alertNow: false });
  });

  it("never lets concurrent claims exceed the cap", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-10-28T06:00:00Z");
    const results = await Promise.all(Array.from({ length: 20 }, () => claimSlot(store, now, 5)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => r.alertNow)).toHaveLength(1);
  });

  it("uses a positive whole number from the environment, else the default", () => {
    expect(dailyCap({ LLM_DAILY_CAP: "20" })).toBe(20);
    for (const bad of ["0", "-3", "2.5", "lots", undefined]) expect(dailyCap({ LLM_DAILY_CAP: bad })).toBe(DEFAULT_DAILY_CAP);
  });

  it("counts days in India time, not server time", () => {
    expect(dayKey(new Date("2026-10-27T19:00:00Z"))).toBe("2026-10-28"); // 00:30 IST
  });
});

describe("PDF render budget", () => {
  it("refuses after the per-report hourly limit and resets after an hour", () => {
    const now = 1_000_000_000;
    expect(decideRender({ windowStart: now - 1000, count: RENDERS_PER_REPORT_PER_HOUR }, { count: 0 }, now).ok).toBe(false);
    const later = decideRender({ windowStart: now - 3_600_001, count: RENDERS_PER_REPORT_PER_HOUR }, { count: 0 }, now);
    expect(later).toMatchObject({ ok: true, windowStart: now, reportCount: 1 });
  });

  it("refuses when the site-wide daily budget is spent", () => {
    expect(decideRender(undefined, { count: RENDERS_PER_DAY }, 0).ok).toBe(false);
  });
});
