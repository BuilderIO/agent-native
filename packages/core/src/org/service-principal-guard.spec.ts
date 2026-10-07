import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(async () => {}),
}));
const recordActionAuditMock = vi.fn(async (_input: any) => {});
vi.mock("../audit/record.js", () => ({
  recordActionAudit: (input: any) => recordActionAuditMock(input),
}));

const {
  assertServicePrincipalMayCall,
  assertServicePrincipalMayRun,
  recordServicePrincipalDenial,
  ServicePrincipalRefusedError,
} = await import("./service-principal-guard.js");

const SVC = "svc-ci@service.org_1";

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    org_id: "org_1",
    service_name: "ci",
    risk_tier: "medium",
    lifecycle: "active",
    allowed_actions: null,
    ...overrides,
  };
}

function storeReturns(row: Record<string, unknown> | null) {
  executeMock.mockResolvedValue({ rows: row ? [row] : [], rowsAffected: 0 });
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(ServicePrincipalRefusedError);
  return error as InstanceType<typeof ServicePrincipalRefusedError>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertServicePrincipalMayRun", () => {
  it("never queries the policy store for a non-service caller", async () => {
    await expect(
      assertServicePrincipalMayRun("alice@example.com", "org_1"),
    ).resolves.toEqual({ allowedActions: null });
    await expect(assertServicePrincipalMayRun(undefined)).resolves.toEqual({
      allowedActions: null,
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("leaves a legacy principal with no policy row unrestricted", async () => {
    storeReturns(null);
    await expect(assertServicePrincipalMayRun(SVC, "org_1")).resolves.toEqual({
      allowedActions: null,
    });
  });

  it("returns the grant of an active governed principal", async () => {
    storeReturns(policyRow({ allowed_actions: JSON.stringify(["read-*"]) }));
    await expect(assertServicePrincipalMayRun(SVC, "org_1")).resolves.toEqual({
      allowedActions: ["read-*"],
    });
  });

  it.each([
    "",
    JSON.stringify(["*"]),
    JSON.stringify(["read-*", "*"]),
    JSON.stringify(["read-*", 42]),
  ])("fails closed for invalid stored grants: %s", async (allowedActions) => {
    storeReturns(policyRow({ allowed_actions: allowedActions }));
    const admission = await assertServicePrincipalMayRun(SVC, "org_1");
    expect(admission).toEqual({ allowedActions: [] });
    expect(() =>
      assertServicePrincipalMayCall(admission.allowedActions, "read-thing"),
    ).toThrow(ServicePrincipalRefusedError);
  });

  it.each(["suspended", "retired"])(
    "refuses a %s principal with a 403",
    async (lifecycle) => {
      storeReturns(policyRow({ lifecycle }));
      const error = await refusal(assertServicePrincipalMayRun(SVC, "org_1"));
      expect(error.statusCode).toBe(403);
      expect(error.errorCode).toBe("service_principal_inactive");
    },
  );

  it("refuses with a retryable 503 when the policy cannot be read", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await refusal(assertServicePrincipalMayRun(SVC, "org_1"));
    expect(error.statusCode).toBe(503);
    expect(error.errorCode).toBe("service_principal_unavailable");
  });
});

describe("assertServicePrincipalMayCall", () => {
  it("allows everything when the grant is null", () => {
    expect(() =>
      assertServicePrincipalMayCall(null, "any-action"),
    ).not.toThrow();
  });

  it("allows exact and prefix-wildcard grants only", () => {
    expect(() =>
      assertServicePrincipalMayCall(["list-docs", "read-*"], "list-docs"),
    ).not.toThrow();
    expect(() =>
      assertServicePrincipalMayCall(["list-docs", "read-*"], "read-thing"),
    ).not.toThrow();
    expect(() =>
      assertServicePrincipalMayCall(["list-docs", "read-*"], "delete-doc"),
    ).toThrow(ServicePrincipalRefusedError);
  });

  it("is deny-by-default for an empty grant", () => {
    expect(() => assertServicePrincipalMayCall([], "list-docs")).toThrow(
      ServicePrincipalRefusedError,
    );
    expect(() => assertServicePrincipalMayCall(["*"], "list-docs")).toThrow(
      ServicePrincipalRefusedError,
    );
  });
});

describe("recordServicePrincipalDenial", () => {
  it("writes a denied audit row, visible to admins", async () => {
    let error: any;
    try {
      assertServicePrincipalMayCall([], "delete-doc");
    } catch (e) {
      error = e;
    }
    await recordServicePrincipalDenial({
      email: SVC,
      orgId: "org_1",
      actionName: "delete-doc",
      caller: "mcp",
      error,
    });
    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
    const input = recordActionAuditMock.mock.calls[0][0];
    expect(input.ctx).toMatchObject({
      actionName: "delete-doc",
      caller: "mcp",
      userEmail: SVC,
      orgId: "org_1",
    });
    expect(input.error.statusCode).toBe(403);
    expect(input.config.target()).toMatchObject({
      orgId: "org_1",
      visibility: "admins",
    });
  });

  it("derives the admin audit scope from the service identity when omitted", async () => {
    let error: any;
    try {
      assertServicePrincipalMayCall([], "delete-doc");
    } catch (e) {
      error = e;
    }
    await recordServicePrincipalDenial({
      email: SVC,
      actionName: "delete-doc",
      caller: "mcp",
      error,
    });

    const input = recordActionAuditMock.mock.calls[0][0];
    expect(input.ctx.orgId).toBe("org_1");
    expect(input.config.target()).toMatchObject({
      orgId: "org_1",
      visibility: "admins",
    });
  });

  it("does not record a retryable unavailable refusal as a denial", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await refusal(assertServicePrincipalMayRun(SVC, "org_1"));
    await recordServicePrincipalDenial({
      email: SVC,
      orgId: "org_1",
      actionName: "list-docs",
      caller: "mcp",
      error,
    });
    expect(recordActionAuditMock).not.toHaveBeenCalled();
  });
});
