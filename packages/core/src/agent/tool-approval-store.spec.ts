import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  isPostgres: vi.fn(() => false),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: dbMocks.execute }),
  intType: () => "INTEGER",
  isPostgres: dbMocks.isPostgres,
  retryOnDdlRace: async (fn: () => Promise<unknown>) => fn(),
}));

const ddlMocks = vi.hoisted(() => ({
  ensureIndexExists: vi.fn(),
  ensureTableExists: vi.fn(),
}));

vi.mock("../db/ddl-guard.js", () => ddlMocks);

const binding = {
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  threadId: "thread-1",
  turnId: "turn-1",
  toolName: "send-email",
  callId: "call-1",
  approvalKey: 'send-email:{"to":"recipient@example.com"}',
};

describe("agent tool approval store", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMocks.execute.mockReset();
    dbMocks.execute.mockResolvedValue({ rows: [], rowsAffected: 1 });
    dbMocks.isPostgres.mockReset();
    dbMocks.isPostgres.mockReturnValue(false);
    ddlMocks.ensureIndexExists.mockReset();
    ddlMocks.ensureIndexExists.mockResolvedValue(undefined);
    ddlMocks.ensureTableExists.mockReset();
    ddlMocks.ensureTableExists.mockResolvedValue(undefined);
  });

  it("stores only a hash of the client-visible approval key", async () => {
    const { createAgentToolApproval, hashAgentToolApprovalKey } =
      await import("./tool-approval-store.js");

    await createAgentToolApproval(binding);

    expect(dbMocks.execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO agent_tool_approvals"),
        args: expect.arrayContaining([
          hashAgentToolApprovalKey(binding.approvalKey),
        ]),
      }),
    );
    expect(dbMocks.execute.mock.calls[2]?.[0].args).not.toContain(
      binding.approvalKey,
    );
  });

  it.each([
    { rowsAffected: 1, expected: true },
    { rowsAffected: 0, expected: false },
  ])(
    "returns $expected when the atomic consume affects $rowsAffected row(s)",
    async ({ rowsAffected, expected }) => {
      dbMocks.execute
        .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [], rowsAffected });
      const { consumeAgentToolApproval } =
        await import("./tool-approval-store.js");

      await expect(consumeAgentToolApproval(binding)).resolves.toBe(expected);
      expect(dbMocks.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sql: expect.stringMatching(
            /status = 'pending'[\s\S]*expires_at > \?/,
          ),
          args: expect.arrayContaining([
            binding.ownerEmail,
            binding.toolName,
            binding.callId,
            expect.any(String),
          ]),
        }),
      );
    },
  );

  it("propagates database failures instead of authorizing", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockRejectedValueOnce(new Error("consume unavailable"));
    const { consumeAgentToolApproval } =
      await import("./tool-approval-store.js");

    await expect(consumeAgentToolApproval(binding)).rejects.toThrow(
      "consume unavailable",
    );
  });
});
