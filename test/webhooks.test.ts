import { describe, expect, it } from "vitest";
import { sign, verifyWebhook } from "../src/webhooks/verifySignature";

const SECRET = `whsec_${Buffer.from("test-signing-secret").toString("base64")}`;
const body = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_test_123" } });

const signed = (raw = body, secret = SECRET, id = "msg_1", ts = "1761609600") => ({
  "webhook-id": id,
  "webhook-timestamp": ts,
  "webhook-signature": `v1,${sign(id, ts, raw, secret)}`,
});

describe("verifyWebhook", () => {
  it("accepts a correctly signed request", () => {
    expect(verifyWebhook(body, signed(), SECRET)).toBe(true);
  });

  it("rejects a body changed after signing", () => {
    const headers = signed();
    expect(verifyWebhook(body.replace("pay_test_123", "pay_other"), headers, SECRET)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const other = `whsec_${Buffer.from("someone-else").toString("base64")}`;
    expect(verifyWebhook(body, signed(body, other), SECRET)).toBe(false);
  });

  it("rejects requests missing any signing header", () => {
    for (const drop of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const headers: Record<string, string | undefined> = { ...signed() };
      delete headers[drop];
      expect(verifyWebhook(body, headers, SECRET)).toBe(false);
    }
  });

  it("accepts any valid entry when several signatures are listed (secret rotation)", () => {
    const h = signed();
    h["webhook-signature"] = `v1,bm90LXRoZS1yaWdodC1vbmU= ${h["webhook-signature"]}`;
    expect(verifyWebhook(body, h, SECRET)).toBe(true);
  });

  it("checks the raw body, so re-serialised JSON with different spacing fails", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyWebhook(pretty, signed(), SECRET)).toBe(false);
  });
});
