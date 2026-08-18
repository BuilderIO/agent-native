import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  isPostgres: vi.fn(() => false),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: dbMocks.execute }),
  intType: () => "INTEGER",
  isPostgres: dbMocks.isPostgres,
}));

const ddlMocks = vi.hoisted(() => ({
  ensureTableExists: vi.fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: ddlMocks.ensureTableExists,
}));

const grant = {
  nonce: "nonce-1",
  callerKey: "caller-key",
  actionName: "publish-draft",
  argumentsHash: "arguments-hash",
  expiresAt: 2_000_000_000_000,
};

describe("MCP action approval store", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMocks.execute.mockReset();
    dbMocks.execute.mockResolvedValue({ rows: [], rowsAffected: 1 });
    dbMocks.isPostgres.mockReset();
    dbMocks.isPostgres.mockReturnValue(false);
    ddlMocks.ensureTableExists.mockReset();
    ddlMocks.ensureTableExists.mockResolvedValue(undefined);
  });

  it("inserts a pending exact grant and keeps cleanup best-effort", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockRejectedValueOnce(new Error("cleanup unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createMcpApprovalGrant } = await import("./approval-store.js");

    await expect(createMcpApprovalGrant(grant)).resolves.toBeUndefined();
    expect(dbMocks.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining(
          "INSERT INTO mcp_action_approvals (nonce, caller_key, action_name, arguments_hash, expires_at, consumed_at)",
        ),
        args: [
          grant.nonce,
          grant.callerKey,
          grant.actionName,
          grant.argumentsHash,
          grant.expiresAt,
        ],
      }),
    );
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it.each([
    { rowsAffected: 1, expected: true },
    { rowsAffected: 0, expected: false },
  ])(
    "returns $expected when atomic consume affects $rowsAffected row(s)",
    async ({ rowsAffected, expected }) => {
      dbMocks.execute
        .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
        .mockResolvedValueOnce({ rows: [], rowsAffected });
      const { consumeMcpApprovalGrant } = await import("./approval-store.js");

      await expect(consumeMcpApprovalGrant(grant)).resolves.toBe(expected);
      expect(dbMocks.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sql: expect.stringMatching(
            /consumed_at IS NULL[\s\S]*expires_at >= \?/,
          ),
          args: [
            expect.any(Number),
            grant.nonce,
            grant.callerKey,
            grant.actionName,
            grant.argumentsHash,
            expect.any(Number),
          ],
        }),
      );
    },
  );

  it("retries table initialization after a failure", async () => {
    dbMocks.execute
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { createMcpApprovalGrant } = await import("./approval-store.js");

    await expect(createMcpApprovalGrant(grant)).rejects.toThrow(
      "database unavailable",
    );
    await expect(createMcpApprovalGrant(grant)).resolves.toBeUndefined();
    expect(
      dbMocks.execute.mock.calls.filter(
        ([statement]) =>
          typeof statement === "string" &&
          statement.includes("CREATE TABLE IF NOT EXISTS"),
      ),
    ).toHaveLength(2);
  });

  it("propagates grant insert failures", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockRejectedValueOnce(new Error("insert unavailable"));
    const { createMcpApprovalGrant } = await import("./approval-store.js");

    await expect(createMcpApprovalGrant(grant)).rejects.toThrow(
      "insert unavailable",
    );
    expect(dbMocks.execute).toHaveBeenCalledTimes(2);
  });

  it("propagates consume database failures instead of authorizing", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockRejectedValueOnce(new Error("consume unavailable"));
    const { consumeMcpApprovalGrant } = await import("./approval-store.js");

    await expect(consumeMcpApprovalGrant(grant)).rejects.toThrow(
      "consume unavailable",
    );
  });
});
