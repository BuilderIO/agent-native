import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Org service-token actions: gating (owner/admin for mint/revoke, member for
 * list), no-org / non-member rejection, and that the secret only appears in
 * the mint response. The store/signing layers are covered by
 * connect-store.spec.ts and build-server.verify-auth.spec.ts — here they are
 * mocked so the spec exercises only the action layer.
 */

const mintOrgServiceTokenMock = vi.fn();
vi.mock("../connect-route.js", () => ({
  mintOrgServiceToken: (...a: any[]) => mintOrgServiceTokenMock(...a),
}));

const listOrgServiceTokensMock = vi.fn();
const revokeOrgServiceTokenMock = vi.fn();
vi.mock("../connect-store.js", () => ({
  listOrgServiceTokens: (...a: any[]) => listOrgServiceTokensMock(...a),
  revokeOrgServiceToken: (...a: any[]) => revokeOrgServiceTokenMock(...a),
}));

// org_members role lookup used by the gating helper.
const roleRows: Array<{ role: string }> = [];
const dbExecuteMock = vi.fn(async () => ({ rows: roleRows, rowsAffected: 0 }));
vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({ execute: dbExecuteMock }),
}));

vi.mock("../../server/request-context.js", () => ({
  getRequestContext: () => ({ requestOrigin: "https://plan.example.com" }),
}));
vi.mock("../../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://plan.example.com",
}));

const createAction = (await import("./create-org-service-token.js")).default;
const listAction = (await import("./list-org-service-tokens.js")).default;
const revokeAction = (await import("./revoke-org-service-token.js")).default;

const CTX = (overrides: Partial<{ userEmail: string; orgId: string }> = {}) =>
  ({
    userEmail: "admin@example.com",
    orgId: "org-1",
    caller: "http",
    ...overrides,
  }) as any;

function setRole(role: string | null) {
  roleRows.length = 0;
  if (role) roleRows.push({ role });
}

beforeEach(() => {
  vi.clearAllMocks();
  setRole("admin");
  mintOrgServiceTokenMock.mockResolvedValue({
    token: "svc-secret-value",
    jti: "jti-1",
    id: "tok-1",
    serviceName: "ci",
    serviceEmail: "svc-ci@service.org-1",
    ttlDays: 365,
  });
  listOrgServiceTokensMock.mockResolvedValue([]);
  revokeOrgServiceTokenMock.mockResolvedValue(true);
});

describe("create-org-service-token", () => {
  it("is not callable from the sandboxed agent tool loop", () => {
    expect(createAction.toolCallable).toBe(false);
    expect(revokeAction.toolCallable).toBe(false);
  });

  it("mints for an org admin and returns the token exactly once", async () => {
    const res = await createAction.run({ name: "ci" }, CTX());
    expect(mintOrgServiceTokenMock).toHaveBeenCalledWith({
      serviceName: "ci",
      orgId: "org-1",
      createdBy: "admin@example.com",
      ttlDays: undefined,
      appUrl: "https://plan.example.com",
    });
    expect(res.token).toBe("svc-secret-value");
    expect(res.serviceEmail).toBe("svc-ci@service.org-1");
  });

  it("mints for an org owner", async () => {
    setRole("owner");
    const res = await createAction.run({ name: "ci", ttlDays: 30 }, CTX());
    expect(res.token).toBe("svc-secret-value");
    expect(mintOrgServiceTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ ttlDays: 30 }),
    );
  });

  it("rejects a plain org member with 403", async () => {
    setRole("member");
    await expect(createAction.run({ name: "ci" }, CTX())).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
  });

  it("rejects a non-member (including synthetic service identities) with 403", async () => {
    setRole(null);
    await expect(
      createAction.run(
        { name: "ci" },
        CTX({ userEmail: "svc-ci@service.org-1" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    await expect(
      createAction.run({ name: "ci" }, { caller: "http" } as any),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a caller without an active org with 400", async () => {
    await expect(
      createAction.run({ name: "ci" }, {
        userEmail: "admin@example.com",
        orgId: null,
        caller: "http",
      } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("list-org-service-tokens", () => {
  it("allows any org member and returns metadata only (never token values)", async () => {
    setRole("member");
    listOrgServiceTokensMock.mockResolvedValue([
      {
        id: "tok-1",
        jti: "jti-1",
        ownerEmail: "svc-ci@service.org-1",
        orgId: "org-1",
        label: "Service token: ci",
        kind: "service",
        serviceName: "ci",
        createdBy: "admin@example.com",
        createdAt: 1000,
        lastUsedAt: 2000,
        revokedAt: null,
      },
      {
        id: "tok-2",
        jti: "jti-2",
        ownerEmail: "svc-old@service.org-1",
        orgId: "org-1",
        label: "Service token: old",
        kind: "service",
        serviceName: "old",
        createdBy: "admin@example.com",
        createdAt: 500,
        lastUsedAt: null,
        revokedAt: 900,
      },
    ]);

    const res = await listAction.run(
      {},
      CTX({ userEmail: "member@example.com" }),
    );
    expect(listOrgServiceTokensMock).toHaveBeenCalledWith("org-1");
    // Revoked tokens are excluded by default.
    expect(res.tokens.map((t: any) => t.id)).toEqual(["tok-1"]);
    expect(res.tokens[0]).toEqual({
      id: "tok-1",
      serviceName: "ci",
      serviceEmail: "svc-ci@service.org-1",
      label: "Service token: ci",
      createdBy: "admin@example.com",
      createdAt: 1000,
      lastUsedAt: 2000,
      revokedAt: null,
    });
    expect(JSON.stringify(res)).not.toContain("svc-secret-value");

    const withRevoked = await listAction.run(
      { includeRevoked: true },
      CTX({ userEmail: "member@example.com" }),
    );
    expect(withRevoked.tokens.map((t: any) => t.id)).toEqual([
      "tok-1",
      "tok-2",
    ]);
  });

  it("rejects a non-member with 403", async () => {
    setRole(null);
    await expect(listAction.run({}, CTX())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(listOrgServiceTokensMock).not.toHaveBeenCalled();
  });
});

describe("revoke-org-service-token", () => {
  it("revokes for an org admin, scoped to the caller's org", async () => {
    const res = await revokeAction.run({ id: "tok-1" }, CTX());
    expect(revokeOrgServiceTokenMock).toHaveBeenCalledWith("org-1", "tok-1");
    expect(res).toEqual({ ok: true });
  });

  it("rejects a plain org member with 403", async () => {
    setRole("member");
    await expect(
      revokeAction.run({ id: "tok-1" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(revokeOrgServiceTokenMock).not.toHaveBeenCalled();
  });
});
