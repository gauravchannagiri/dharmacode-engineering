/**
 * Payment webhook signature check (Standard Webhooks spec).
 *
 *   signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 *   signature      = base64(HMAC-SHA256(base64decode(secret without "whsec_"), signedContent))
 *   header `webhook-signature` = space-separated list of `v1,<signature>` entries
 *
 * Design choices:
 * - Verify against the RAW body string, never re-serialised JSON (key order and spacing would change).
 * - Constant-time comparison, so response timing leaks nothing about the expected signature.
 * - Several signatures may be listed during secret rotation; any one valid entry passes.
 * - A replayed request carries a payment id that is already claimed, so it does no work
 *   (see src/pipeline/claimOnce.ts).
 */

import crypto from "node:crypto";

export type Headers = Record<string, string | string[] | undefined>;

const header = (headers: Headers, name: string): string | undefined => {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

export function sign(id: string, timestamp: string, rawBody: string, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
}

export function verifyWebhook(rawBody: string, headers: Headers, secret: string): boolean {
  const id = header(headers, "webhook-id");
  const ts = header(headers, "webhook-timestamp");
  const sigHeader = header(headers, "webhook-signature");
  if (!id || !ts || !sigHeader) return false;

  const expected = sign(id, ts, rawBody, secret);
  return sigHeader.split(" ").some((entry) => {
    const parts = entry.split(",");
    const sig = parts.length > 1 ? parts[1] : parts[0];
    return !!sig && safeEqual(sig, expected);
  });
}
