import { afterEach, describe, expect, it, vi } from "vitest";

describe("createPostgresScriptClient (postgres.js)", () => {
  afterEach(() => {
    vi.doUnmock("postgres");
    vi.resetModules();
  });

  function mockPostgresJs() {
    const txUnsafe = vi.fn(async () => []);
    const unsafe = vi.fn(async () => []);
    const begin = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ unsafe: txUnsafe }),
    );
    vi.doMock("postgres", () => ({
      default: () => ({ unsafe, begin, end: async () => {} }),
    }));
    return { unsafe, txUnsafe };
  }

  it("uses the extended protocol for single-statement queries, in and out of a transaction", async () => {
    const { unsafe, txUnsafe } = mockPostgresJs();
    const { createPostgresScriptClient } = await import("./postgres-client.js");
    const client = await createPostgresScriptClient(
      "postgres://db.invalid/app",
    );

    await client.unsafe("SELECT 1", undefined, { singleStatement: true });
    await client.begin(async (tx) => {
      await tx.unsafe("SELECT 2", [], { singleStatement: true });
      await tx.unsafe("SET TRANSACTION READ ONLY");
    });

    expect(unsafe).toHaveBeenCalledWith("SELECT 1", [], { simple: false });
    expect(txUnsafe).toHaveBeenNthCalledWith(1, "SELECT 2", [], {
      simple: false,
    });
    expect(txUnsafe).toHaveBeenNthCalledWith(
      2,
      "SET TRANSACTION READ ONLY",
      [],
      undefined,
    );
  });
});
