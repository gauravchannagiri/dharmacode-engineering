/**
 * Hard daily cap on LLM calls: no bill shocks, whatever happens.
 *
 * Every LLM call first claims a slot in a per-day counter inside a transaction. Over the cap, no
 * call is made: the work is marked "held", the owner gets one alert for the day, and a scheduled
 * sweep re-queues held work, which claims a slot again (normally the next day).
 *
 * The decision is a pure function so it can be tested exhaustively; the transaction only wraps it.
 */

import type { Store } from "../store/memoryStore";

export const DEFAULT_DAILY_CAP = 50;

/** The cap from the environment when it is a positive whole number, else the default. */
export function dailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LLM_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

export type SlotDecision = { ok: boolean; used: number; alertNow: boolean };

/** Pure decision for one claim, given the day's counter document. */
export function decideSlot(day: { count?: unknown; alerted?: unknown } | undefined, cap: number): SlotDecision {
  const used = typeof day?.count === "number" ? day.count : 0;
  if (used >= cap) return { ok: false, used, alertNow: day?.alerted !== true };
  return { ok: true, used: used + 1, alertNow: false };
}

/** Day key in a fixed time zone, so "today" doesn't depend on where the server runs. */
export function dayKey(now: Date, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Claim one LLM call for today. ok=false means the cap is reached: make no LLM call. */
export async function claimSlot(store: Store, now = new Date(), cap = dailyCap()) {
  const day = dayKey(now);
  const key = `limits/llm_${day}`;
  const decision = await store.runTransaction((tx) => {
    const d = decideSlot(tx.get(key), cap);
    if (d.ok) tx.set(key, { day, count: d.used }, { merge: true });
    else if (d.alertNow) tx.set(key, { day, alerted: true }, { merge: true });
    return d;
  });
  return { ...decision, day, cap };
}
