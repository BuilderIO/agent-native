import { beforeEach, describe, expect, it, vi } from "vitest";

const listOrgServiceTokensMock = vi.fn();
const revokeByNameMock = vi.fn();
const ensureConnectTablesMock = vi.fn();
vi.mock("../connect-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../connect-store.js")>()),
  ensureConnectTables: (...a: any[]) => ensureConnectTablesMock(...a),
  listOrgServiceTokens: (...a: any[]) => listOrgServiceTokensMock(...a),
  revokeServiceTokensByName: (...a: any[]) => revokeByNameMock(...a),
}));

const getPolicyMock = vi.fn();
const upsertPolicyMock = vi.fn();
const setLifecycleMock = vi.fn();
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
  setServicePrincipalLifecycle: (...a: any[]) => setLifecycleMock(...a),
}));

const isOrgMemberMock = vi.fn();
vi.mock("../../org/membership.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../org/membership.js")>()),
  isOrgMember: (...a: any[]) => isOrgMemberMock(...a),
}));

const containMock = vi.fn();
const prepareContainmentMock = vi.fn();
vi.mock("../../agent/contain-principal.js", () => ({
  prepareServicePrincipalContainment: (...a: any[]) =>
    prepareContainmentMock(...a),
  containServicePrincipal: (...a: any[]) => containMock(...a),
}));

const recordAuditMock = vi.fn(async (_input: any) => {});
vi.mock("../../audit/org-admin.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../audit/org-admin.js")>()),
  recordOrgAdminAuditEvent: (input: any) => recordAuditMock(input),
}));

const roleRows: Array<{ role: string }> = [];
const dbCalls: Array<{ sql: string; args?: unknown[] }> = [];
const executeMock = vi.fn(
  async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : input.args;
    dbCalls.push({ sql, args });
    return {
      rows: /FROM org_members/i.test(sql) ? roleRows : [],
      rowsAffected: 0,
    };
  },
);
let transactionActive = false;
const transactionMock = vi.fn(async (run: (tx: any) => Promise<unknown>) => {
  transactionActive = true;
  try {
    return await run({ execute: executeMock });
  } finally {
    transactionActive = false;
  }
});
vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({ execute: executeMock, transaction: transactionMock }),
}));

const policyAction = (await import("./set-service-principal-policy.js"))
  .default;
const lifecycleAction = (await import("./set-service-principal-lifecycle.js"))
  .default;
const { allowedActionsSchema, riskTierSchema } =
  await import("./service-principal-input.js");
const { ServicePrincipalRetiredError } =
  await import("../../org/service-principal-policy.js");

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

const policy = (over: Record<string, unknown> = {}) => ({
  orgId: "org-1",
  serviceName: "ci",
  ownerEmail: "owner@example.com",
  team: null,
  riskTier: "medium",
  purpose: null,
  lifecycle: "active",
  allowedActions: null,
  lifecycleReason: null,
  lifecycleChangedBy: null,
  lifecycleChangedAt: null,
  ...over,
});

const token = (id: string, revokedAt: number | null = null, name = "ci") => ({
  id,
  serviceName: name,
  ownerEmail: `svc-${name}@service.org-1`,
  revokedAt,
});

beforeEach(() => {
  vi.clearAllMocks();
  transactionActive = false;
  dbCalls.length = 0;
  setRole("admin");
  isOrgMemberMock.mockResolvedValue(true);
  getPolicyMock.mockResolvedValue(policy());
  listOrgServiceTokensMock.mockResolvedValue([token("t1")]);
  ensureConnectTablesMock.mockResolvedValue(undefined);
  revokeByNameMock.mockResolvedValue(0);
  upsertPolicyMock.mockImplementation(async (_o, _n, input) =>
    policy(input as any),
  );
  setLifecycleMock.mockImplementation(async (_o, _n, lifecycle, change) =>
    policy({
      lifecycle,
      lifecycleReason: change.reason,
      lifecycleChangedBy: change.actorEmail,
      lifecycleChangedAt: 1,
    }),
  );
  containMock.mockResolvedValue({ abortedRuns: 2, containmentErrors: [] });
  prepareContainmentMock.mockResolvedValue(undefined);
});

