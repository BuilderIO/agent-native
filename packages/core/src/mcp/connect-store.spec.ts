import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory SQL simulator just rich enough for the two connect tables. We
 * pattern-match the small, fixed set of statements the store issues rather
 * than implementing a SQL engine — same approach as sibling store specs.
 */
interface TokenRow {
  id: string;
  jti: string;
  owner_email: string;
  org_id: string | null;
  label: string | null;
  kind: string;
  service_name: string | null;
  created_by: string | null;
  created_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}
interface DeviceRow {
  device_code: string;
  user_code: string;
  owner_email: string | null;
  org_id: string | null;
  status: string;
  token_jti: string | null;
  created_at: number | null;
  expires_at: number | null;
  consumed_at: number | null;
}

let tokens: TokenRow[] = [];
let devices: DeviceRow[] = [];
let failNextCreateTable = false;

const exec = async (input: string | { sql: string; args?: unknown[] }) => {
  const sql = (typeof input === "string" ? input : input.sql).trim();
  const args = (typeof input === "string" ? [] : (input.args ?? [])) as any[];

  if (/^CREATE TABLE/i.test(sql)) {
    if (failNextCreateTable) {
      failNextCreateTable = false;
      throw new Error("transient create-table failure");
    }
    return { rows: [], rowsAffected: 0 };
  }
  // Additive org-service-token columns — already part of the in-memory shape.
  if (/^ALTER TABLE mcp_connect_tokens ADD COLUMN/i.test(sql)) {
    return { rows: [], rowsAffected: 0 };
  }

  // --- mcp_connect_tokens ---
  if (/^INSERT INTO mcp_connect_tokens/i.test(sql)) {
    tokens.push({
      id: args[0],
      jti: args[1],
      owner_email: args[2],
      org_id: args[3],
      label: args[4],
      kind: args[5],
      service_name: args[6],
      created_by: args[7],
      created_at: args[8],
      last_used_at: args[9],
      revoked_at: args[10],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^SELECT revoked_at FROM mcp_connect_tokens WHERE jti = \?/i.test(sql)) {
    const t = tokens.find((r) => r.jti === args[0]);
    return { rows: t ? [{ revoked_at: t.revoked_at }] : [], rowsAffected: 0 };
  }
  if (
    /^SELECT id, jti, owner_email.* FROM mcp_connect_tokens WHERE owner_email = \?/i.test(
      sql,
    )
  ) {
    const rows = tokens
      .filter((r) => r.owner_email === args[0])
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    return { rows, rowsAffected: 0 };
  }
  if (
    /^SELECT id, jti, owner_email.* FROM mcp_connect_tokens WHERE org_id = \? AND kind = 'service'/i.test(
      sql,
    )
  ) {
    const rows = tokens
      .filter((r) => r.org_id === args[0] && r.kind === "service")
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    return { rows, rowsAffected: 0 };
  }
  if (
    /^UPDATE mcp_connect_tokens SET revoked_at = \? WHERE id = \? AND org_id = \? AND kind = 'service'/i.test(
      sql,
    )
  ) {
    const t = tokens.find(
      (r) =>
        r.id === args[1] &&
        r.org_id === args[2] &&
        r.kind === "service" &&
        r.revoked_at == null,
    );
    if (!t) return { rows: [], rowsAffected: 0 };
    t.revoked_at = args[0];
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE mcp_connect_tokens SET revoked_at = \?/i.test(sql)) {
    const t = tokens.find(
      (r) =>
        r.id === args[1] && r.owner_email === args[2] && r.revoked_at == null,
    );
    if (!t) return { rows: [], rowsAffected: 0 };
    t.revoked_at = args[0];
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE mcp_connect_tokens SET last_used_at = \?/i.test(sql)) {
    const t = tokens.find((r) => r.jti === args[1]);
    if (t) t.last_used_at = args[0];
    return { rows: [], rowsAffected: t ? 1 : 0 };
  }

  // --- mcp_device_codes ---
  if (/^SELECT COUNT\(\*\) AS n FROM mcp_device_codes/i.test(sql)) {
    const n = devices.filter((d) => (d.created_at ?? 0) > args[0]).length;
    return { rows: [{ n }], rowsAffected: 0 };
  }
  if (/^INSERT INTO mcp_device_codes/i.test(sql)) {
    devices.push({
      device_code: args[0],
      user_code: args[1],
      owner_email: args[2],
      org_id: args[3],
      status: args[4],
      token_jti: args[5],
      created_at: args[6],
      expires_at: args[7],
      consumed_at: args[8],
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^SELECT \* FROM mcp_device_codes WHERE device_code = \?/i.test(sql)) {
    const d = devices.find((r) => r.device_code === args[0]);
    return { rows: d ? [{ ...d }] : [], rowsAffected: 0 };
  }
  if (/^SELECT \* FROM mcp_device_codes WHERE user_code = \?/i.test(sql)) {
    const d = devices.find((r) => r.user_code === args[0]);
    return { rows: d ? [{ ...d }] : [], rowsAffected: 0 };
  }
  if (
    /^UPDATE mcp_device_codes SET status = 'approved', owner_email = \?/i.test(
      sql,
    )
  ) {
    const d = devices.find(
      (r) => r.user_code === args[2] && r.status === "pending",
    );
    if (!d) return { rows: [], rowsAffected: 0 };
    d.status = "approved";
    d.owner_email = args[0];
    d.org_id = args[1];
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE mcp_device_codes SET status = 'consumed'/i.test(sql)) {
    const d = devices.find(
      (r) =>
        (r.device_code === args[2] && r.status === "approved") ||
        (r.device_code === args[0] &&
          r.status === "minting" &&
          r.token_jti === args[1]),
    );
    if (!d) return { rows: [], rowsAffected: 0 };
    d.status = "consumed";
    if (args.length > 2) {
      d.token_jti = args[0];
      d.consumed_at = args[1];
    }
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE mcp_device_codes SET status = 'minting'/i.test(sql)) {
    const d = devices.find(
      (r) => r.device_code === args[2] && r.status === "approved",
    );
    if (!d) return { rows: [], rowsAffected: 0 };
    d.status = "minting";
    d.token_jti = args[0];
    d.consumed_at = args[1];
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE mcp_device_codes SET status = 'approved'/i.test(sql)) {
    const d = devices.find(
      (r) =>
        r.device_code === args[0] &&
        r.status === "minting" &&
        r.token_jti === args[1],
    );
    if (!d) return { rows: [], rowsAffected: 0 };
    d.status = "approved";
    d.token_jti = null;
    d.consumed_at = null;
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE mcp_device_codes SET status = 'expired'/i.test(sql)) {
    const d = devices.find(
      (r) =>
        r.device_code === args[0] &&
        (r.status === "pending" || r.status === "approved"),
    );
    if (!d) return { rows: [], rowsAffected: 0 };
    d.status = "expired";
    return { rows: [], rowsAffected: 1 };
  }

  throw new Error("unhandled SQL in mock: " + sql);
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: exec }),
  isConnectionError: () => false,
  isPostgres: () => false,
  intType: () => "INTEGER",
}));

