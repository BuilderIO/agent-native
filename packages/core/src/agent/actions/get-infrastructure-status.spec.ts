import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roles: new Map<string, "owner" | "admin" | "member">(),
  status: {
    workspace: true,
    database: {
      configured: false,
      local: true,
      provider: "pglite",
      host: null,
      sourceKey: null,
      appDatabaseKey: null,
    },
    hosting: {
      platform: "local",
      environment: "local",
      apps: [],
      gatewayUrl: null,
    },
    variables: [],
    setupTags: {
      model: null,
      storage: null,
      voice: null,
      images: null,
      embeddings: null,
    },
  } as Record<string, unknown>,
  getInfrastructureStatus: vi.fn(),
  trustedSelfHosted: false,
  getActiveGoogleSignInCredentials: vi.fn(),
  resolveGoogleSignInCredentials: vi.fn(),
  resolveGoogleProviderCredentials: vi.fn(),
  resolveGoogleLegacyProviderCredentials: vi.fn(),
}));

vi.mock("../../server/credential-provider.js", () => ({
  isTrustedSelfHostedRuntime: () => mocks.trustedSelfHosted,
}));

vi.mock("../../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async (orgId: string, email: string) =>
    mocks.roles.get(`${orgId}:${email}`) ?? null,
}));

vi.mock("../../server/infrastructure-status.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/infrastructure-status.js")
  >()),
  getInfrastructureStatus: mocks.getInfrastructureStatus,
}));

