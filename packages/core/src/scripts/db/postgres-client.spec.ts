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

describe("withPostgresStatementDeadline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reduces statement_timeout as the transaction uses its budget", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125);
    const unsafe = vi.fn(async () => []);
    const { withPostgresStatementDeadline } =
      await import("./postgres-client.js");
    const client = withPostgresStatementDeadline({ unsafe }, 100);

    await client.unsafe("UPDATE notes SET title = 'first'");
    await client.unsafe("UPDATE notes SET title = 'second'");

    expect(unsafe).toHaveBeenNthCalledWith(
      1,
      "SET LOCAL statement_timeout = 90",
    );
    expect(unsafe).toHaveBeenNthCalledWith(
      2,
      "UPDATE notes SET title = 'first'",
      undefined,
      undefined,
    );
    expect(unsafe).toHaveBeenNthCalledWith(
      3,
      "SET LOCAL statement_timeout = 68",
    );
    expect(unsafe).toHaveBeenNthCalledWith(
      4,
      "UPDATE notes SET title = 'second'",
      undefined,
      undefined,
    );
  });

  it("rejects a statement after the transaction budget expires", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);
    const unsafe = vi.fn(async () => []);
    const { withPostgresStatementDeadline } =
      await import("./postgres-client.js");
    const client = withPostgresStatementDeadline({ unsafe }, 100);

    await expect(
      client.unsafe("UPDATE notes SET title = 'late'"),
    ).rejects.toThrow("Database transaction timed out after 100ms.");
    expect(unsafe).not.toHaveBeenCalled();
  });
});
