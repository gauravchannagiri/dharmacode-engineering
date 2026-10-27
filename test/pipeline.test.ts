import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/store/memoryStore";
import { claimDelivery, finish, startQueued } from "../src/pipeline/claimOnce";

describe("claim each payment once", () => {
  it("lets exactly one of many simultaneous webhook deliveries claim the payment", async () => {
    const store = createMemoryStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => claimDelivery(store, "pay_1", { email: "a@example.com" })));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(store.get("deliveries/pay_1")?.status).toBe("queued");
  });

  it("starts processing exactly once even if the worker trigger fires twice", async () => {
    const store = createMemoryStore();
    await claimDelivery(store, "pay_2", {});
    const [a, b] = await Promise.all([startQueued(store, "pay_2"), startQueued(store, "pay_2")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(store.get("deliveries/pay_2")?.status).toBe("processing");
  });

  it("does not re-run a finished payment", async () => {
    const store = createMemoryStore();
    await claimDelivery(store, "pay_3", {});
    await startQueued(store, "pay_3");
    await finish(store, "pay_3", "done", { reportId: "r1" });
    const again = await claimDelivery(store, "pay_3", {});
    expect(again.claimed).toBe(false);
    expect(again.existing?.reportId).toBe("r1");
  });

  it("allows a retry after an error", async () => {
    const store = createMemoryStore();
    await claimDelivery(store, "pay_4", {});
    await finish(store, "pay_4", "error", { error: "timeout" });
    const retry = await claimDelivery(store, "pay_4", {});
    expect(retry.claimed).toBe(true);
    expect(store.get("deliveries/pay_4")).toMatchObject({ status: "queued", error: null });
  });

  it("rolls back a transaction that throws", async () => {
    const store = createMemoryStore();
    await expect(
      store.runTransaction((tx) => {
        tx.set("deliveries/pay_5", { status: "queued" });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(store.get("deliveries/pay_5")).toBeUndefined();
  });
});
