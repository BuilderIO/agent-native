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

  beforeEach(() => {
    state.membership.mockReset().mockResolvedValue("member");
    execute = vi.fn(async () => ({
      rows: [{ id: "member-1" }],
      rowsAffected: 0,
    }));
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

  it("validates authority before starting the transaction and locks the live member before materialization", async () => {
    state.membership.mockImplementation(async () => {
      expect(transaction).not.toHaveBeenCalled();
      return "member";
    });
    const mint = vi.fn(async (executor: DbExec) => {
      expect(executor).toBe(tx);
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith({
        sql: expect.stringMatching(
          /federation_removal_pending_at IS NULL\s+FOR UPDATE/,
        ),
        args: ["org-1", "owner@example.test"],
      });
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
    execute.mockResolvedValue({ rows: [], rowsAffected: 0 });
    const mint = vi.fn();
    await expect(withMcpCredentialIssuance(input, mint)).rejects.toMatchObject({
      reason: "not-member",
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it.each([null, "org-1"])(
    "keeps Personal and explicit service issuance exempt from human membership checks (org %s)",
    async (orgId) => {
      const mint = vi.fn(async (executor: DbExec) => executor === tx);
      await expect(
        withMcpCredentialIssuance(
          { ...input, orgId, ...(orgId ? { kind: "service" as const } : {}) },
          mint,
        ),
      ).resolves.toBe(true);
      expect(state.membership).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

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
