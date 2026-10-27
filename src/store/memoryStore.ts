/**
 * A tiny transactional key-value store.
 *
 * In production these patterns run on Firestore transactions. Here the same interface is backed by
 * an in-memory map, with transactions run one at a time, so the logic can be tested without a cloud
 * project. The code that uses it only depends on the interface below.
 */

export type Doc = Record<string, unknown>;

export interface Tx {
  get(key: string): Doc | undefined;
  set(key: string, value: Doc, opts?: { merge?: boolean }): void;
}

export interface Store {
  /** Runs `fn` atomically: no other transaction sees its reads or writes half-done. */
  runTransaction<T>(fn: (tx: Tx) => Promise<T> | T): Promise<T>;
  /** Read outside a transaction. */
  get(key: string): Doc | undefined;
}

export function createMemoryStore(): Store {
  const docs = new Map<string, Doc>();
  let queue: Promise<unknown> = Promise.resolve();

  return {
    runTransaction<T>(fn: (tx: Tx) => Promise<T> | T): Promise<T> {
      const run = async () => {
        const writes = new Map<string, Doc>();
        const tx: Tx = {
          get: (key) => {
            const pending = writes.get(key);
            const doc = pending ?? docs.get(key);
            return doc ? structuredClone(doc) : undefined;
          },
          set: (key, value, opts) => {
            const base = opts?.merge ? (writes.get(key) ?? docs.get(key) ?? {}) : {};
            writes.set(key, { ...base, ...structuredClone(value) });
          },
        };
        const result = await fn(tx);
        for (const [k, v] of writes) docs.set(k, v); // commit only if fn did not throw
        return result;
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
    get: (key) => {
      const doc = docs.get(key);
      return doc ? structuredClone(doc) : undefined;
    },
  };
}
