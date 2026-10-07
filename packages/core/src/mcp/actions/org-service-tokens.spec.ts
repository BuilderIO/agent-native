import { beforeEach, describe, expect, it, vi } from "vitest";

const mintOrgServiceTokenMock = vi.fn();
vi.mock("../connect-route.js", () => ({
  mintOrgServiceToken: (...a: any[]) => mintOrgServiceTokenMock(...a),
}));

const listOrgServiceTokensMock = vi.fn();
const revokeOrgServiceTokenMock = vi.fn();
vi.mock("../connect-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../connect-store.js")>()),
  listOrgServiceTokens: (...a: any[]) => listOrgServiceTokensMock(...a),
  revokeOrgServiceToken: (...a: any[]) => revokeOrgServiceTokenMock(...a),
}));

const getPolicyMock = vi.fn();
const upsertPolicyMock = vi.fn();
const listPoliciesMock = vi.fn();
vi.mock("../../org/service-principal-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../org/service-principal-policy.js")
  >()),
  // The action boundary evaluates a service caller before its own checks run.
  evaluateServicePrincipal: async () => ({
    status: "ungoverned",
    orgId: "org-1",
    serviceName: "ci",
  }),
  getServicePrincipalPolicy: (...a: any[]) => getPolicyMock(...a),
  upsertServicePrincipalPolicy: (...a: any[]) => upsertPolicyMock(...a),
  listServicePrincipalPolicies: (...a: any[]) => listPoliciesMock(...a),
}));

const isOrgMemberMock = vi.fn();
vi.mock("../../org/membership.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../org/membership.js")>()),
  isOrgMember: (...a: any[]) => isOrgMemberMock(...a),
}));

const roleRows: Array<{ role: string }> = [];
const memberOrgRows: Array<{ org_id: string }> = [];
const dbExecuteMock = vi.fn(async (query: { sql: string }) =>
  /select\s+org_id/i.test(query.sql)
    ? { rows: memberOrgRows, rowsAffected: 0 }
    : { rows: roleRows, rowsAffected: 0 },
);
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

function setMemberOrgs(...orgIds: string[]) {
  memberOrgRows.length = 0;
  for (const org_id of orgIds) memberOrgRows.push({ org_id });
}

beforeEach(() => {
  vi.clearAllMocks();
  setRole("admin");
  setMemberOrgs();
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
  getPolicyMock.mockResolvedValue(null);
  listPoliciesMock.mockResolvedValue([]);
  isOrgMemberMock.mockResolvedValue(true);
  upsertPolicyMock.mockImplementation(async (_org, name, input) => ({
    serviceName: name,
    lifecycle: "active",
    ownerEmail: input.ownerEmail ?? null,
    riskTier: input.riskTier ?? "medium",
    allowedActions: input.allowedActions ?? null,
  }));
});

