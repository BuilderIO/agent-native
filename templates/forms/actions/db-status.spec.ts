import { describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const getRuntimeDatabaseUrl = vi.hoisted(() => vi.fn());
const isLocalDatabase = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
  getRuntimeDatabaseUrl,
  isLocalDatabase,
}));

const { default: dbStatus } = await import("./db-status.js");

describe("db-status action", () => {
  it("uses the shared executor for a remote PostgreSQL database", async () => {
    getRuntimeDatabaseUrl.mockReturnValue(
      "postgres://user:password@db.example/forms",
    );
    isLocalDatabase.mockReturnValue(false);
    execute.mockResolvedValue({ rows: [{ ok: 1 }], rowsAffected: 0 });

    await expect(dbStatus.run({})).resolves.toEqual({
      url: "postgres://***@db.example/forms",
      mode: "remote (cloud)",
      status: "connected",
    });
    expect(execute).toHaveBeenCalledWith("SELECT 1 as ok");
  });
});
