import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeTransaction: true,
  orgId: "org-1" as string | undefined,
  email: "Owner@Example.test" as string | undefined,
}));

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  isActiveTransactionExec: () => state.activeTransaction,
}));
vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => state.orgId,
  getRequestUserEmail: () => state.email,
}));

import type { DbExec } from "../db/client.js";
import { insertWorkspaceConnectionGrantIfAbsent } from "./insert-grant.js";

type Statement = { sql: string; args: unknown[] };

function fakeTx(options: { lockedRows?: number; rowsAffected?: number } = {}) {
  const statements: Statement[] = [];
  const execute = vi.fn(async (statement: Statement) => {
    statements.push(statement);
    if (statement.sql.includes("FOR UPDATE")) {
      return {
        rows: Array.from({ length: options.lockedRows ?? 1 }, () => ({
          id: "conn-1",
        })),
        rowsAffected: 0,
      };
    }
    return { rows: [], rowsAffected: options.rowsAffected ?? 1 };
  });
  return { tx: { execute } as unknown as DbExec, statements, execute };
}

const input = {
  connectionId: "conn-1",
  appId: "mail",
  orgId: "org-1",
  grantedByEmail: "owner@example.test",
};

describe("insertWorkspaceConnectionGrantIfAbsent", () => {
  beforeEach(() => {
    state.activeTransaction = true;
    state.orgId = "org-1";
    state.email = " Owner@Example.test ";
  });

  it("locks the scoped connection, then inserts a fresh empty grant", async () => {
    const { tx, statements } = fakeTx();
    const before = Date.now();
    await expect(
      insertWorkspaceConnectionGrantIfAbsent(tx, input),
    ).resolves.toBe(true);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toEqual({
      sql: "SELECT id FROM public.workspace_connections WHERE id = ? AND org_id = ? FOR UPDATE",
      args: ["conn-1", "org-1"],
    });
    const insert = statements[1]!;
    expect(insert.sql).toMatch(
      /INSERT INTO public\.workspace_connection_grants/,
    );
    expect(insert.sql).toMatch(/'\{\}', '\[\]'/);
    expect(insert.sql).toMatch(/WHERE id = \? AND org_id = \?/);
    expect(insert.sql).toMatch(
      /ON CONFLICT \(connection_id, app_id\) DO NOTHING/,
    );
    const [id, appId, grantedBy, owner, createdAt, updatedAt, connId, orgId] =
      insert.args as [
        string,
        string,
        string,
        string,
        number,
        number,
        string,
        string,
      ];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect([appId, grantedBy, owner, connId, orgId]).toEqual([
      "mail",
      "owner@example.test",
      "owner@example.test",
      "conn-1",
      "org-1",
    ]);
    expect(createdAt).toBe(updatedAt);
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("reports an existing grant as not inserted", async () => {
    const { tx } = fakeTx({ rowsAffected: 0 });
    await expect(
      insertWorkspaceConnectionGrantIfAbsent(tx, input),
    ).resolves.toBe(false);
  });

  it("refuses when the scoped connection is not found", async () => {
    const { tx, statements } = fakeTx({ lockedRows: 0 });
    await expect(
      insertWorkspaceConnectionGrantIfAbsent(tx, input),
    ).rejects.toThrow("Scoped connection was not found.");
    expect(statements).toHaveLength(1);
  });

  it.each([
    ["outside a transaction", () => (state.activeTransaction = false), {}],
    ["for a request in another org", () => (state.orgId = "org-2"), {}],
    ["without a request org", () => (state.orgId = undefined), {}],
    [
      "for another signed-in user",
      () => (state.email = "other@example.test"),
      {},
    ],
    ["without a signed-in user", () => (state.email = undefined), {}],
    ["without an org id", () => (state.orgId = ""), { orgId: "" }],
    ["with a blank app id", () => {}, { appId: "  " }],
    ["with a blank connection id", () => {}, { connectionId: " " }],
    [
      "when the grantor email is not normalized",
      () => {},
      { grantedByEmail: "Owner@Example.test" },
    ],
  ])(
    "refuses %s before touching the database",
    async (_label, arrange, patch) => {
      arrange();
      const { tx, execute } = fakeTx();
      await expect(
        insertWorkspaceConnectionGrantIfAbsent(tx, { ...input, ...patch }),
      ).rejects.toThrow(
        "Grant insert requires the authenticated workspace scope.",
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("accepts a request org with surrounding whitespace", async () => {
    state.orgId = " org-1 ";
    const { tx } = fakeTx();
    await expect(
      insertWorkspaceConnectionGrantIfAbsent(tx, input),
    ).resolves.toBe(true);
  });
});
