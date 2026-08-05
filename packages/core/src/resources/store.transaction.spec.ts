import { beforeEach, describe, expect, it, vi } from "vitest";

const emitResourceChange = vi.hoisted(() => vi.fn());
const emitResourceDelete = vi.hoisted(() => vi.fn());

vi.mock("./emitter.js", () => ({
  emitResourceChange,
  emitResourceDelete,
}));

vi.mock("../db/client.js", () => ({
  getDbExec: vi.fn(),
  isPostgres: () => false,
  intType: () => "INTEGER",
  retryOnDdlRace: (run: () => unknown) => run(),
}));

const { resourceDeleteWithDb, resourcePutWithDb } = await import("./store.js");

beforeEach(() => vi.clearAllMocks());

describe("transaction-scoped resource writes", () => {
  it("preserves the resource id and defers change notification", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "resource-1",
            created_at: 10,
            created_by: "user",
            visibility: "workspace",
            thread_id: null,
            run_id: null,
            expires_at: null,
            metadata: null,
          },
        ],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const write = await resourcePutWithDb(
      { execute },
      "owner@example.com",
      "jobs/example.md",
      "updated",
    );

    expect(write.value.id).toBe("resource-1");
    expect(emitResourceChange).not.toHaveBeenCalled();
    write.notifyAfterCommit();
    expect(emitResourceChange).toHaveBeenCalledWith(
      "resource-1",
      "jobs/example.md",
      "owner@example.com",
      undefined,
    );
  });

  it("defers delete notification and leaves rollback paths silent", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ path: "jobs/example.md", owner: "owner@example.com" }],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const write = await resourceDeleteWithDb({ execute }, "resource-1");

    expect(write.value).toBe(true);
    expect(emitResourceDelete).not.toHaveBeenCalled();
    // A transaction owner that rolls back deliberately does not invoke the
    // returned post-commit notification.
  });
});
