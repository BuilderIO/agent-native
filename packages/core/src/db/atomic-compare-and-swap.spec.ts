import { afterEach, describe, expect, it, vi } from "vitest";

import { runCompareAndSwap } from "./atomic-compare-and-swap.js";

const getDialect = vi.hoisted(() => vi.fn(() => "sqlite" as string));
vi.mock("./client.js", () => ({ getDialect }));

/** Records the order of operations so the atomic unit's contents are visible. */
function recorder() {
  const order: string[] = [];
  const query = (label: string, value?: unknown) => {
    const promise: PromiseLike<unknown> & { label: string } = {
      label,
      then(resolve: any) {
        order.push(label);
        return Promise.resolve(value).then(resolve);
      },
    } as never;
    return promise;
  };
  return { order, query };
}

afterEach(() => {
  getDialect.mockReturnValue("sqlite");
});

describe("runCompareAndSwap", () => {
  it("runs read, write, and confirm inside one transaction on interactive dialects", async () => {
    const { order, query } = recorder();
    const tx = { marker: "tx" };
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        order.push("begin");
        const result = await fn(tx);
        order.push("commit");
        return result;
      },
    };

    const result = await runCompareAndSwap(db, {
      read: async (exec) => {
        expect(exec).toBe(tx);
        order.push("read");
        return { revision: 1 };
      },
      plan: (exec, current) => {
        expect(exec).toBe(tx);
        expect(current).toEqual({ revision: 1 });
        return {
          write: query("write"),
          confirm: query("confirm", [{ data: "next" }]),
        };
      },
    });

    expect(order).toEqual(["begin", "read", "write", "confirm", "commit"]);
    expect(result.current).toEqual({ revision: 1 });
    expect(result.confirmed).toEqual([{ data: "next" }]);
  });

  it("batches the write and its confirmation on D1", async () => {
    getDialect.mockReturnValue("d1");
    const { order, query } = recorder();
    const batched: unknown[] = [];
    const db = {
      batch: async (queries: readonly unknown[]) => {
        order.push("batch");
        batched.push(...queries);
        return [{ rowsAffected: 1 }, [{ data: "next" }]];
      },
    };

    const result = await runCompareAndSwap(db, {
      read: async (exec) => {
        expect(exec).toBe(db);
        order.push("read");
        return { revision: 1 };
      },
      plan: () => ({
        write: query("write"),
        confirm: query("confirm"),
      }),
    });

    // The read is outside the atomic unit on D1 — the CAS predicate and the
    // confirmation read are what cover the gap — but the write and confirm are
    // handed to batch() together and never awaited separately.
    expect(order).toEqual(["read", "batch"]);
    expect(batched).toHaveLength(2);
    expect(result.confirmed).toEqual([{ data: "next" }]);
  });

  it("never falls back to a transaction on D1", async () => {
    getDialect.mockReturnValue("d1");
    const transaction = vi.fn();
    await expect(
      runCompareAndSwap(
        { transaction },
        {
          read: async () => null,
          plan: () => ({ write: {} as never, confirm: {} as never }),
        },
      ),
      // A bare BEGIN is what D1 rejects; falling through would name the wrong
      // cause and read as a database error rather than a wiring one.
    ).rejects.toThrow(/no batch\(\)/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("propagates a read failure before anything is written", async () => {
    getDialect.mockReturnValue("d1");
    const batch = vi.fn();
    await expect(
      runCompareAndSwap(
        { batch },
        {
          read: async () => {
            throw new Error("row not found");
          },
          plan: () => ({ write: {} as never, confirm: {} as never }),
        },
      ),
    ).rejects.toThrow("row not found");
    expect(batch).not.toHaveBeenCalled();
  });
});
