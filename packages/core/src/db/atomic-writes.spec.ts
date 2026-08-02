import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { runAtomicWrites } from "./atomic-writes.js";
import * as client from "./client.js";

function query(label: string, log: string[]): PromiseLike<unknown> {
  return {
    then(onFulfilled: any) {
      log.push(label);
      return Promise.resolve(label).then(onFulfilled);
    },
  } as PromiseLike<unknown>;
}

describe("runAtomicWrites", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("batches every statement in one call on d1", async () => {
    vi.spyOn(client, "getDialect").mockReturnValue("d1" as any);
    const log: string[] = [];
    const batch = vi.fn(async () => []);
    const db = { batch, transaction: vi.fn() };

    await runAtomicWrites(db, (exec) => {
      expect(exec).toBe(db);
      return [query("a", log), query("b", log)];
    });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
    expect(db.transaction).not.toHaveBeenCalled();
    // Nothing may be awaited before batch() — awaiting sends the statement on
    // its own, outside the implicit transaction.
    expect(log).toEqual([]);
  });

  it("names the wiring when the d1 client cannot batch", async () => {
    vi.spyOn(client, "getDialect").mockReturnValue("d1" as any);
    const transaction = vi.fn();

    await expect(
      runAtomicWrites({ transaction }, () => [query("a", [])]),
    ).rejects.toThrow(/no batch\(\)/);
    // Falling through would fail on BEGIN and blame the wrong thing.
    expect(transaction).not.toHaveBeenCalled();
  });

  it("runs the statements in order inside one transaction elsewhere", async () => {
    vi.spyOn(client, "getDialect").mockReturnValue("sqlite" as any);
    const log: string[] = [];
    const tx = { marker: "tx" };
    const db = {
      batch: vi.fn(),
      transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    await runAtomicWrites(db, (exec) => {
      expect(exec).toBe(tx);
      return [query("a", log), query("b", log)];
    });

    expect(db.batch).not.toHaveBeenCalled();
    expect(log).toEqual(["a", "b"]);
  });

  it("rejects an empty plan rather than reporting a write that never happened", async () => {
    vi.spyOn(client, "getDialect").mockReturnValue("d1" as any);
    const batch = vi.fn(async () => []);

    await expect(runAtomicWrites({ batch }, () => [])).rejects.toThrow(
      /no statements/,
    );
    expect(batch).not.toHaveBeenCalled();
  });
});
