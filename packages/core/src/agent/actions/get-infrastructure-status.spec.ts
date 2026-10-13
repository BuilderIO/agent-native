import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roles: new Map<string, "owner" | "admin" | "member">(),
  status: { workspace: true } as Record<string, unknown>,
  getInfrastructureStatus: vi.fn(),
  trustedSelfHosted: false,
}));

vi.mock("../../server/credential-provider.js", () => ({
  isTrustedSelfHostedRuntime: () => mocks.trustedSelfHosted,
}));

vi.mock("../../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async (orgId: string, email: string) =>
    mocks.roles.get(`${orgId}:${email}`) ?? null,
}));

vi.mock("../../server/infrastructure-status.js", () => ({
  getInfrastructureStatus: mocks.getInfrastructureStatus,
}));

const { default: action, INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE } =
  await import("./get-infrastructure-status.js");

const ctx = (email: string | undefined, orgId: string | null = "org-1") => ({
  actionName: "get-infrastructure-status",
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "clips",
});

async function failure(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error as { statusCode?: number; errorCode?: string };
  }
  throw new Error("expected the action to fail");
}

beforeEach(() => {
  mocks.roles.clear();
  mocks.trustedSelfHosted = false;
  mocks.getInfrastructureStatus.mockReset();
  mocks.getInfrastructureStatus.mockReturnValue(mocks.status);
  mocks.roles.set("org-1:owner@example.com", "owner");
  mocks.roles.set("org-1:admin@example.com", "admin");
  mocks.roles.set("org-1:member@example.com", "member");
});

describe("get-infrastructure-status", () => {
  it("is a read-only GET that sandboxed extensions can't call", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.toolCallable).toBe(false);
  });

  it("returns the status for owners and admins, for the calling app", async () => {
    await expect(action.run({}, ctx("owner@example.com"))).resolves.toBe(
      mocks.status,
    );
    await expect(action.run({}, ctx("Admin@Example.com"))).resolves.toBe(
      mocks.status,
    );
    expect(mocks.getInfrastructureStatus).toHaveBeenCalledWith({
      appId: "clips",
    });
  });

  it("refuses members with a typed 403 and never reads the environment", async () => {
    const error = await failure(action.run({}, ctx("member@example.com")));
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe(INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE);
    expect(mocks.getInfrastructureStatus).not.toHaveBeenCalled();
  });

  it("refuses people outside the organization", async () => {
    const error = await failure(action.run({}, ctx("stranger@example.com")));
    expect(error.statusCode).toBe(403);
    expect(mocks.getInfrastructureStatus).not.toHaveBeenCalled();
  });

  it("requires a signed-in caller", async () => {
    const error = await failure(action.run({}, ctx(undefined)));
    expect(error.statusCode).toBe(401);
  });

  it("lets a caller with no organization read it on a single-tenant self-hosted deployment", async () => {
    mocks.trustedSelfHosted = true;
    await expect(action.run({}, ctx("solo@example.com", null))).resolves.toBe(
      mocks.status,
    );
  });

  it("refuses a caller with no organization on a shared deployment", async () => {
    const error = await failure(
      action.run({}, ctx("signup@example.com", null)),
    );
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe(INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE);
    expect(mocks.getInfrastructureStatus).not.toHaveBeenCalled();
  });
});
