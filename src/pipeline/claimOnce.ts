/**
 * Process each payment exactly once.
 *
 * Payment providers retry webhooks, and a slow response can produce two deliveries of the same
 * event a few seconds apart. Generating a report costs an LLM call and sends an email, so a
 * duplicate must never run twice. The webhook handler claims the payment id inside a transaction,
 * queues the work and returns 200 fast; a worker then moves it from "queued" to "processing",
 * again exactly once.
 *
 * A previous "error" can be claimed again, so a failed run is retryable; any other state means
 * another run already owns the payment.
 */

import type { Doc, Store } from "../store/memoryStore";

export type DeliveryStatus = "queued" | "processing" | "done" | "error" | "needs_attention" | "held";

const key = (paymentId: string) => `deliveries/${paymentId}`;

export async function claimDelivery(
  store: Store,
  paymentId: string,
  fields: Doc,
  now = Date.now()
): Promise<{ claimed: boolean; existing?: Doc }> {
  return store.runTransaction((tx) => {
    const existing = tx.get(key(paymentId));
    if (existing && existing.status !== "error") return { claimed: false, existing };
    tx.set(key(paymentId), { paymentId, ...fields, status: "queued", error: null, queuedAt: now }, { merge: true });
    return { claimed: true };
  });
}

/** Worker side: queued → processing, exactly once even if the trigger fires twice. */
export async function startQueued(store: Store, paymentId: string, now = Date.now()): Promise<Doc | null> {
  return store.runTransaction((tx) => {
    const doc = tx.get(key(paymentId));
    if (!doc || doc.status !== "queued") return null;
    tx.set(key(paymentId), { status: "processing", processingAt: now }, { merge: true });
    return doc;
  });
}

export async function finish(store: Store, paymentId: string, status: Exclude<DeliveryStatus, "queued" | "processing">, extra: Doc = {}) {
  await store.runTransaction((tx) => tx.set(key(paymentId), { status, ...extra }, { merge: true }));
}
