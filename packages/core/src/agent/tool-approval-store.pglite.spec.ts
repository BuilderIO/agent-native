import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import { createTestPglite } from "../a2a/test-pglite.js";
import { actionArgumentsHash } from "../action-arguments-identity.js";
import { defineAction } from "../action.js";
import { withExecutionFence } from "./execution-fence.js";
import type { ActionEntry } from "./production-agent.js";
import { executeAgentToolCall, toolCallCacheKey } from "./production-agent.js";

// Real PGlite behind getDbExec, so the revision matching runs as genuine SQL
// against tables built by the versioned migrations, legacy rows included.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => getExecutor(),
}));

function getExecutor() {
  return {
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (
        /^\s*(SELECT|WITH)\b/i.test(input.sql) ||
        /\bRETURNING\b/i.test(input.sql)
      ) {
        const rows = await pglite.prepare(input.sql).all(...args);
        return { rows, rowsAffected: rows.length };
      }
      const { changes } = await pglite.prepare(input.sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
    transaction: async <T>(
      run: (tx: ReturnType<typeof getExecutor>) => Promise<T>,
    ) => {
      await pglite.exec("BEGIN");
      try {
        const result = await run(getExecutor());
        await pglite.exec("COMMIT");
        return result;
      } catch (error) {
        await pglite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

// The versioned migrations below build the schema; the lazy ensures are the
// same DDL and would only race them.
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

const {
  AGENT_TOOL_APPROVAL_ARGUMENTS_HASH_COLUMN_SQL,
  AGENT_TOOL_APPROVAL_MIGRATIONS,
  AGENT_TOOL_APPROVAL_POLICY_REVISION_COLUMN_SQL,
  AGENT_TOOL_APPROVAL_REVISION_COLUMN_SQL,
} = await import("./tool-approval-migrations.js");
const {
  AgentToolApprovalNotFoundError,
  consumeAgentToolApproval,
  createAgentToolApproval,
  hashAgentToolApprovalKey,
  isAgentToolAlwaysAllowed,
  setAgentToolApprovalPolicy,
} = await import("./tool-approval-store.js");
const { claimTurnExecutionLease, ensureRunTables, insertRun, markTurnAborted } =
  await import("./run-store.js");

const scope = {
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  threadId: "thread-1",
  turnId: "turn-1",
};
const call = {
  ...scope,
  toolName: "editor-run-command",
  callId: "call-1",
  approvalKey: 'editor-run-command:{"command":"build"}',
};

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
  for (const migration of AGENT_TOOL_APPROVAL_MIGRATIONS) {
    await pglite.exec(migration.sql.postgres as string);
  }
  // Written before revisions existed.
  await pglite.query(
    `INSERT INTO agent_tool_approvals
      (id, owner_email, org_id, thread_id, turn_id, tool_name, call_id,
       approval_key_hash, status, expires_at, consumed_at, created_at, updated_at)
      VALUES ('legacy', ?, ?, ?, ?, 'legacy-tool', 'call-0', ?, 'pending', ?, NULL, 0, 0)`,
    [
      scope.ownerEmail,
      scope.orgId,
      scope.threadId,
      scope.turnId,
      hashAgentToolApprovalKey("legacy-tool:{}"),
      Date.now() + 60_000,
    ],
  );
  await pglite.query(
    `INSERT INTO agent_tool_approval_policies
      (id, owner_email, org_id, tool_name, enabled, created_at, updated_at)
      VALUES ('legacy-policy', ?, ?, 'legacy-tool', TRUE, 0, 0)`,
    [scope.ownerEmail, scope.orgId],
  );
  // The stores' "tool-revision" migrations.
  await pglite.exec(AGENT_TOOL_APPROVAL_REVISION_COLUMN_SQL);
  await pglite.exec(AGENT_TOOL_APPROVAL_POLICY_REVISION_COLUMN_SQL);
  // The store's "arguments-hash" migration.
  await pglite.exec(AGENT_TOOL_APPROVAL_ARGUMENTS_HASH_COLUMN_SQL);
});

afterAll(async () => {
  await pglite?.close();
});

beforeEach(async () => {
  await pglite.exec(
    `DELETE FROM agent_tool_approvals WHERE id <> 'legacy';
     DELETE FROM agent_tool_approval_policies WHERE id <> 'legacy-policy';`,
  );
});

describe("tool approvals bound to the arguments that run", () => {
  it("consumes a one-time approval only for the arguments it was granted for", async () => {
    await createAgentToolApproval({ ...call, argumentsHash: "args-1" });

    await expect(
      consumeAgentToolApproval({ ...call, argumentsHash: "args-2" }),
    ).resolves.toBe(false);
    await expect(consumeAgentToolApproval(call)).resolves.toBe(false);
    await expect(
      consumeAgentToolApproval({ ...call, argumentsHash: "args-1" }),
    ).resolves.toBe(true);
  });

  it("asks again for an approval written before calls bound their arguments", async () => {
    await pglite.query(
      `INSERT INTO agent_tool_approvals
        (id, owner_email, org_id, thread_id, turn_id, tool_name, call_id,
         approval_key_hash, status, expires_at, consumed_at, created_at, updated_at)
        VALUES ('unbound', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, 0, 0)`,
      [
        scope.ownerEmail,
        scope.orgId,
        scope.threadId,
        scope.turnId,
        call.toolName,
        call.callId,
        hashAgentToolApprovalKey(call.approvalKey),
        Date.now() + 60_000,
      ],
    );

    await expect(
      consumeAgentToolApproval({ ...call, argumentsHash: "args-1" }),
    ).resolves.toBe(false);
  });

  it("fences approval creation and consumption to the live worker generation", async () => {
    const threadId = "approval-fence-thread";
    const turnId = "approval-fence-turn";
    const runId = "approval-fence-run";
    await insertRun(runId, threadId, turnId);
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    const approval = {
      ...call,
      threadId,
      turnId,
      callId: "approval-fence-call",
      approvalKey: 'editor-run-command:{"command":"fenced"}',
    };
    await withExecutionFence(fence, () => createAgentToolApproval(approval));

    await pglite.query(
      `UPDATE agent_execution_leases
          SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
          WHERE thread_id = ? AND turn_id = ?`,
      [threadId, turnId],
    );
    const replacementRunId = "approval-fence-replacement-run";
    await insertRun(replacementRunId, threadId, turnId);
    const replacementFence = await claimTurnExecutionLease(
      threadId,
      turnId,
      replacementRunId,
    );
    expect(replacementFence.generation).not.toBe(fence.generation);

    await expect(
      withExecutionFence(fence, () => consumeAgentToolApproval(approval)),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });
    await expect(
      withExecutionFence(fence, () =>
        createAgentToolApproval({ ...approval, callId: "stale-create" }),
      ),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });
    const status = await pglite.query<{ status: string }>(
      `SELECT status FROM agent_tool_approvals WHERE call_id = ?`,
      [approval.callId],
    );
    expect(status.rows[0]?.status).toBe("pending");
    await expect(
      withExecutionFence(replacementFence, () =>
        consumeAgentToolApproval(approval),
      ),
    ).resolves.toBe(true);
    const consumed = await pglite.query<{ status: string }>(
      `SELECT status FROM agent_tool_approvals WHERE call_id = ?`,
      [approval.callId],
    );
    expect(consumed.rows[0]?.status).toBe("consumed");
  });
});

describe("tool approval and turn cancellation ordering", () => {
  const toolName = "publish-draft";
  const input = {};
  const approvalKey = toolCallCacheKey(toolName, input);

  async function createApprovedTurn(label: string) {
    const threadId = `approval-cancel-${label}-thread`;
    const turnId = `approval-cancel-${label}-turn`;
    const runId = `approval-cancel-${label}-run`;
    await insertRun(runId, threadId, turnId);
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    const approvalId = await withExecutionFence(fence, () =>
      createAgentToolApproval({
        ...scope,
        threadId,
        turnId,
        toolName,
        callId: `${label}-approved-call`,
        approvalKey,
        argumentsHash: actionArgumentsHash(input),
      }),
    );
    return { threadId, turnId, fence, approvalId };
  }

  async function attemptApprovedAction(
    threadId: string,
    turnId: string,
    fence: Awaited<ReturnType<typeof claimTurnExecutionLease>>,
    approvalId: string,
  ) {
    const run = vi.fn(async () => ({ ok: true }));
    const action = defineAction({
      description: "Publish the draft.",
      schema: z.object({}),
      needsApproval: true,
      run,
    }) as unknown as ActionEntry;
    const result = await withExecutionFence(fence, () =>
      executeAgentToolCall({
        actions: { [toolName]: action },
        name: toolName,
        input,
        callId: "resumed-call",
        ownerEmail: scope.ownerEmail,
        orgId: scope.orgId,
        threadId,
        turnId,
        approvedToolCalls: [approvalKey],
        approvedToolCallAskId: approvalId,
        consumeApproval: (binding) =>
          consumeAgentToolApproval({
            ownerEmail: scope.ownerEmail,
            orgId: scope.orgId,
            threadId,
            turnId,
            toolName: binding.toolName,
            toolRevision: binding.toolRevision,
            callId: binding.callId,
            approvalKey: binding.approvalKey,
            argumentsHash: binding.argumentsHash,
            approvalId: binding.approvalId,
          }),
      }),
    );
    return { result, run };
  }

  it("does not run an approved action when cancellation commits first", async () => {
    const turn = await createApprovedTurn("cancel-first");
    expect(await markTurnAborted(turn.threadId, turn.turnId)).toBe("aborted");

    const { result, run } = await attemptApprovedAction(
      turn.threadId,
      turn.turnId,
      turn.fence,
      turn.approvalId,
    );

    expect(result.status).toBe("failed");
    expect(run).not.toHaveBeenCalled();
    const approval = await pglite.query<{ status: string }>(
      "SELECT status FROM agent_tool_approvals WHERE id = ?",
      [turn.approvalId],
    );
    expect(approval.rows[0]?.status).toBe("pending");
  });

  it("runs an approved action before cancellation when consumption wins first", async () => {
    const turn = await createApprovedTurn("approval-first");

    const { result, run } = await attemptApprovedAction(
      turn.threadId,
      turn.turnId,
      turn.fence,
      turn.approvalId,
    );

    expect(result.status).toBe("completed");
    expect(run).toHaveBeenCalledOnce();
    const approval = await pglite.query<{ status: string }>(
      "SELECT status FROM agent_tool_approvals WHERE id = ?",
      [turn.approvalId],
    );
    expect(approval.rows[0]?.status).toBe("consumed");
    expect(await markTurnAborted(turn.threadId, turn.turnId)).toBe("aborted");
  });
});

describe("tool approvals bound to a revision", () => {
  it("keeps rows written before the migration valid for tools without a revision", async () => {
    await expect(
      isAgentToolAlwaysAllowed({ ...scope, toolName: "legacy-tool" }),
    ).resolves.toBe(true);
    await expect(
      isAgentToolAlwaysAllowed({
        ...scope,
        toolName: "legacy-tool",
        toolRevision: "r1",
      }),
    ).resolves.toBe(false);
    await expect(
      consumeAgentToolApproval({
        ...scope,
        toolName: "legacy-tool",
        callId: "call-0",
        approvalKey: "legacy-tool:{}",
      }),
    ).resolves.toBe(true);
  });

  it("consumes a one-time approval only for the revision it was granted for", async () => {
    await createAgentToolApproval({ ...call, toolRevision: "r1" });

    await expect(
      consumeAgentToolApproval({ ...call, toolRevision: "r2" }),
    ).resolves.toBe(false);
    await expect(
      consumeAgentToolApproval({ ...call, toolRevision: null }),
    ).resolves.toBe(false);
    await expect(
      consumeAgentToolApproval({ ...call, toolRevision: "r1" }),
    ).resolves.toBe(true);
  });

  const allowed = (toolRevision?: string) =>
    isAgentToolAlwaysAllowed({
      ...scope,
      toolName: call.toolName,
      toolRevision,
    });
  const alwaysAllow = (approvalId?: string, enabled = true) =>
    setAgentToolApprovalPolicy({
      binding: { ...scope, toolName: call.toolName },
      enabled,
      ...(approvalId ? { approvalId } : {}),
    });

  it("binds always-allow to the revision of the approval the user clicked", async () => {
    const clicked = await createAgentToolApproval({
      ...call,
      toolRevision: "r1",
    });
    await alwaysAllow(clicked);

    await expect(allowed("r1")).resolves.toBe(true);
    await expect(allowed("r2")).resolves.toBe(false);
    await expect(allowed()).resolves.toBe(false);
  });

  it("finds the clicked approval when the request email had capitals", async () => {
    const clicked = await createAgentToolApproval({
      ...call,
      ownerEmail: "Owner@Example.com",
      toolRevision: "r1",
    });
    await alwaysAllow(clicked);

    await expect(allowed("r1")).resolves.toBe(true);
  });

  it("is not captured by another approval for the same tool", async () => {
    const clicked = await createAgentToolApproval({
      ...call,
      toolRevision: "r1",
    });
    await createAgentToolApproval({
      ...call,
      threadId: "thread-2",
      callId: "call-2",
      toolRevision: "r2",
    });
    await alwaysAllow(clicked);
    await consumeAgentToolApproval({
      ...call,
      threadId: "thread-2",
      callId: "call-2",
      toolRevision: "r2",
    });

    await expect(allowed("r1")).resolves.toBe(true);
    await expect(allowed("r2")).resolves.toBe(false);
  });

  it("does not cover a tool that dropped its revision since the clicked card", async () => {
    const clicked = await createAgentToolApproval({
      ...call,
      toolRevision: "r1",
    });
    await alwaysAllow(clicked);

    await expect(allowed()).resolves.toBe(false);
  });

  it("covers only a revision-less tool when no approval is named", async () => {
    await alwaysAllow();

    await expect(allowed()).resolves.toBe(true);
    await expect(allowed("r1")).resolves.toBe(false);
  });

  it("moves always-allow to the revision of a later click", async () => {
    await alwaysAllow(
      await createAgentToolApproval({ ...call, toolRevision: "r1" }),
    );
    await alwaysAllow(
      await createAgentToolApproval({
        ...call,
        callId: "call-2",
        toolRevision: "r2",
      }),
    );

    await expect(allowed("r2")).resolves.toBe(true);
    await expect(allowed("r1")).resolves.toBe(false);
  });

  it("refuses an approval that belongs to someone else or another tool", async () => {
    const otherOwner = await createAgentToolApproval({
      ...call,
      ownerEmail: "other@example.com",
      toolRevision: "r1",
    });
    const otherTool = await createAgentToolApproval({
      ...call,
      toolName: "other-tool",
      toolRevision: "r1",
    });

    await expect(alwaysAllow(otherOwner)).rejects.toThrow(
      AgentToolApprovalNotFoundError,
    );
    await expect(alwaysAllow(otherTool)).rejects.toThrow(
      AgentToolApprovalNotFoundError,
    );
    await expect(allowed("r1")).resolves.toBe(false);
  });

  it("disables a grant", async () => {
    await alwaysAllow(
      await createAgentToolApproval({ ...call, toolRevision: "r1" }),
    );
    await alwaysAllow(undefined, false);

    await expect(allowed("r1")).resolves.toBe(false);
    await expect(allowed()).resolves.toBe(false);
  });
});
