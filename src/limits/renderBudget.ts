/**
 * Budget for an expensive endpoint: PDF rendering.
 *
 * Each render starts a headless browser with gigabytes of memory, so it is checked against two
 * shared limits before the browser launches: per report per hour, and for the whole site per day.
 * Over either limit the endpoint answers 429 and nothing expensive starts.
 */

export const RENDERS_PER_REPORT_PER_HOUR = 10;
export const RENDERS_PER_DAY = 300;
const HOUR = 60 * 60 * 1000;

type Window = { windowStart?: unknown; count?: unknown } | undefined;

/** Pure decision: may this report be rendered now? Returns the counters to write if so. */
export function decideRender(perReport: Window, perDay: { count?: unknown } | undefined, now: number) {
  const start = typeof perReport?.windowStart === "number" ? perReport.windowStart : 0;
  const inWindow = now - start < HOUR;
  const reportCount = inWindow && typeof perReport?.count === "number" ? perReport.count : 0;
  const dayCount = typeof perDay?.count === "number" ? perDay.count : 0;
  const ok = reportCount < RENDERS_PER_REPORT_PER_HOUR && dayCount < RENDERS_PER_DAY;
  return { ok, windowStart: inWindow ? start : now, reportCount: reportCount + 1, dayCount: dayCount + 1 };
}