describe("governance actions are admin-only and out of the agent tool loop", () => {
  it("is not tool-callable", () => {
    expect(policyAction.toolCallable).toBe(false);
    expect(lifecycleAction.toolCallable).toBe(false);
  });

  it.each([
    ["policy", () => policyAction.run({ serviceName: "ci", team: "x" }, CTX())],
    [
      "lifecycle",
      () =>
        lifecycleAction.run(
          { serviceName: "ci", lifecycle: "suspended" },
          CTX(),
        ),
    ],
  ])(
    "refuses a plain member (%s) with 403 and changes nothing",
    async (_n, call) => {
      setRole("member");
      await expect(call()).rejects.toMatchObject({ statusCode: 403 });
      expect(upsertPolicyMock).not.toHaveBeenCalled();
      expect(setLifecycleMock).not.toHaveBeenCalled();
      expect(containMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a synthetic service identity (never a member) with 403", async () => {
    setRole(null);
    await expect(
      lifecycleAction.run(
        { serviceName: "ci", lifecycle: "active" },
        CTX({ userEmail: "svc-ci@service.org-1" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(setLifecycleMock).not.toHaveBeenCalled();
  });

  it("holds the principal lifecycle lock through suspension containment", async () => {
    containMock.mockImplementationOnce(async () => {
      expect(transactionActive).toBe(true);
      return { abortedRuns: 2, containmentErrors: [] };
    });
    await lifecycleAction.run(
      { serviceName: "ci", lifecycle: "suspended" },
      CTX(),
    );

    const lockCall = dbCalls.find((call) =>
      call.sql.includes("pg_advisory_xact_lock"),
    );
    expect(lockCall?.args).toEqual([
      "agent-native:service-principal-lifecycle:org-1:ci",
    ]);
    expect(transactionMock).toHaveBeenCalled();
    expect(setLifecycleMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      executeMock.mock.invocationCallOrder.find((_, index) =>
        dbCalls[index]?.sql.includes("pg_advisory_xact_lock"),
      ) ?? 0,
    );
    expect(containMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      setLifecycleMock.mock.invocationCallOrder[0],
    );
  });

  it("answers 404 for a name with neither a token nor a policy", async () => {
    getPolicyMock.mockResolvedValue(null);
    listOrgServiceTokensMock.mockResolvedValue([token("t9", null, "other")]);
    await expect(
      policyAction.run({ serviceName: "ci", team: "x" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("answers 503 instead of 404 when the service-token store is unreadable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPolicyMock.mockResolvedValue(null);
    listOrgServiceTokensMock.mockRejectedValue(new Error("connection lost"));

    await expect(
      policyAction.run({ serviceName: "ci", team: "x" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(upsertPolicyMock).not.toHaveBeenCalled();
  });
});

describe("set-service-principal-policy", () => {
  it("does not create a governance row for a no-field update", async () => {
    getPolicyMock.mockResolvedValue(null);

    const result = await policyAction.run({ serviceName: "ci" }, CTX());

    expect(upsertPolicyMock).not.toHaveBeenCalled();
    expect(result.changedFields).toEqual([]);
    expect(result.principal.state).toBe("ungoverned");
  });

  it("saves validated fields and reports which changed", async () => {
    const res = await policyAction.run(
      {
        serviceName: "CI",
        ownerEmail: "New@Example.com",
        riskTier: "high",
        allowedActions: ["list-*", "get-plan", "get-plan"],
      },
      CTX(),
    );
    expect(isOrgMemberMock).toHaveBeenCalledWith("org-1", "new@example.com");
    expect(upsertPolicyMock).toHaveBeenCalledWith("org-1", "ci", {
      ownerEmail: "new@example.com",
      riskTier: "high",
      allowedActions: ["list-*", "get-plan"],
    });
    expect(res.changedFields).toEqual([
      "ownerEmail",
      "riskTier",
      "allowedActions",
    ]);
    expect(res.principal).toMatchObject({
      serviceName: "ci",
      state: "active",
      serviceEmail: "svc-ci@service.org-1",
    });
  });

  it("passes null through to clear a field or lift the grant", async () => {
    await policyAction.run(
      { serviceName: "ci", allowedActions: null, team: null },
      CTX(),
    );
    expect(upsertPolicyMock).toHaveBeenCalledWith("org-1", "ci", {
      allowedActions: null,
      team: null,
    });
  });

  it("refuses an owner who is not an org member, or is a service identity", async () => {
    isOrgMemberMock.mockResolvedValue(false);
    await expect(
      policyAction.run({ serviceName: "ci", ownerEmail: "x@y.com" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      policyAction.run(
        { serviceName: "ci", ownerEmail: "svc-a@service.org.example" },
        CTX(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertPolicyMock).not.toHaveBeenCalled();
  });

  it("answers an unreadable membership store with 503, not 'not a member'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isOrgMemberMock.mockRejectedValue(new Error("db down"));
    await expect(
      policyAction.run({ serviceName: "ci", ownerEmail: "x@y.com" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("answers a failed write with 503 instead of a success shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    upsertPolicyMock.mockRejectedValue(new Error("write failed"));
    await expect(
      policyAction.run({ serviceName: "ci", team: "x" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("audits to org admins with counts only, never the grant list", async () => {
    const args = {
      serviceName: "ci",
      allowedActions: ["secret-action-name", "other-*"],
    };
    const res = await policyAction.run(args, CTX());
    const audit = policyAction.audit as any;
    expect(audit.recordInputs).toBe(false);
    expect(audit.target(args, res, { orgId: "org-1" } as any)).toMatchObject({
      type: "service-principal",
      id: "ci",
      orgId: "org-1",
      visibility: "admins",
    });
    const summary = audit.summary(args, res, {} as any);
    expect(summary).toContain("svc-ci@service.org-1");
    expect(summary).toContain("allowedActions: 2 entries");
    expect(summary).not.toContain("secret-action-name");
  });
});

describe("service-principal input validation", () => {
  it.each(["list-*", "get-plan", "a.b:c_d-e", "x*"])("accepts %s", (v) => {
    expect(allowedActionsSchema.safeParse([v]).success).toBe(true);
  });

  it.each(["", "*", "a**", "a*b", "has space", "x".repeat(129), "a/b"])(
    "rejects %j",
    (v) => {
      expect(allowedActionsSchema.safeParse([v]).success).toBe(false);
    },
  );

  it("caps the list at 200 entries and allows an empty list", () => {
    expect(allowedActionsSchema.safeParse([]).success).toBe(true);
    expect(
      allowedActionsSchema.safeParse(
        Array.from({ length: 200 }, (_, i) => `a${i}`),
      ).success,
    ).toBe(true);
    expect(
      allowedActionsSchema.safeParse(
        Array.from({ length: 201 }, (_, i) => `a${i}`),
      ).success,
    ).toBe(false);
  });

  it("accepts only the three risk tiers", () => {
    expect(riskTierSchema.safeParse("high").success).toBe(true);
    expect(riskTierSchema.safeParse("critical").success).toBe(false);
  });
});

describe("set-service-principal-lifecycle", () => {
  it("returns 409 when a retired principal cannot be resumed", async () => {
    setLifecycleMock.mockRejectedValueOnce(new ServicePrincipalRetiredError());
    await expect(
      lifecycleAction.run({ serviceName: "ci", lifecycle: "active" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(containMock).not.toHaveBeenCalled();
    expect(revokeByNameMock).not.toHaveBeenCalled();
  });

  it("suspends: writes the lifecycle first, then aborts in-flight runs", async () => {
    const order: string[] = [];
    setLifecycleMock.mockImplementationOnce(async (_o, _n, lifecycle) => {
      order.push("lifecycle");
      return policy({ lifecycle });
    });
    containMock.mockImplementationOnce(async () => {
      order.push("contain");
      return { abortedRuns: 3, containmentErrors: [] };
    });
    const res = await lifecycleAction.run(
      { serviceName: "ci", lifecycle: "suspended", reason: "incident" },
      CTX(),
    );
    expect(order).toEqual(["lifecycle", "contain"]);
    expect(setLifecycleMock).toHaveBeenCalledWith(
      "org-1",
      "ci",
      "suspended",
      {
        actorEmail: "admin@example.com",
        reason: "incident",
      },
      expect.objectContaining({ execute: expect.any(Function) }),
    );
    expect(containMock).toHaveBeenCalledWith("org-1", "ci");
    expect(res).toMatchObject({
      lifecycle: "suspended",
      abortedRuns: 3,
      revokedTokens: 0,
      contained: true,
      containmentErrors: [],
    });
    // Suspended keeps its tokens; they are refused at admission instead.
    expect(revokeByNameMock).not.toHaveBeenCalled();
  });

  it("retired also revokes every active token of that service in one call", async () => {
    revokeByNameMock.mockResolvedValue(2);
    const res = await lifecycleAction.run(
      { serviceName: "ci", lifecycle: "retired" },
      CTX(),
    );
    expect(revokeByNameMock).toHaveBeenCalledTimes(1);
    expect(revokeByNameMock).toHaveBeenCalledWith("org-1", "ci");
    expect(res).toMatchObject({
      abortedRuns: 2,
      revokedTokens: 2,
      contained: true,
    });
  });

  it("reports a failed token revoke as a containment error, not 0 revoked", async () => {
    revokeByNameMock.mockRejectedValue(new Error("connection terminated"));
    const res = await lifecycleAction.run(
      { serviceName: "ci", lifecycle: "retired" },
      CTX(),
    );
    expect(res.contained).toBe(false);
    expect(res.revokedTokens).toBe(0);
    expect(res.containmentErrors).toEqual([
      "revoke tokens: connection terminated",
    ]);
  });

  it("resuming does not contain anything", async () => {
    const res = await lifecycleAction.run(
      { serviceName: "ci", lifecycle: "active" },
      CTX(),
    );
    expect(containMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ lifecycle: "active", contained: true });
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("surfaces a partial containment loudly instead of looking complete", async () => {
    containMock.mockResolvedValue({
      abortedRuns: 1,
      containmentErrors: ["run-9: still running after abort"],
    });
    revokeByNameMock.mockResolvedValue(1);
    const res = await lifecycleAction.run(
      { serviceName: "ci", lifecycle: "retired" },
      CTX(),
    );
    expect(res.contained).toBe(false);
    expect(res.revokedTokens).toBe(1);
    expect(res.containmentErrors).toEqual(["run-9: still running after abort"]);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("reports a thrown containment as an error, with the suspend already in force", async () => {
    containMock.mockRejectedValue(new Error("run store down"));
    const res = await lifecycleAction.run(
      { serviceName: "ci", lifecycle: "suspended" },
      CTX(),
    );
    expect(setLifecycleMock).toHaveBeenCalled();
    expect(res.contained).toBe(false);
    expect(res.containmentErrors).toEqual(["abort runs: run store down"]);
  });

  it("answers a failed lifecycle write with 503 and does not contain", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLifecycleMock.mockRejectedValue(new Error("write failed"));
    await expect(
      lifecycleAction.run({ serviceName: "ci", lifecycle: "suspended" }, CTX()),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(containMock).not.toHaveBeenCalled();
  });

  it("records the org-admin audit events (lifecycle change and containment)", async () => {
    const args = { serviceName: "ci", lifecycle: "suspended" as const };
    const res = await lifecycleAction.run(args, CTX());
    const audit = lifecycleAction.audit as any;
    expect(audit.target(args, res, { orgId: "org-1" } as any)).toMatchObject({
      type: "service-principal",
      id: "ci",
      visibility: "admins",
    });
    expect(audit.summary(args, res, {} as any)).toBe(
      "Set svc-ci@service.org-1 to suspended: 2 runs aborted, 0 tokens revoked",
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contain-service-principal",
        targetType: "service-principal",
        targetId: "ci",
        orgId: "org-1",
        userEmail: "admin@example.com",
        status: "success",
      }),
    );
  });
});
