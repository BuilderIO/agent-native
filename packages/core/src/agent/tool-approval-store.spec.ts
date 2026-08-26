import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  atomicBatch: vi.fn(),
  getDialect: vi.fn(() => "sqlite"),
  isPostgres: vi.fn(() => false),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: dbMocks.execute,
    transaction: dbMocks.transaction,
    atomicBatch: dbMocks.atomicBatch,
  }),
  getDialect: dbMocks.getDialect,
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

function queueApprovalTableReady() {
  for (let index = 0; index < 4; index += 1) {
    dbMocks.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
  }
}

describe("agent tool approval store", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMocks.execute.mockReset();
    dbMocks.execute.mockResolvedValue({ rows: [], rowsAffected: 1 });
    dbMocks.transaction.mockReset();
    dbMocks.transaction.mockImplementation(async (fn) =>
      fn({ execute: dbMocks.execute }),
    );
    dbMocks.atomicBatch.mockReset();
    dbMocks.atomicBatch.mockResolvedValue([]);
    dbMocks.isPostgres.mockReset();
    dbMocks.isPostgres.mockReturnValue(false);
    dbMocks.getDialect.mockReset();
    dbMocks.getDialect.mockReturnValue("sqlite");
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
      5,
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO agent_tool_approvals"),
        args: expect.arrayContaining([
          hashAgentToolApprovalKey(binding.approvalKey),
        ]),
      }),
    );
    expect(dbMocks.execute.mock.calls[4]?.[0].args).not.toContain(
      binding.approvalKey,
    );
    expect(dbMocks.execute).toHaveBeenCalledTimes(5);
  });

  it("gives a delayed approval click at least 30 minutes before the grant expires", async () => {
    // Regression for a user who steps away mid-approval (e.g. updating their
    // client) and comes back to a click that silently does nothing because
    // the durable grant already expired. 15 minutes was not enough room.
    const { createAgentToolApproval } =
      await import("./tool-approval-store.js");

    const before = Date.now();
    await createAgentToolApproval(binding);
    const after = Date.now();

    const insertArgs = dbMocks.execute.mock.calls[4]?.[0].args as unknown[];
    const expiresAt = insertArgs[8] as number;
    expect(expiresAt - after).toBeGreaterThanOrEqual(30 * 60_000);
    expect(expiresAt - before).toBeLessThanOrEqual(60 * 60_000 + 1_000);
  });

  it("recovers only a live pending turn", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
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
    expect(dbMocks.execute.mock.calls[4]?.[0].sql).not.toContain(
      "status = 'denied'",
    );
  });

  it("does not guess between pending approvals from different turns", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
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

  it("recovers the original turn from the exact ask after Deny wins", async () => {
    queueApprovalTableReady();
    dbMocks.execute.mockResolvedValueOnce({
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
        approvalId: "ask-1",
        approvalKeys: [binding.approvalKey],
      }),
    ).resolves.toBe("turn-1");
    expect(dbMocks.execute.mock.calls[4]?.[0]).toMatchObject({
      sql: expect.stringContaining("id = ?"),
      args: expect.arrayContaining(["ask-1"]),
    });
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
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [], rowsAffected });
      const { consumeAgentToolApproval } =
        await import("./tool-approval-store.js");

      await expect(consumeAgentToolApproval(binding)).resolves.toBe(expected);
      expect(dbMocks.execute).toHaveBeenNthCalledWith(
        5,
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
      const consumeQuery = dbMocks.execute.mock.calls[4]?.[0] as {
        sql: string;
        args: unknown[];
      };
      expect(consumeQuery.sql).toContain("turn_id");
      expect(consumeQuery.sql).not.toContain("call_id = ?");
      expect(consumeQuery.args).toContain(binding.turnId);
      expect(consumeQuery.args).not.toContain(binding.callId);
    },
  );

  it("returns denied instead of authorizing or re-asking a rejected logical call", async () => {
    queueApprovalTableReady();
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [{ status: "denied" }],
        rowsAffected: 0,
      });
    const { consumeAgentToolApproval } =
      await import("./tool-approval-store.js");

    await expect(consumeAgentToolApproval(binding)).resolves.toBe("denied");
    const consumeQuery = dbMocks.execute.mock.calls[4]?.[0] as {
      sql: string;
    };
    expect(consumeQuery.sql).toContain(
      "FROM agent_tool_approvals AS candidate",
    );
    expect(consumeQuery.sql).toMatch(/NOT EXISTS[\s\S]*status = 'denied'/);
  });

  it("binds consumption to the exact approval and treats replay as terminal", async () => {
    const { consumeAgentToolApproval, hashAgentToolApprovalKey } =
      await import("./tool-approval-store.js");
    queueApprovalTableReady();
    dbMocks.execute.mockResolvedValueOnce({
      rows: [
        {
          turn_id: binding.turnId,
          tool_name: binding.toolName,
          approval_key_hash: hashAgentToolApprovalKey(binding.approvalKey),
          status: "consumed",
          expires_at: Date.now() + 60_000,
        },
      ],
      rowsAffected: 0,
    });
    await expect(
      consumeAgentToolApproval({ ...binding, approvalId: "ask-1" }),
    ).resolves.toBe("consumed");
    const consume = dbMocks.execute.mock.calls[4]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(consume.sql).toContain("id = ?");
    expect(consume.args).toContain("ask-1");
  });

  it("atomically refuses Always Allow after Deny wins", async () => {
    queueApprovalTableReady();
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [{ status: "denied" }], rowsAffected: 0 });
    const { alwaysAllowAgentToolApproval } =
      await import("./tool-approval-store.js");

    await expect(
      alwaysAllowAgentToolApproval({
        approval: {
          approvalId: "ask-1",
          ownerEmail: binding.ownerEmail,
          orgId: binding.orgId,
          threadId: binding.threadId,
        },
        policy: {
          ownerEmail: "editor@example.com",
          orgId: binding.orgId,
          toolName: binding.toolName,
        },
      }),
    ).resolves.toBe("denied");
    expect(dbMocks.transaction).toHaveBeenCalledOnce();
    expect(
      dbMocks.execute.mock.calls.some(([statement]) =>
        String(statement.sql).includes(
          "INSERT INTO agent_tool_approval_policies",
        ),
      ),
    ).toBe(false);
  });

  it("persists Always Allow when another tab approved the exact ask first", async () => {
    queueApprovalTableReady();
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            turn_id: binding.turnId,
            tool_name: binding.toolName,
            approval_key_hash: "approval-hash",
            status: "approved",
            expires_at: Date.now() + 60_000,
          },
        ],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
    const { alwaysAllowAgentToolApproval } =
      await import("./tool-approval-store.js");

    await expect(
      alwaysAllowAgentToolApproval({
        approval: {
          approvalId: "ask-1",
          ownerEmail: binding.ownerEmail,
          orgId: binding.orgId,
          threadId: binding.threadId,
        },
        policy: {
          ownerEmail: binding.ownerEmail,
          orgId: binding.orgId,
          toolName: binding.toolName,
        },
      }),
    ).resolves.toBe("approved");
    expect(
      dbMocks.execute.mock.calls.some(([statement]) =>
        String(statement.sql).includes(
          "INSERT INTO agent_tool_approval_policies",
        ),
      ),
    ).toBe(true);
  });

  it("uses one conditional atomic batch for Always Allow on D1", async () => {
    dbMocks.getDialect.mockReturnValue("d1");
    queueApprovalTableReady();
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            status: "always_allowed",
            expires_at: Date.now() + 60_000,
          },
        ],
        rowsAffected: 0,
      });
    const { alwaysAllowAgentToolApproval } =
      await import("./tool-approval-store.js");

    await expect(
      alwaysAllowAgentToolApproval({
        approval: {
          approvalId: "ask-1",
          ownerEmail: binding.ownerEmail,
          orgId: binding.orgId,
          threadId: binding.threadId,
        },
        policy: {
          ownerEmail: binding.ownerEmail,
          orgId: binding.orgId,
          toolName: binding.toolName,
        },
      }),
    ).resolves.toBe("approved");
    expect(dbMocks.transaction).not.toHaveBeenCalled();
    expect(dbMocks.atomicBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        sql: expect.stringContaining("status = 'always_allowed'"),
      }),
      expect.objectContaining({
        sql: expect.stringMatching(
          /INSERT INTO agent_tool_approval_policies[\s\S]*WHERE EXISTS[\s\S]*status IN \('approved', 'always_allowed', 'consumed'\)/,
        ),
      }),
    ]);
  });

  it("denies one durable ask idempotently without touching matching parallel approvals", async () => {
    queueApprovalTableReady();
    const logical = {
      turn_id: binding.turnId,
      tool_name: binding.toolName,
      approval_key_hash: "approval-hash",
    };
    dbMocks.execute
      .mockResolvedValueOnce({
        rows: [{ ...logical, status: "pending" }],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({
        rows: [{ status: "denied" }],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({
        rows: [{ ...logical, status: "denied" }],
        rowsAffected: 0,
      });
    const { denyAgentToolApproval } = await import("./tool-approval-store.js");

    await expect(
      denyAgentToolApproval({
        approvalId: "ask-1",
        ownerEmail: binding.ownerEmail,
        orgId: binding.orgId,
        threadId: binding.threadId,
      }),
    ).resolves.toBe("denied");
    await expect(
      denyAgentToolApproval({
        approvalId: "ask-1",
        ownerEmail: binding.ownerEmail,
        orgId: binding.orgId,
        threadId: binding.threadId,
      }),
    ).resolves.toBe("denied");

    const denyQuery = dbMocks.execute.mock.calls[5]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(denyQuery.sql).toMatch(/SET status = 'denied'/);
    expect(denyQuery.sql).toMatch(
      /approval_key_hash = \?[\s\S]*status = 'pending'/,
    );
    expect(denyQuery.sql).toMatch(/WHERE id = \?/);
    expect(denyQuery.args).toContain("ask-1");
    expect(denyQuery.args).toContain("approval-hash");
  });

  it("returns terminal resolutions used to rehydrate approval cards after reload", async () => {
    queueApprovalTableReady();
    dbMocks.execute.mockResolvedValueOnce({
      rows: [
        { id: "ask-approved", status: "consumed" },
        { id: "ask-denied", status: "denied" },
        {
          id: "ask-inflight",
          status: "approved",
          expires_at: Date.now() + 60_000,
        },
      ],
      rowsAffected: 0,
    });
    const { listAgentToolApprovalResolutions } =
      await import("./tool-approval-store.js");

    await expect(
      listAgentToolApprovalResolutions({
        ownerEmail: binding.ownerEmail,
        orgId: binding.orgId,
        threadId: binding.threadId,
      }),
    ).resolves.toEqual({
      "ask-approved": "approved",
      "ask-denied": "denied",
    });
  });

  it.each([
    {
      orgId: "org-1",
      orgPredicate: "org_id = ?",
      expectedArgs: ["owner@example.com", "org-1", "thread-1"],
    },
    {
      orgId: null,
      orgPredicate: "org_id IS NULL",
      expectedArgs: ["owner@example.com", "thread-1"],
    },
  ])(
    "uses the full owner/org/thread index prefix when orgId is $orgId",
    async ({ orgId, orgPredicate, expectedArgs }) => {
      queueApprovalTableReady();
      const { listAgentToolApprovalResolutions } =
        await import("./tool-approval-store.js");

      await listAgentToolApprovalResolutions({
        ownerEmail: binding.ownerEmail,
        orgId,
        threadId: binding.threadId,
      });

      const query = dbMocks.execute.mock.calls[4]?.[0] as {
        sql: string;
        args: unknown[];
      };
      expect(query.sql).toContain(orgPredicate);
      expect(query.sql).not.toContain("CAST(");
      expect(query.sql).not.toContain(" OR org_id");
      expect(query.args).toEqual(expectedArgs);
    },
  );

  it("propagates database failures instead of authorizing", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockRejectedValueOnce(new Error("consume unavailable"));
    const { consumeAgentToolApproval } =
      await import("./tool-approval-store.js");

    await expect(consumeAgentToolApproval(binding)).rejects.toThrow(
      "consume unavailable",
    );
  });

  it("stores and reads an action-type policy in the owner/org scope", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [{ allowed: 1 }], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
    const { isAgentToolAlwaysAllowed, setAgentToolApprovalPolicy } =
      await import("./tool-approval-store.js");

    await setAgentToolApprovalPolicy({
      binding: {
        ownerEmail: "Owner@Example.com",
        orgId: binding.orgId,
        toolName: binding.toolName,
      },
      enabled: true,
    });
    await expect(
      isAgentToolAlwaysAllowed({
        ownerEmail: binding.ownerEmail,
        orgId: binding.orgId,
        toolName: binding.toolName,
      }),
    ).resolves.toBe(true);
    await expect(
      isAgentToolAlwaysAllowed({
        ownerEmail: binding.ownerEmail,
        orgId: binding.orgId,
        toolName: "delete-resource",
      }),
    ).resolves.toBe(false);

    const policyRead = dbMocks.execute.mock.calls[3]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(policyRead.sql).toContain("agent_tool_approval_policies");
    expect(policyRead.args).toEqual([
      binding.ownerEmail,
      binding.orgId,
      binding.orgId,
      binding.toolName,
    ]);
  });

  it("fails closed when the policy store cannot be read", async () => {
    dbMocks.execute
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
      .mockRejectedValueOnce(new Error("policy unavailable"));
    const { isAgentToolAlwaysAllowed } =
      await import("./tool-approval-store.js");

    await expect(isAgentToolAlwaysAllowed(binding)).rejects.toThrow(
      "policy unavailable",
    );
  });
});