const store = await import("./connect-store.js");

describe("connect-store", () => {
  beforeEach(() => {
    tokens = [];
    devices = [];
    failNextCreateTable = false;
    vi.restoreAllMocks();
  });

  it("retries table initialization after a transient failure", async () => {
    failNextCreateTable = true;
    await expect(
      store.recordMintedToken({
        jti: "jti-fail-once",
        ownerEmail: "a@example.com",
      }),
    ).rejects.toThrow("transient create-table failure");

    await expect(
      store.recordMintedToken({
        jti: "jti-retry",
        ownerEmail: "a@example.com",
      }),
    ).resolves.toBeTruthy();
    expect(tokens.map((t) => t.jti)).toEqual(["jti-retry"]);
  });

  describe("token records", () => {
    it("records a minted token and never stores the token value", async () => {
      const id = await store.recordMintedToken({
        jti: "jti-1",
        ownerEmail: "a@example.com",
        orgId: "org-1",
        label: "laptop",
      });
      expect(id).toBeTruthy();
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        jti: "jti-1",
        owner_email: "a@example.com",
        org_id: "org-1",
        label: "laptop",
        revoked_at: null,
      });
      // The row has no column for the token value at all.
      expect(Object.keys(tokens[0])).not.toContain("token");
    });

    it("isJtiRevoked is false for an active token and true after revoke", async () => {
      await store.recordMintedToken({ jti: "j", ownerEmail: "a@example.com" });
      expect(await store.isJtiRevoked("j")).toBe(false);
      const id = tokens[0].id;
      expect(await store.revokeToken("a@example.com", id)).toBe(true);
      expect(await store.isJtiRevoked("j")).toBe(true);
    });

    it("isJtiRevoked is false for an unknown jti", async () => {
      expect(await store.isJtiRevoked("nope")).toBe(false);
    });

    it("revokeToken only affects tokens owned by the caller", async () => {
      const id = await store.recordMintedToken({
        jti: "j",
        ownerEmail: "owner@example.com",
      });
      expect(await store.revokeToken("attacker@example.com", id)).toBe(false);
      expect(tokens[0].revoked_at).toBeNull();
      expect(await store.revokeToken("owner@example.com", id)).toBe(true);
    });

    it("revokeToken is idempotent (re-revoke is a no-op)", async () => {
      const id = await store.recordMintedToken({
        jti: "j",
        ownerEmail: "o@example.com",
      });
      expect(await store.revokeToken("o@example.com", id)).toBe(true);
      const first = tokens[0].revoked_at;
      expect(await store.revokeToken("o@example.com", id)).toBe(false);
      expect(tokens[0].revoked_at).toBe(first);
    });

    it("listTokens returns only the caller's tokens, newest first", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1000);
      await store.recordMintedToken({ jti: "j1", ownerEmail: "a@example.com" });
      vi.spyOn(Date, "now").mockReturnValue(2000);
      await store.recordMintedToken({ jti: "j2", ownerEmail: "a@example.com" });
      await store.recordMintedToken({ jti: "j3", ownerEmail: "b@example.com" });
      const list = await store.listTokens("a@example.com");
      expect(list.map((t) => t.jti)).toEqual(["j2", "j1"]);
    });

    it("touchTokenUsed never throws and stamps last_used_at", async () => {
      await store.recordMintedToken({ jti: "j", ownerEmail: "a@example.com" });
      await expect(store.touchTokenUsed("j")).resolves.toBeUndefined();
      expect(tokens[0].last_used_at).not.toBeNull();
      // Unknown jti is a silent no-op (best-effort telemetry).
      await expect(store.touchTokenUsed("missing")).resolves.toBeUndefined();
    });

    it("personal tokens default to kind 'personal' with no service fields", async () => {
      await store.recordMintedToken({
        jti: "j-personal",
        ownerEmail: "a@example.com",
      });
      expect(tokens[0]).toMatchObject({
        kind: "personal",
        service_name: null,
        created_by: null,
      });
      const list = await store.listTokens("a@example.com");
      expect(list[0].kind).toBe("personal");
      expect(list[0].serviceName).toBeNull();
      expect(list[0].createdBy).toBeNull();
    });
  });

  describe("org service tokens", () => {
    it("serviceIdentityEmail builds a normalized, email-shaped synthetic identity", () => {
      expect(store.serviceIdentityEmail("ci", "org-1")).toBe(
        "svc-ci@service.org-1",
      );
      expect(store.serviceIdentityEmail("PR Recap!", "org-1")).toBe(
        "svc-pr-recap@service.org-1",
      );
      expect(store.isServiceIdentityEmail("svc-ci@service.org-1")).toBe(true);
      expect(store.isServiceIdentityEmail("steve@example.com")).toBe(false);
      expect(store.isServiceIdentityEmail(undefined)).toBe(false);
      expect(() => store.normalizeServiceName("!!!")).toThrow();
    });

    it("records a service token with kind/service_name/created_by and never the value", async () => {
      const email = store.serviceIdentityEmail("ci", "org-1");
      const id = await store.recordMintedToken({
        jti: "jti-svc",
        ownerEmail: email,
        orgId: "org-1",
        label: "Service token: ci",
        kind: "service",
        serviceName: "ci",
        createdBy: "admin@example.com",
      });
      expect(id).toBeTruthy();
      expect(tokens[0]).toMatchObject({
        jti: "jti-svc",
        owner_email: "svc-ci@service.org-1",
        org_id: "org-1",
        kind: "service",
        service_name: "ci",
        created_by: "admin@example.com",
        revoked_at: null,
      });
      expect(Object.keys(tokens[0])).not.toContain("token");
    });

    it("listOrgServiceTokens returns only the org's service tokens, newest first", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1000);
      await store.recordMintedToken({
        jti: "j-personal",
        ownerEmail: "human@example.com",
        orgId: "org-1",
      });
      await store.recordMintedToken({
        jti: "j-svc-1",
        ownerEmail: store.serviceIdentityEmail("ci", "org-1"),
        orgId: "org-1",
        kind: "service",
        serviceName: "ci",
        createdBy: "admin@example.com",
      });
      vi.spyOn(Date, "now").mockReturnValue(2000);
      await store.recordMintedToken({
        jti: "j-svc-2",
        ownerEmail: store.serviceIdentityEmail("recap", "org-1"),
        orgId: "org-1",
        kind: "service",
        serviceName: "recap",
        createdBy: "admin@example.com",
      });
      await store.recordMintedToken({
        jti: "j-other-org",
        ownerEmail: store.serviceIdentityEmail("ci", "org-2"),
        orgId: "org-2",
        kind: "service",
        serviceName: "ci",
        createdBy: "other@example.com",
      });

      const list = await store.listOrgServiceTokens("org-1");
      expect(list.map((t) => t.jti)).toEqual(["j-svc-2", "j-svc-1"]);
      expect(list.every((t) => t.kind === "service")).toBe(true);
      expect(list[0].serviceName).toBe("recap");
      expect(list[0].createdBy).toBe("admin@example.com");
    });

    it("revokeOrgServiceToken is org-scoped and kills the jti via the shared gate", async () => {
      const id = await store.recordMintedToken({
        jti: "jti-svc",
        ownerEmail: store.serviceIdentityEmail("ci", "org-1"),
        orgId: "org-1",
        kind: "service",
        serviceName: "ci",
        createdBy: "admin@example.com",
      });

      // Another org can't revoke it.
      expect(await store.revokeOrgServiceToken("org-2", id)).toBe(false);
      expect(await store.isJtiRevoked("jti-svc")).toBe(false);

      // The owning org can; the shared revocation gate then rejects the jti.
      expect(await store.revokeOrgServiceToken("org-1", id)).toBe(true);
      expect(await store.isJtiRevoked("jti-svc")).toBe(true);

      // Idempotent: re-revoking keeps the first timestamp.
      const first = tokens[0].revoked_at;
      expect(await store.revokeOrgServiceToken("org-1", id)).toBe(false);
      expect(tokens[0].revoked_at).toBe(first);
    });

    it("revokeOrgServiceToken never touches personal tokens (kind mismatch)", async () => {
      const id = await store.recordMintedToken({
        jti: "j-personal",
        ownerEmail: "human@example.com",
        orgId: "org-1",
      });
      expect(await store.revokeOrgServiceToken("org-1", id)).toBe(false);
      expect(tokens[0].revoked_at).toBeNull();
    });
  });

  describe("device-code lifecycle", () => {
    it("creates a crypto-random device + dashed user code with a 10-min TTL", async () => {
      const t = 1_000_000;
      vi.spyOn(Date, "now").mockReturnValue(t);
      const row = await store.createDeviceCode();
      expect(row.userCode).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
      expect(row.deviceCode.length).toBeGreaterThan(20);
      expect(row.status).toBe("pending");
      expect(row.expiresAt).toBe(t + store.DEVICE_CODE_TTL_MS);
    });

    it("rate-limits device code creation within the window", async () => {
      vi.spyOn(Date, "now").mockReturnValue(5_000_000);
      for (let i = 0; i < store.DEVICE_START_MAX; i++) {
        await store.createDeviceCode();
      }
      await expect(store.createDeviceCode()).rejects.toThrow("RATE_LIMITED");
    });

    it("approve binds the user, then consume mints exactly once", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1000);
      const created = await store.createDeviceCode();

      const approved = await store.approveDeviceCode(
        created.userCode,
        "user@example.com",
        "org-9",
      );
      expect(approved).not.toBe("not_found");
      expect(typeof approved === "object" && approved.status).toBe("approved");

      const first = await store.consumeDeviceCode(created.deviceCode, "jti-x");
      expect(first?.ownerEmail).toBe("user@example.com");
      expect(first?.orgId).toBe("org-9");

      // Single-use: a second consume returns null.
      const second = await store.consumeDeviceCode(created.deviceCode, "jti-y");
      expect(second).toBeNull();

      const row = await store.getDeviceCode(created.deviceCode);
      expect(row?.status).toBe("consumed");
      expect(row?.tokenJti).toBe("jti-x");
    });

    it("claim mint can be released and retried before final consume", async () => {
      const created = await store.createDeviceCode();
      await store.approveDeviceCode(created.userCode, "u@example.com", "org-1");
      const claimed = await store.claimDeviceCodeForMint(
        created.deviceCode,
        "jti-1",
      );
      expect(claimed?.ownerEmail).toBe("u@example.com");
      expect((await store.getDeviceCode(created.deviceCode))?.status).toBe(
        "minting",
      );

      await store.releaseDeviceCodeMint(created.deviceCode, "jti-1");
      expect((await store.getDeviceCode(created.deviceCode))?.status).toBe(
        "approved",
      );

      const claimedAgain = await store.claimDeviceCodeForMint(
        created.deviceCode,
        "jti-2",
      );
      expect(claimedAgain?.ownerEmail).toBe("u@example.com");
      expect(
        await store.finishDeviceCodeMint(created.deviceCode, "jti-2"),
      ).toBe(true);
      expect((await store.getDeviceCode(created.deviceCode))?.status).toBe(
        "consumed",
      );
    });

    it("rejects approving an unknown / already-used code", async () => {
      expect(
        await store.approveDeviceCode(" AAAA-AAAA", "u@example.com", null),
      ).toBe("not_found");

      const created = await store.createDeviceCode();
      await store.approveDeviceCode(created.userCode, "u@example.com", null);
      expect(
        await store.approveDeviceCode(created.userCode, "u@example.com", null),
      ).toBe("already");
    });

    it("rejects approving an expired code", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1000);
      const created = await store.createDeviceCode();
      vi.spyOn(Date, "now").mockReturnValue(
        1000 + store.DEVICE_CODE_TTL_MS + 1,
      );
      expect(
        await store.approveDeviceCode(created.userCode, "u@example.com", null),
      ).toBe("expired");
    });

    it("cannot consume a code that was never approved", async () => {
      const created = await store.createDeviceCode();
      expect(
        await store.consumeDeviceCode(created.deviceCode, "jti"),
      ).toBeNull();
    });
  });
});
