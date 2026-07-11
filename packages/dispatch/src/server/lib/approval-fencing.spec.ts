import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ownerEmail = "owner+approval-fencing@example.test";
const orgId = "org_approval_fencing";

const originalEnv = {
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
  DISPATCH_DATABASE_URL: process.env.DISPATCH_DATABASE_URL,
  DISPATCH_DATABASE_AUTH_TOKEN: process.env.DISPATCH_DATABASE_AUTH_TOKEN,
};

let tempDir: string | null = null;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dispatch-approval-fencing-"),
  );
  process.env.DATABASE_URL = `file:${path.join(tempDir, "app.db")}`;
  delete process.env.APP_NAME;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.DISPATCH_DATABASE_URL;
  delete process.env.DISPATCH_DATABASE_AUTH_TOKEN;
  vi.resetModules();

  const [{ runMigrations }, { dispatchMigrations }] = await Promise.all([
    import("@agent-native/core/db"),
    import("../../db/migrations.js"),
  ]);
  await runMigrations(dispatchMigrations, {
    table: "dispatch_migrations",
  })({});
});

afterEach(async () => {
  try {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
  } catch {}
  restoreEnv();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("dispatch approval request status fencing", () => {
  it("applies the change once when approveRequest is called twice on the same request", async () => {
    const [{ runWithRequestContext }, { getDbExec }, dispatchStore] =
      await Promise.all([
        import("@agent-native/core/server"),
        import("@agent-native/core/db"),
        import("./dispatch-store.js"),
      ]);
    const exec = getDbExec();

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const created = await dispatchStore.createApprovalRequest({
        changeType: "approval-policy.update",
        targetType: "dispatch-settings",
        targetId: "dispatch-approval-policy",
        summary: "Enable approval policy",
        payload: { enabled: true, approverEmails: ["reviewer@example.test"] },
      });
      const requestId = (created as any).id;

      const first = await dispatchStore.approveRequest(requestId);
      expect(first.status).toBe("approved");
      expect(first.reviewedBy).toBe(ownerEmail);
      expect(first.reviewedAt).toBeTruthy();

      expect(await dispatchStore.getApprovalPolicy()).toEqual({
        enabled: true,
        approverEmails: ["reviewer@example.test"],
      });

      const approvedAuditCount = async () => {
        const rows = await exec.execute({
          sql: "SELECT COUNT(*) as count FROM dispatch_audit_events WHERE action = 'approval.approved' AND target_id = ?",
          args: [requestId],
        });
        return Number((rows.rows[0] as any).count);
      };
      expect(await approvedAuditCount()).toBe(1);

      // A concurrent second approve landing after the first already won the
      // race must find the row no longer 'pending': the fenced UPDATE
      // affects zero rows, so it must not re-apply the change.
      const second = await dispatchStore.approveRequest(requestId);
      expect(second.status).toBe("approved");
      expect(second.reviewedAt).toBe(first.reviewedAt);
      expect(await approvedAuditCount()).toBe(1);
    });
  });

  it("rejects the change once when rejectRequest is called twice on the same request", async () => {
    const [{ runWithRequestContext }, { getDbExec }, dispatchStore] =
      await Promise.all([
        import("@agent-native/core/server"),
        import("@agent-native/core/db"),
        import("./dispatch-store.js"),
      ]);
    const exec = getDbExec();

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const created = await dispatchStore.createApprovalRequest({
        changeType: "approval-policy.update",
        targetType: "dispatch-settings",
        targetId: "dispatch-approval-policy",
        summary: "Disable approval policy",
        payload: { enabled: false, approverEmails: [] },
      });
      const requestId = (created as any).id;

      const first = await dispatchStore.rejectRequest(requestId, "not needed");
      expect(first?.status).toBe("rejected");
      expect(first?.reviewedAt).toBeTruthy();

      const rejectedAuditCount = async () => {
        const rows = await exec.execute({
          sql: "SELECT COUNT(*) as count FROM dispatch_audit_events WHERE action = 'approval.rejected' AND target_id = ?",
          args: [requestId],
        });
        return Number((rows.rows[0] as any).count);
      };
      expect(await rejectedAuditCount()).toBe(1);

      const second = await dispatchStore.rejectRequest(
        requestId,
        "still not needed",
      );
      expect(second?.status).toBe("rejected");
      expect(second?.reviewedAt).toBe(first?.reviewedAt);
      expect(await rejectedAuditCount()).toBe(1);
    });
  });
});

describe("vault request status fencing", () => {
  it("creates a single grant when approveRequest is called twice on the same request", async () => {
    const [{ runWithRequestContext }, vaultStore] = await Promise.all([
      import("@agent-native/core/server"),
      import("./vault-store.js"),
    ]);

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const created = await vaultStore.createRequest({
        credentialKey: "TEST_API_KEY",
        appId: "test-app",
        reason: "needed for tests",
      });
      const requestId = (created as any).id;

      const first = await vaultStore.approveRequest(
        requestId,
        "secret-value-1",
        "Test Secret",
      );
      expect(first?.status).toBe("approved");

      const grantsAfterFirst = await vaultStore.listGrants({
        appId: "test-app",
      });
      expect(grantsAfterFirst).toHaveLength(1);

      // Loser of the race: the row is already 'approved', so this must not
      // create a second grant for the same request.
      const second = await vaultStore.approveRequest(
        requestId,
        "secret-value-2",
        "Test Secret",
      );
      expect(second?.status).toBe("approved");

      const grantsAfterSecond = await vaultStore.listGrants({
        appId: "test-app",
      });
      expect(grantsAfterSecond).toHaveLength(1);
      expect(grantsAfterSecond[0].id).toBe(grantsAfterFirst[0].id);
    });
  });

  it("denies once when denyRequest is called twice on the same request", async () => {
    const [{ runWithRequestContext }, vaultStore] = await Promise.all([
      import("@agent-native/core/server"),
      import("./vault-store.js"),
    ]);

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const created = await vaultStore.createRequest({
        credentialKey: "OTHER_API_KEY",
        appId: "test-app",
        reason: "needed for tests",
      });
      const requestId = (created as any).id;

      const first = await vaultStore.denyRequest(requestId, "not approved");
      expect(first?.status).toBe("denied");
      expect(first?.reviewedAt).toBeTruthy();

      const second = await vaultStore.denyRequest(
        requestId,
        "still not approved",
      );
      expect(second?.status).toBe("denied");
      expect(second?.reviewedAt).toBe(first?.reviewedAt);
    });
  });
});