describe("create-org-service-token", () => {
  it("is not callable from the sandboxed agent tool loop", () => {
    expect(createAction.toolCallable).toBe(false);
    expect(revokeAction.toolCallable).toBe(false);
  });

  it("audits token creation and re-minting without inputs or credential data", () => {
    const args = { name: "ci", ownerEmail: "owner@example.com" };
    const result = {
      id: "tok-1",
      token: "svc-secret-value",
      serviceName: "ci",
      serviceEmail: "svc-ci@service.org-1",
    };
    const meta = {
      caller: "http",
      userEmail: "admin@example.com",
      orgId: "org-1",
    };
    const audit = createAction.audit;
    const target = audit?.target?.(args, result, meta);
    const summary = audit?.summary?.(args, result, meta);

    expect(audit?.recordInputs).toBe(false);
    expect(target).toEqual({
      type: "service-principal",
      id: "ci",
      orgId: "org-1",
      visibility: "admins",
    });
    expect(summary).toBe("Created or re-minted an organization service token.");
    expect(JSON.stringify({ target, summary })).not.toContain(result.token);
    expect(JSON.stringify({ target, summary })).not.toContain(
      result.serviceEmail,
    );
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

  it("births the principal governed: owner defaults to the creating admin, medium risk, unrestricted", async () => {
    const res = await createAction.run({ name: "CI" }, CTX());
    expect(upsertPolicyMock).toHaveBeenCalledWith("org-1", "ci", {
      ownerEmail: "admin@example.com",
    });
    expect(res).toMatchObject({
      ownerEmail: "admin@example.com",
      riskTier: "medium",
      allowedActions: null,
    });
  });

  it("writes the governance fields passed at mint, validating the owner is an org member", async () => {
    await createAction.run(
      {
        name: "ci",
        ownerEmail: "Owner@Example.com",
        team: "platform",
        riskTier: "high",
        purpose: "release automation",
        allowedActions: ["list-*", "list-*", "get-plan"],
      },
      CTX(),
    );
    expect(isOrgMemberMock).toHaveBeenCalledWith("org-1", "owner@example.com");
    expect(upsertPolicyMock).toHaveBeenCalledWith("org-1", "ci", {
      ownerEmail: "owner@example.com",
      team: "platform",
      riskTier: "high",
      purpose: "release automation",
      allowedActions: ["list-*", "get-plan"],
    });
  });

  it("keeps an existing owner when re-minting without governance fields", async () => {
    getPolicyMock.mockResolvedValue({
      lifecycle: "active",
      ownerEmail: "owner@example.com",
    });
    await createAction.run({ name: "ci" }, CTX());
    expect(upsertPolicyMock).toHaveBeenCalledWith("org-1", "ci", {});
  });

  it.each(["suspended", "retired"])(
    "refuses to mint for a %s principal",
    async (lifecycle) => {
      getPolicyMock.mockResolvedValue({ lifecycle, ownerEmail: "o@x.com" });
      await expect(
        createAction.run({ name: "ci" }, CTX()),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a non-member or service identity owner before minting", async () => {
    isOrgMemberMock.mockResolvedValue(false);
    await expect(
      createAction.run({ name: "ci", ownerEmail: "x@example.com" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createAction.run(
        { name: "ci", ownerEmail: "svc-other@service.org.example" },
        CTX(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
  });

  it("answers an unreadable policy store with 503 rather than minting ungoverned", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPolicyMock.mockRejectedValue(new Error("db down"));
    await expect(createAction.run({ name: "ci" }, CTX())).rejects.toMatchObject(
      { statusCode: 503 },
    );
    expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
  });

  it("revokes the token when its governance record cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    upsertPolicyMock.mockRejectedValue(new Error("write failed"));
    await expect(createAction.run({ name: "ci" }, CTX())).rejects.toMatchObject(
      { statusCode: 503 },
    );
    expect(revokeOrgServiceTokenMock).toHaveBeenCalledWith("org-1", "tok-1");
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

  it("rejects a caller without an active org and no memberships with 400", async () => {
    setMemberOrgs();
    await expect(
      createAction.run({ name: "ci" }, {
        userEmail: "admin@example.com",
        orgId: null,
        caller: "http",
      } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
  });

  it("auto-resolves the single member org when the token carries no org context", async () => {
    setMemberOrgs("org-7");
    setRole("admin");
    const res = await createAction.run({ name: "ci" }, {
      userEmail: "admin@example.com",
      orgId: null,
      caller: "http",
    } as any);
    expect(res.token).toBe("svc-secret-value");
    expect(mintOrgServiceTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-7" }),
    );
  });

  it("rejects with 400 when the token has no org context and the caller belongs to multiple orgs", async () => {
    setMemberOrgs("org-1", "org-2");
    await expect(
      createAction.run({ name: "ci" }, {
        userEmail: "admin@example.com",
        orgId: null,
        caller: "http",
      } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    ["not-member", 403],
    ["unavailable", 503],
  ] as const)(
    "answers %s from the mint's membership lock with %i",
    async (reason, statusCode) => {
      const { McpCredentialIssuanceError } =
        await import("../credential-issuance.js");
      mintOrgServiceTokenMock.mockRejectedValue(
        new McpCredentialIssuanceError(reason),
      );
      await expect(
        createAction.run({ name: "ci" }, CTX()),
      ).rejects.toMatchObject({ name: "ServiceTokenError", statusCode });
    },
  );

  it.each([
    ["the caller's role", CTX()],
    [
      "the caller's org",
      { userEmail: "admin@example.com", orgId: null, caller: "http" },
    ],
  ])(
    "answers a membership-store outage reading %s with a retryable 503",
    async (_label, ctx) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      dbExecuteMock.mockRejectedValueOnce(new Error("connection terminated"));
      await expect(
        createAction.run({ name: "ci" }, ctx as any),
      ).rejects.toMatchObject({ name: "ServiceTokenError", statusCode: 503 });
      expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [403, CTX()],
    [400, { userEmail: "admin@example.com", orgId: null, caller: "http" }],
  ])(
    "still answers %i when the template has no org tables",
    async (statusCode, ctx) => {
      dbExecuteMock.mockRejectedValueOnce(
        new Error('relation "org_members" does not exist'),
      );
      await expect(
        createAction.run({ name: "ci" }, ctx as any),
      ).rejects.toMatchObject({ name: "ServiceTokenError", statusCode });
      expect(mintOrgServiceTokenMock).not.toHaveBeenCalled();
    },
  );
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

  it("merges tokens and policies into one principal per service name", async () => {
    const tok = (
      id: string,
      serviceName: string,
      revokedAt: number | null,
    ) => ({
      id,
      jti: id,
      ownerEmail: `svc-${serviceName}@service.org-1`,
      orgId: "org-1",
      label: serviceName,
      kind: "service",
      serviceName,
      createdBy: "admin@example.com",
      createdAt: 1,
      lastUsedAt: null,
      revokedAt,
    });
    listOrgServiceTokensMock.mockResolvedValue([
      tok("t1", "legacy", null),
      tok("t2", "ci", null),
      tok("t3", "ci", 5),
      tok("t4", "gone", 5),
    ]);
    listPoliciesMock.mockResolvedValue([
      {
        serviceName: "ci",
        ownerEmail: "o@example.com",
        team: "platform",
        riskTier: "high",
        purpose: "release",
        lifecycle: "suspended",
        allowedActions: ["list-*"],
        lifecycleReason: "incident",
        lifecycleChangedBy: "admin@example.com",
        lifecycleChangedAt: 9,
      },
      { serviceName: "policy-only", lifecycle: "active", riskTier: "low" },
    ]);
    setRole("member");
    const res = await listAction.run({}, CTX());
    expect(res.canManage).toBe(false);
    expect(res.principals.map((p: any) => p.serviceName)).toEqual([
      "ci",
      "gone",
      "legacy",
      "policy-only",
    ]);
    const byName = Object.fromEntries(
      res.principals.map((p: any) => [p.serviceName, p]),
    );
    expect(byName.legacy).toMatchObject({
      state: "ungoverned",
      ownerEmail: null,
      riskTier: null,
      allowedActions: null,
      serviceEmail: "svc-legacy@service.org-1",
    });
    expect(byName.ci).toMatchObject({
      state: "suspended",
      ownerEmail: "o@example.com",
      team: "platform",
      riskTier: "high",
      allowedActions: ["list-*"],
      lifecycleReason: "incident",
      lifecycleChangedBy: "admin@example.com",
      lifecycleChangedAt: 9,
    });
    expect(byName["policy-only"].state).toBe("active");
    // `tokens` keeps its existing shape and revoked filter.
    expect(res.tokens.map((t: any) => t.id)).toEqual(["t1", "t2"]);
  });

  it("tells admins they can manage", async () => {
    expect((await listAction.run({}, CTX())).canManage).toBe(true);
  });

  it("answers an unreadable policy store with 503, not an all-ungoverned list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listPoliciesMock.mockRejectedValue(new Error("db down"));
    await expect(listAction.run({}, CTX())).rejects.toMatchObject({
      statusCode: 503,
    });
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
