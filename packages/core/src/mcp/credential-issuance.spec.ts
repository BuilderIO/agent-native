import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbExec } from "../db/client.js";

const state = vi.hoisted(() => ({
  membership: vi.fn(),
  db: undefined as DbExec | undefined,
}));
vi.mock("../db/client.js", () => ({ getDbExec: () => state.db }));
vi.mock("./credential-membership.js", () => ({
  checkCredentialOrgMembership: state.membership,
}));

import {
  McpCredentialIssuanceError,
  withMcpCredentialIssuance,
} from "./credential-issuance.js";

describe("MCP credential issuance", () => {
  const input = {
    email: "Owner@Example.test",
    orgId: "org-1",
    requestOrigin: "https://app.example.test",
  };
  let tx: DbExec;
  let transaction: ReturnType<typeof vi.fn>;
  let execute: ReturnType<typeof vi.fn>;
  let memberRows: Array<Record<string, unknown>>;
  let retiredAt: number | null;
  let accountRows: Array<Record<string, unknown>>;
  const statements = () =>
    execute.mock.calls.map(([query]) => (query as { sql: string }).sql);

  beforeEach(() => {
    state.membership.mockReset().mockResolvedValue("member");
    memberRows = [{ role: "member" }];
    retiredAt = null;
    accountRows = [];
    execute = vi.fn(async ({ sql }: { sql: string }) => {
      const rows = sql.includes("pg_advisory_xact_lock")
        ? [{}]
        : sql.includes("to_regclass")
          ? [{ present: retiredAt !== null }]
          : sql.includes("FROM identity_retired_emails")
            ? retiredAt === null
              ? []
              : [{ retired_at: retiredAt }]
            : sql.includes('FROM "user"')
              ? accountRows
              : sql.includes("FROM org_members")
                ? memberRows
                : sql.startsWith("INSERT INTO synthetic_credentials")
                  ? []
                  : undefined;
      if (!rows) throw new Error(`unexpected statement: ${sql}`);
      return { rows, rowsAffected: 0 };
    });
    tx = { execute };
    transaction = vi.fn(async (run: (tx: DbExec) => Promise<unknown>) =>
      run(tx),
    );
    state.db = {
      execute: vi.fn(async () => {
        throw new Error("issuance must use the supplied transaction");
      }),
      transaction,
    };
  });

  it("validates authority before starting the transaction and locks the owner's address, then the live member, before materialization", async () => {
    state.membership.mockImplementation(async () => {
      expect(transaction).not.toHaveBeenCalled();
      return "member";
    });
    const mint = vi.fn(async (executor: DbExec) => {
      expect(executor).toBe(tx);
      const sql = statements();
      const identityLock = sql.findIndex((s) =>
        s.includes("pg_advisory_xact_lock"),
      );
      const membershipLock = sql.findIndex((s) =>
        /federation_removal_pending_at IS NULL\s+FOR UPDATE/.test(s),
      );
      expect(identityLock).toBe(0);
      expect(execute.mock.calls[identityLock][0].args).toEqual([
        expect.stringContaining("owner@example.test"),
      ]);
      expect(membershipLock).toBeGreaterThan(identityLock);
      expect(execute.mock.calls[membershipLock][0].args).toEqual([
        "org-1",
        "owner@example.test",
      ]);
      await executor.execute({
        sql: "INSERT INTO synthetic_credentials VALUES (?)",
        args: ["credential-1"],
      });
      return "credential-1";
    });

    await expect(withMcpCredentialIssuance(input, mint)).resolves.toBe(
      "credential-1",
    );
    expect(state.db!.execute).not.toHaveBeenCalled();
  });

  it.each(["not-member", "unavailable"] as const)(
    "preserves the live authority %s outcome without starting a transaction",
    async (reason) => {
      state.membership.mockResolvedValue(reason);
      const mint = vi.fn();
      await expect(
        withMcpCredentialIssuance(input, mint),
      ).rejects.toMatchObject({ reason });
      expect(mint).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("refuses a removed or pending member observed after authority validation", async () => {
    memberRows = [];
    const mint = vi.fn();
    await expect(withMcpCredentialIssuance(input, mint)).rejects.toMatchObject({
      reason: "not-member",
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it("refuses a member whose role no longer allows the credential under the membership lock", async () => {
    const mint = vi.fn(async () => "service-token");
    await expect(
      withMcpCredentialIssuance({ ...input, roles: ["owner", "admin"] }, mint),
    ).rejects.toMatchObject({ reason: "not-member" });
    expect(mint).not.toHaveBeenCalled();

    memberRows = [{ role: "admin" }];
    await expect(
      withMcpCredentialIssuance({ ...input, roles: ["owner", "admin"] }, mint),
    ).resolves.toBe("service-token");
  });

  it("keeps Personal issuance free of membership checks but behind the owner's address lock", async () => {
    const mint = vi.fn(async (executor: DbExec) => executor === tx);
    await expect(
      withMcpCredentialIssuance({ ...input, orgId: null }, mint),
    ).resolves.toBe(true);
    expect(state.membership).not.toHaveBeenCalled();
    expect(statements()[0]).toContain("pg_advisory_xact_lock");
    expect(statements().some((sql) => sql.includes("org_members"))).toBe(false);
  });

  it("keeps explicit service issuance exempt from human checks", async () => {
    const mint = vi.fn(async (executor: DbExec) => executor === tx);
    await expect(
      withMcpCredentialIssuance({ ...input, kind: "service" }, mint),
    ).resolves.toBe(true);
    expect(state.membership).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([null, "org-1"])(
    "refuses an address an email change retired until an account holds it again (org %s)",
    async (orgId) => {
      retiredAt = 1_700_000_000_000;
      const mint = vi.fn(async () => "credential");
      await expect(
        withMcpCredentialIssuance({ ...input, orgId }, mint),
      ).rejects.toMatchObject({ reason: "not-member" });
      expect(mint).not.toHaveBeenCalled();

      accountRows = [{ id: "reregistered" }];
      await expect(
        withMcpCredentialIssuance({ ...input, orgId }, mint),
      ).resolves.toBe("credential");
    },
  );

  it("reports an unreadable retirement record as unavailable and mints nothing", async () => {
    retiredAt = 1_700_000_000_000;
    const route = execute.getMockImplementation()!;
    execute.mockImplementation(async (query: { sql: string }) =>
      query.sql.includes("FROM identity_retired_emails")
        ? { rows: [{ retired_at: "not-a-time" }], rowsAffected: 0 }
        : route(query),
    );
    const mint = vi.fn();
    await expect(
      withMcpCredentialIssuance({ ...input, orgId: null }, mint),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("reports a failed lock as unavailable and mints nothing", async () => {
    execute.mockRejectedValue(new Error("synthetic database outage"));
    const mint = vi.fn();
    await expect(withMcpCredentialIssuance(input, mint)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it("propagates a failed write out of the transaction as unavailable", async () => {
    const failure = new Error("synthetic insert failure");
    transaction.mockImplementation(
      async (run: (tx: DbExec) => Promise<unknown>) => {
        await expect(run(tx)).rejects.toBe(failure);
        throw failure;
      },
    );
    await expect(
      withMcpCredentialIssuance(input, async () => {
        throw failure;
      }),
    ).rejects.toMatchObject({ reason: "unavailable", cause: failure });
  });

  it("refuses issuance without an interactive transaction", async () => {
    state.db = { execute };
    const mint = vi.fn();
    await expect(withMcpCredentialIssuance(input, mint)).rejects.toBeInstanceOf(
      McpCredentialIssuanceError,
    );
    expect(mint).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
