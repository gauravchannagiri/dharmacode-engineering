/**
 * Who may see a report's status and link?
 *
 * An email address alone is not enough: emails are easy to know or guess, and the answer links to a
 * child's report. The caller must hold the payment id, which the payment provider appends to the
 * buyer's own post-payment redirect. An email may still be passed as a second factor, but it must
 * then match.
 *
 * Responses carry only what the waiting page needs: never the email, never error detail.
 */

import type { Store } from "../store/memoryStore";

export interface StatusQuery {
  paymentId?: string;
  email?: string;
}

export type PublicStatus = {
  status: "queued" | "processing" | "done" | "error" | "needs_attention" | "held" | "not_found";
  url?: string | null;
  error?: string;
};

/** Payment ids are short ASCII tokens. Anything else is rejected before touching the database. */
const PAYMENT_ID = /^[A-Za-z0-9_-]{6,128}$/;

/** A message for a bad request (answer 400), or null when the query is usable. */
export function queryError(q: StatusQuery): string | null {
  if (!q.paymentId) return q.email ? "paymentId is required; email alone is not accepted" : "pass paymentId";
  if (!PAYMENT_ID.test(q.paymentId)) return "invalid paymentId";
  return null;
}

export async function getStatus(store: Store, q: StatusQuery, site: string): Promise<PublicStatus> {
  if (queryError(q)) return { status: "not_found" };
  const data = store.get(`deliveries/${q.paymentId}`);
  if (!data) return { status: "not_found" };

  // Optional second factor: when an email is supplied it has to belong to this payment.
  if (q.email && String(data.email ?? "").toLowerCase() !== q.email.trim().toLowerCase()) return { status: "not_found" };

  const reportId = typeof data.reportId === "string" ? data.reportId : null;
  return {
    status: (data.status as PublicStatus["status"]) ?? "processing",
    url: reportId ? `${site}/report/${reportId}` : null,
    error: data.status === "error" ? "generation_failed" : undefined,
  };
}