vi.mock("../../server/google-oauth-credentials.js", () => ({
  getActiveGoogleSignInCredentials: mocks.getActiveGoogleSignInCredentials,
  resolveGoogleSignInCredentials: mocks.resolveGoogleSignInCredentials,
  resolveGoogleProviderCredentials: mocks.resolveGoogleProviderCredentials,
  resolveGoogleLegacyProviderCredentials:
    mocks.resolveGoogleLegacyProviderCredentials,
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
  mocks.getActiveGoogleSignInCredentials.mockReset().mockReturnValue({
    credentials: null,
    recorded: false,
    version: 0,
  });
  mocks.resolveGoogleSignInCredentials.mockReset().mockReturnValue(null);
  mocks.resolveGoogleProviderCredentials.mockReset().mockReturnValue(null);
  mocks.resolveGoogleLegacyProviderCredentials
    .mockReset()
    .mockReturnValue(null);
  mocks.roles.set("org-1:owner@example.com", "owner");
  mocks.roles.set("org-1:admin@example.com", "admin");
  mocks.roles.set("org-1:member@example.com", "member");
});

describe("get-infrastructure-status", () => {
  it("is a read-only GET that sandboxed extensions can't call", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.toolCallable).toBe(false);
    expect(
      action.schema.parse({ includeGoogleCredentialFingerprints: "true" }),
    ).toEqual({ includeGoogleCredentialFingerprints: true });
    expect(
      action.schema.parse({ includeGoogleCredentialFingerprints: "false" }),
    ).toEqual({ includeGoogleCredentialFingerprints: false });
  });

  it("returns the status for owners and admins, for the calling app", async () => {
    await expect(action.run({}, ctx("owner@example.com"))).resolves.toEqual(
      mocks.status,
    );
    await expect(action.run({}, ctx("Admin@Example.com"))).resolves.toEqual(
      mocks.status,
    );
    expect(mocks.getInfrastructureStatus).toHaveBeenCalledWith({
      appId: "clips",
    });
    expect(mocks.getActiveGoogleSignInCredentials).not.toHaveBeenCalled();
  });

  it("returns fingerprints for the actual active pair and configured credential candidates only on opt-in", async () => {
    const activeSecret = "fake-active-google-secret-0123456789";
    const preferredSecret = "fake-preferred-google-secret-abcdefgh";
    const primarySecret = "fake-primary-google-secret-12345678";
    const legacySecret = "fake1234";
    mocks.getActiveGoogleSignInCredentials.mockReturnValue({
      credentials: {
        clientId: "active-client.apps.googleusercontent.com",
        clientSecret: activeSecret,
      },
      recorded: true,
      version: 1,
    });
    mocks.resolveGoogleSignInCredentials.mockReturnValue({
      clientId: "preferred-client.apps.googleusercontent.com",
      clientSecret: preferredSecret,
    });
    mocks.resolveGoogleProviderCredentials.mockReturnValue({
      clientId: "primary-client.apps.googleusercontent.com",
      clientSecret: primarySecret,
    });
    mocks.resolveGoogleLegacyProviderCredentials.mockReturnValue({
      clientId: "legacy-client.apps.googleusercontent.com",
      clientSecret: legacySecret,
    });

    const result = await action.run(
      { includeGoogleCredentialFingerprints: true },
      ctx("owner@example.com"),
    );
    const fingerprint = (clientId: string, secret: string) => ({
      clientId,
      secretSha256: createHash("sha256").update(secret).digest("hex"),
      secretLast4: secret.length > 8 ? secret.slice(-4) : null,
    });

    expect(result.googleCredentialFingerprints).toEqual({
      activeSignInRecorded: true,
      activeSignIn: fingerprint(
        "active-client.apps.googleusercontent.com",
        activeSecret,
      ),
      preferredSignIn: fingerprint(
        "preferred-client.apps.googleusercontent.com",
        preferredSecret,
      ),
      primaryManaged: fingerprint(
        "primary-client.apps.googleusercontent.com",
        primarySecret,
      ),
      legacyManaged: fingerprint(
        "legacy-client.apps.googleusercontent.com",
        legacySecret,
      ),
    });
    expect(
      result.googleCredentialFingerprints?.legacyManaged?.secretLast4,
    ).toBe(null);
    const serialized = JSON.stringify(result);
    for (const secret of [
      activeSecret,
      preferredSecret,
      primarySecret,
      legacySecret,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps unavailable Google credential pairs explicitly null", async () => {
    const result = await action.run(
      { includeGoogleCredentialFingerprints: true },
      ctx("owner@example.com"),
    );

    expect(result.googleCredentialFingerprints).toEqual({
      activeSignInRecorded: false,
      activeSignIn: null,
      preferredSignIn: null,
      primaryManaged: null,
      legacyManaged: null,
    });
  });

  it("refuses members with a typed 403 and never reads the environment", async () => {
    const error = await failure(
      action.run(
        { includeGoogleCredentialFingerprints: true },
        ctx("member@example.com"),
      ),
    );
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe(INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE);
    expect(mocks.getInfrastructureStatus).not.toHaveBeenCalled();
    expect(mocks.getActiveGoogleSignInCredentials).not.toHaveBeenCalled();
    expect(mocks.resolveGoogleSignInCredentials).not.toHaveBeenCalled();
    expect(mocks.resolveGoogleProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.resolveGoogleLegacyProviderCredentials).not.toHaveBeenCalled();
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
    await expect(
      action.run({}, ctx("solo@example.com", null)),
    ).resolves.toEqual(mocks.status);
  });

  it("refuses credential fingerprints without an organization even on a trusted self-hosted deployment", async () => {
    mocks.trustedSelfHosted = true;
    const error = await failure(
      action.run(
        { includeGoogleCredentialFingerprints: true },
        ctx("solo@example.com", null),
      ),
    );
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe(INFRASTRUCTURE_ADMIN_REQUIRED_ERROR_CODE);
    expect(mocks.getInfrastructureStatus).not.toHaveBeenCalled();
    expect(mocks.getActiveGoogleSignInCredentials).not.toHaveBeenCalled();
    expect(mocks.resolveGoogleSignInCredentials).not.toHaveBeenCalled();
    expect(mocks.resolveGoogleProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.resolveGoogleLegacyProviderCredentials).not.toHaveBeenCalled();
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
