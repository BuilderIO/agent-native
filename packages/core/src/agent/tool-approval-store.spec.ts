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
      4,
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO agent_tool_approvals"),
        args: expect.arrayContaining([
          hashAgentToolApprovalKey(binding.approvalKey),
        ]),
      }),
    );
    expect(dbMocks.execute.mock.calls[3]?.[0].args).not.toContain(
      binding.approvalKey,
    );
  });

  it("recovers a unique pending turn when a continuation omits its turn id", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [{ turn_id: "turn-1" }],
        rowsAffected: 0,
      });
    const { resolveAgentToolApprovalTurnId } =
      await import("./tool-approval-store.js");

    await expect(
      resolveAgentToolApprovalTurnId({
        ownerEmail: binding.ownerEmail,
        orgId: binding.orgId,
        threadId: binding.threadId,
        requestedTurnId: "turn-replayed",
        approvalKeys: [binding.approvalKey],
      }),
    ).resolves.toBe("turn-1");
  });

  it("does not guess between pending approvals from different turns", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [{ turn_id: "turn-1" }, { turn_id: "turn-2" }],
        rowsAffected: 0,
      });
    const { resolveAgentToolApprovalTurnId } =
      await import("./tool-approval-store.js");

    await expect(
      resolveAgentToolApprovalTurnId({
        ownerEmail: binding.ownerEmail,
        orgId: binding.orgId,
        threadId: binding.threadId,
        approvalKeys: [binding.approvalKey],
      }),
    ).resolves.toBeNull();
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
            expect.any(String),
          ]),
        }),
      );
      const consumeQuery = dbMocks.execute.mock.calls.at(-1)?.[0] as {
        sql: string;
        args: unknown[];
      };
      expect(consumeQuery.sql).toContain("turn_id");
      expect(consumeQuery.sql).not.toContain("call_id = ?");
      expect(consumeQuery.args).toContain(binding.turnId);
      expect(consumeQuery.args).not.toContain(binding.callId);
    },
  );

  it("propagates database failures instead of authorizing", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockRejectedValueOnce(new Error("consume unavailable"));
    const { consumeAgentToolApproval } =
      await import("./tool-approval-store.js");

    await expect(consumeAgentToolApproval(binding)).rejects.toThrow(
      "consume unavailable",
    );
  });
});
