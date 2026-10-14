import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

// Real PGlite behind getDbExec, so the revision matching runs as genuine SQL
// against tables built by the versioned migrations, legacy rows included.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (/^\s*(SELECT|WITH)\b/i.test(input.sql)) {
        const rows = await pglite.prepare(input.sql).all(...args);
        return { rows, rowsAffected: 0 };
      }
      const { changes } = await pglite.prepare(input.sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
  }),
}));

// The versioned migrations below build the schema; the lazy ensures are the
// same DDL and would only race them.
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

const { AGENT_TOOL_APPROVAL_MIGRATIONS } =
  await import("./tool-approval-migrations.js");
const {
  consumeAgentToolApproval,
  createAgentToolApproval,
  hashAgentToolApprovalKey,
  isAgentToolAlwaysAllowed,
  listPendingAgentToolApprovalToolNames,
  setAgentToolApprovalPolicy,
} = await import("./tool-approval-store.js");

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
  for (const migration of AGENT_TOOL_APPROVAL_MIGRATIONS) {
    if (migration.version === 5) continue;
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
  const v5 = AGENT_TOOL_APPROVAL_MIGRATIONS.find((m) => m.version === 5)!;
  await pglite.exec(v5.sql.postgres as string);
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

  it("binds always-allow to the revision of the caller's pending approval", async () => {
    await createAgentToolApproval({ ...call, toolRevision: "r1" });
    await setAgentToolApprovalPolicy({
      binding: { ...scope, toolName: call.toolName },
      enabled: true,
    });

    await expect(
      isAgentToolAlwaysAllowed({
        ...scope,
        toolName: call.toolName,
        toolRevision: "r1",
      }),
    ).resolves.toBe(true);
    await expect(
      isAgentToolAlwaysAllowed({
        ...scope,
        toolName: call.toolName,
        toolRevision: "r2",
      }),
    ).resolves.toBe(false);
  });

  it("moves always-allow to the new revision when the user allows it again", async () => {
    await createAgentToolApproval({ ...call, toolRevision: "r1" });
    await setAgentToolApprovalPolicy({
      binding: { ...scope, toolName: call.toolName },
      enabled: true,
    });
    await consumeAgentToolApproval({ ...call, toolRevision: "r1" });
    await createAgentToolApproval({
      ...call,
      callId: "call-2",
      toolRevision: "r2",
    });
    await setAgentToolApprovalPolicy({
      binding: { ...scope, toolName: call.toolName },
      enabled: true,
    });

    await expect(
      isAgentToolAlwaysAllowed({
        ...scope,
        toolName: call.toolName,
        toolRevision: "r2",
      }),
    ).resolves.toBe(true);
    await expect(
      isAgentToolAlwaysAllowed({
        ...scope,
        toolName: call.toolName,
        toolRevision: "r1",
      }),
    ).resolves.toBe(false);
  });

  it("covers only a revision-less tool when no approval is pending", async () => {
    await setAgentToolApprovalPolicy({
      binding: { ...scope, toolName: call.toolName },
      enabled: true,
    });

    await expect(
      isAgentToolAlwaysAllowed({ ...scope, toolName: call.toolName }),
    ).resolves.toBe(true);
    await expect(
      isAgentToolAlwaysAllowed({
        ...scope,
        toolName: call.toolName,
        toolRevision: "r1",
      }),
    ).resolves.toBe(false);
  });

  it("refuses always-allow while another thread waits on a different revision", async () => {
    await createAgentToolApproval({ ...call, toolRevision: "r1" });
    await createAgentToolApproval({
      ...call,
      threadId: "thread-2",
      callId: "call-2",
      toolRevision: "r2",
    });

    await expect(
      setAgentToolApprovalPolicy({
        binding: { ...scope, toolName: call.toolName },
        enabled: true,
      }),
    ).rejects.toThrow("different versions");
    await expect(
      isAgentToolAlwaysAllowed({
        ...scope,
        toolName: call.toolName,
        toolRevision: "r2",
      }),
    ).resolves.toBe(false);
  });

  it("counts an expired card's revision, not only the newest live one", async () => {
    await createAgentToolApproval({
      ...call,
      toolRevision: "r1",
      expiresAt: Date.now() - 1_000,
    });
    await createAgentToolApproval({
      ...call,
      threadId: "thread-2",
      callId: "call-2",
      toolRevision: "r2",
    });

    await expect(
      setAgentToolApprovalPolicy({
        binding: { ...scope, toolName: call.toolName },
        enabled: true,
      }),
    ).rejects.toThrow("different versions");
  });

  it("still disables a grant while revisions are ambiguous", async () => {
    await createAgentToolApproval({ ...call, toolRevision: "r1" });
    await createAgentToolApproval({
      ...call,
      threadId: "thread-2",
      callId: "call-2",
      toolRevision: "r2",
    });

    await expect(
      setAgentToolApprovalPolicy({
        binding: { ...scope, toolName: call.toolName },
        enabled: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("names the tools of pending approvals in the thread that match approved keys", async () => {
    await createAgentToolApproval({ ...call, toolRevision: "r1" });
    await createAgentToolApproval({
      ...call,
      threadId: "thread-2",
      toolName: "other-tool",
      callId: "call-2",
      approvalKey: "other-tool:{}",
    });

    await expect(
      listPendingAgentToolApprovalToolNames({
        ...scope,
        approvalKeys: [call.approvalKey, "other-tool:{}"],
      }),
    ).resolves.toEqual([call.toolName]);
  });
});
