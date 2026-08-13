import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadAppSecret = vi.fn();
const mockReadAppSecrets = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();
const mockGetSetting = vi.fn();
const mockPutSetting = vi.fn();
const mockDeleteSetting = vi.fn();
const mockGetRequestUserEmail = vi.fn<[], string | undefined>();
const mockGetRequestOrgId = vi.fn<[], string | undefined>();
const mockIsLocalDatabase = vi.fn<[], boolean>();
const mockResolveOrgIdForEmail = vi.fn<[string], Promise<string | null>>();
const mockGetDbExec = vi.fn();

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
  readAppSecrets: (...args: any[]) => mockReadAppSecrets(...args),
  writeAppSecret: (...args: any[]) => mockWriteAppSecret(...args),
  deleteAppSecret: (...args: any[]) => mockDeleteAppSecret(...args),
}));
vi.mock("./request-context.js", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
  getRequestOrgId: () => mockGetRequestOrgId(),
}));
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: (...args: any[]) => mockResolveOrgIdForEmail(...args),
}));
vi.mock("../db/client.js", async (importOriginal) => ({
  // Real isTransientDatabaseError: "unreadable vs absent" is the behavior
  // under test here, so the classifier must not be stubbed.
  ...(await importOriginal<typeof import("../db/client.js")>()),
  isLocalDatabase: () => mockIsLocalDatabase(),
  getDbExec: () => mockGetDbExec(),
}));
vi.mock("../settings/store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
  putSetting: (...args: any[]) => mockPutSetting(...args),
  deleteSetting: (...args: any[]) => mockDeleteSetting(...args),
}));

import {
  GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
  isLlmCredentialError,
} from "../agent/engine/credential-errors.js";
import {
  BUILDER_AUTH_FAILURE_TTL_MS,
  builderCredentialFingerprint,
  canUseDeployCredentialFallbackForRequest,
  clearBuilderGatewayAuthFailure,
  CredentialStoreUnavailableError,
  getBuilderCredentialAuthFailure,
  gatewayLaneUnavailableMessage,
  getProviderCredentialAuthFailure,
  isBuilderGatewayDeployConfigured,
  providerCredentialFingerprint,
  recordBuilderCredentialAuthFailure,
  recordBuilderGatewayAuthFailure,
  recordProviderCredentialAuthFailure,
  resolveCredentialWriteScope,
  writeBuilderCredentials,
  deleteBuilderCredentials,
  resolveBuilderCredential,
  resolveBuilderCredentials,
  resolveBuilderCredentialsDetailed,
  resolveBuilderCredentialSource,
  resolveBuilderGatewayAuth,
  resolveBuilderGatewayCredentials,
  resolveBuilderGatewayCredentialsDetailed,
  resolveHasBuilderGatewayCredential,
  resolveHasBuilderPrivateKey,
  resolveHasCompleteBuilderConnection,
  resolveSecret,
  resolveSecretDetailed,
} from "./credential-provider.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const BUILDER_OPTIONAL_KEYS = [
  "BUILDER_IS_ENTERPRISE",
  "BUILDER_IS_FREE_ACCOUNT",
  "BUILDER_ORG_KIND",
  "BUILDER_ORG_NAME",
  "BUILDER_SUBSCRIPTION",
  "BUILDER_SUBSCRIPTION_LEVEL",
  "BUILDER_SUBSCRIPTION_NAME",
  "BUILDER_USER_ID",
] as const;
const BUILDER_ALL_KEYS = [
  ...BUILDER_OPTIONAL_KEYS,
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
].sort();

beforeEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
  delete process.env.AGENT_ENGINE;
  delete process.env.AGENT_NATIVE_WORKSPACE;
  delete process.env.VITE_AGENT_NATIVE_WORKSPACE;
  delete process.env.AGENT_NATIVE_WORKSPACE_APP_ID;
  delete process.env.VITE_AGENT_NATIVE_WORKSPACE_APP_ID;
  delete process.env.AGENT_NATIVE_LOCAL_BUILDER_ENV;
  delete process.env.AGENT_VAULT_ORG_ID;
  delete process.env.FUSION_ENVIRONMENT;
  delete process.env.FUSION_ENV_ORIGIN;
  delete process.env.VITE_FUSION_ENV_ORIGIN;
  delete process.env.NETLIFY;
  delete process.env.VERCEL;
  delete process.env.CF_PAGES;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.AWS_EXECUTION_ENV;
  delete process.env.FUNCTIONS_WORKER_RUNTIME;
  delete process.env.K_SERVICE;
  delete process.env.RENDER;
  delete process.env.BUILDER_PRIVATE_KEY;
  delete process.env.BUILDER_PUBLIC_KEY;
  delete process.env.BUILDER_USER_ID;
  delete process.env.BUILDER_ORG_NAME;
  delete process.env.BUILDER_ORG_KIND;
  delete process.env.BUILDER_SUBSCRIPTION;
  delete process.env.BUILDER_SUBSCRIPTION_LEVEL;
  delete process.env.BUILDER_SUBSCRIPTION_NAME;
  delete process.env.BUILDER_IS_ENTERPRISE;
  delete process.env.BUILDER_IS_FREE_ACCOUNT;
  delete process.env.BUILDER_GATEWAY_TOKEN;
  delete process.env.BUILDER_GATEWAY_SPACE_ID;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.EMAIL_AGENT_ADDRESS;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_INBOUND_WEBHOOK_SECRET;
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GITHUB_TOKEN;
  mockReadAppSecret.mockResolvedValue(null);
  mockReadAppSecrets.mockImplementation(
    async ({ keys, scope, scopeId }: any) => {
      const entries = await Promise.all(
        keys.map(async (key: string) => [
          key,
          await mockReadAppSecret({ key, scope, scopeId }),
        ]),
      );
      return new Map(entries.filter(([, secret]) => secret));
    },
  );
  mockWriteAppSecret.mockResolvedValue("id");
  mockDeleteAppSecret.mockResolvedValue(true);
  mockGetSetting.mockResolvedValue(null);
  mockPutSetting.mockResolvedValue(undefined);
  mockDeleteSetting.mockResolvedValue(true);
  mockGetRequestUserEmail.mockReturnValue(undefined);
  mockGetRequestOrgId.mockReturnValue(undefined);
  mockIsLocalDatabase.mockReturnValue(true);
  mockResolveOrgIdForEmail.mockResolvedValue(null);
  mockGetDbExec.mockReturnValue({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  });
});

describe("resolveCredentialWriteScope", () => {
  it("returns org scope for owner", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", "owner")).toEqual({
      scope: "org",
      scopeId: "org_1",
    });
  });

  it("returns org scope for admin", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", "admin")).toEqual({
      scope: "org",
      scopeId: "org_1",
    });
  });

  it("returns user scope for member", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", "member")).toEqual({
      scope: "user",
      scopeId: "a@b.com",
    });
  });

  it("returns user scope when no orgId, regardless of role", () => {
    expect(resolveCredentialWriteScope("a@b.com", null, "owner")).toEqual({
      scope: "user",
      scopeId: "a@b.com",
    });
  });

  it("returns user scope for unknown role", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", null)).toEqual({
      scope: "user",
      scopeId: "a@b.com",
    });
  });
});

describe("writeBuilderCredentials", () => {
  it("writes at user scope without options (legacy callers)", async () => {
    const target = await writeBuilderCredentials("a@b.com", {
      privateKey: "bpk-test-private",
      publicKey: "pub",
    });
    expect(target).toEqual({ scope: "user", scopeId: "a@b.com" });
    const scopes = mockWriteAppSecret.mock.calls.map((c) => c[0].scope);
    expect(scopes.every((s) => s === "user")).toBe(true);
  });

  it("writes at org scope for an owner of an active org", async () => {
    const target = await writeBuilderCredentials(
      "owner@b.com",
      { privateKey: "bpk-test-private", publicKey: "pub" },
      { orgId: "builder_io", role: "owner" },
    );
    expect(target).toEqual({ scope: "org", scopeId: "builder_io" });
    const calls = mockWriteAppSecret.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.scope === "org")).toBe(true);
    expect(calls.every((c) => c.scopeId === "builder_io")).toBe(true);
    const keys = calls.map((c) => c.key).sort();
    expect(keys).toEqual(["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"]);
  });

  it("writes at user scope for a plain member of an org", async () => {
    const target = await writeBuilderCredentials(
      "member@b.com",
      { privateKey: "bpk-test-private", publicKey: "pub" },
      { orgId: "builder_io", role: "member" },
    );
    expect(target).toEqual({ scope: "user", scopeId: "member@b.com" });
  });

  it("includes optional account metadata fields", async () => {
    await writeBuilderCredentials(
      "owner@b.com",
      {
        privateKey: "bpk-test-private",
        publicKey: "pub",
        userId: "u1",
        orgName: "Builder.io",
        orgKind: "team",
        subscription: "vcp:v3:level2",
        subscriptionLevel: "pro",
        subscriptionName: "Pro",
        isEnterprise: true,
        isFreeAccount: false,
      },
      { orgId: "builder_io", role: "owner" },
    );
    const keys = mockWriteAppSecret.mock.calls.map((c) => c[0].key).sort();
    expect(keys).toEqual(BUILDER_ALL_KEYS);
  });

  it("clears stale optional keys at target scope before writing the new connection", async () => {
    // Reconnecting with a Builder space that doesn't carry orgName/orgKind
    // must not leave the previous connection's metadata in place.
    await writeBuilderCredentials(
      "owner@b.com",
      { privateKey: "bpk-second-private", publicKey: "pub2" },
      { orgId: "builder_io", role: "owner" },
    );
    const deleteCalls = mockDeleteAppSecret.mock.calls.map((c) => c[0]);
    const orgDeletes = deleteCalls.filter(
      (c) => c.scope === "org" && c.scopeId === "builder_io",
    );
    expect(orgDeletes.map((c) => c.key).sort()).toEqual(BUILDER_ALL_KEYS);
  });

  it("clears the writer's user-scope override when writing at org scope so the new connection wins resolution", async () => {
    // Without this, a user who previously connected as a member (writing
    // at user scope) and is now an admin/owner reconnecting (writing at
    // org scope) would still see their stale personal credentials win on
    // the next chat call — `resolveScopedBuilderCredential` checks user
    // scope before org scope by design.
    await writeBuilderCredentials(
      "owner@b.com",
      { privateKey: "bpk-new-private", publicKey: "pub-new" },
      { orgId: "builder_io", role: "owner" },
    );
    const userDeletes = mockDeleteAppSecret.mock.calls
      .map((c) => c[0])
      .filter((c) => c.scope === "user" && c.scopeId === "owner@b.com");
    expect(userDeletes.map((c) => c.key).sort()).toEqual(BUILDER_ALL_KEYS);
  });

  it("does NOT touch the org-scope row when writing at user scope (other org members still need it)", async () => {
    await writeBuilderCredentials(
      "member@b.com",
      { privateKey: "bpk-test-private", publicKey: "pub" },
      { orgId: "builder_io", role: "member" },
    );
    const orgDeletes = mockDeleteAppSecret.mock.calls
      .map((c) => c[0])
      .filter((c) => c.scope === "org");
    expect(orgDeletes).toEqual([]);
  });

  it("writes happen AFTER deletes (so the cleanup doesn't race the new values)", async () => {
    // Capture call order across both mocks. We must see every delete
    // before any write, otherwise the cleanup could clobber the fresh row.
    const order: Array<"delete" | "write"> = [];
    mockDeleteAppSecret.mockImplementation(async () => {
      order.push("delete");
      return true;
    });
    mockWriteAppSecret.mockImplementation(async () => {
      order.push("write");
      return "id";
    });
    await writeBuilderCredentials(
      "owner@b.com",
      { privateKey: "bpk-test-private", publicKey: "pub" },
      { orgId: "builder_io", role: "owner" },
    );
    const firstWrite = order.indexOf("write");
    const lastDelete = order.lastIndexOf("delete");
    expect(firstWrite).toBeGreaterThan(-1);
    expect(lastDelete).toBeGreaterThan(-1);
    expect(lastDelete).toBeLessThan(firstWrite);
  });

  it("clears the auth-failure marker for the new key pair", async () => {
    await writeBuilderCredentials(
      "owner@b.com",
      { privateKey: "bpk-new-private", publicKey: "pub-new" },
      { orgId: "builder_io", role: "owner" },
    );
    const fingerprint = builderCredentialFingerprint(
      "bpk-new-private",
      "pub-new",
    );
    expect(mockDeleteSetting).toHaveBeenCalledWith(
      `builder-auth-failure:${fingerprint}`,
    );
  });

  it("rejects non-private-key credentials before clearing existing rows", async () => {
    await expect(
      writeBuilderCredentials(
        "owner@b.com",
        { privateKey: "btk-personal-access-token", publicKey: "pub" },
        { orgId: "builder_io", role: "owner" },
      ),
    ).rejects.toThrow("expected bpk-");

    expect(mockDeleteAppSecret).not.toHaveBeenCalled();
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("rejects blank public keys after trimming before clearing existing rows", async () => {
    await expect(
      writeBuilderCredentials(
        "owner@b.com",
        { privateKey: "bpk-test-private", publicKey: "   " },
        { orgId: "builder_io", role: "owner" },
      ),
    ).rejects.toThrow("public API key");

    expect(mockDeleteAppSecret).not.toHaveBeenCalled();
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("trims the returned Builder keys before storing them", async () => {
    await writeBuilderCredentials("owner@b.com", {
      privateKey: "  bpk-trimmed-private  ",
      publicKey: "  pub-trimmed  ",
    });

    expect(mockWriteAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "BUILDER_PRIVATE_KEY",
        value: "bpk-trimmed-private",
      }),
    );
    expect(mockWriteAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "BUILDER_PUBLIC_KEY",
        value: "pub-trimmed",
      }),
    );
  });
});

describe("Builder credential auth failure markers", () => {
  it("records gateway auth failures against a fingerprint without storing raw keys in the setting key", async () => {
    process.env.BUILDER_PRIVATE_KEY = "bpk-secret";
    process.env.BUILDER_PUBLIC_KEY = "pub-secret";

    await recordBuilderCredentialAuthFailure({
      status: 401,
      code: "unauthorized",
      message: "Invalid key",
    });

    expect(mockPutSetting).toHaveBeenCalledTimes(1);
    const [key, value] = mockPutSetting.mock.calls[0];
    expect(key).toMatch(/^builder-auth-failure:[a-f0-9]{24}$/);
    expect(key).not.toContain("bpk-secret");
    expect(key).not.toContain("pub-secret");
    expect(value).toMatchObject({
      message: "Invalid key",
      status: 401,
      code: "unauthorized",
      ownerEmail: null,
      orgId: null,
    });
  });

  it("reads an auth-failure marker for the same effective key pair", async () => {
    const at = Date.now();
    mockGetSetting.mockResolvedValue({
      message: "Invalid key",
      status: 401,
      code: "unauthorized",
      at,
    });

    const failure = await getBuilderCredentialAuthFailure({
      privateKey: "bpk-secret",
      publicKey: "pub-secret",
    });

    expect(failure).toMatchObject({
      fingerprint: builderCredentialFingerprint("bpk-secret", "pub-secret"),
      message: "Invalid key",
      status: 401,
      code: "unauthorized",
      at,
    });
    expect(mockGetSetting).toHaveBeenCalledWith(
      `builder-auth-failure:${builderCredentialFingerprint("bpk-secret", "pub-secret")}`,
    );
  });

  it("expires a stale marker instead of pinning the user to 'not connected'", async () => {
    mockGetSetting.mockResolvedValue({
      message: "Invalid key",
      status: 401,
      code: "unauthorized",
      at: Date.now() - BUILDER_AUTH_FAILURE_TTL_MS - 1,
    });

    const failure = await getBuilderCredentialAuthFailure({
      privateKey: "bpk-secret",
      publicKey: "pub-secret",
    });

    expect(failure).toBeNull();
    expect(mockDeleteSetting).toHaveBeenCalledWith(
      `builder-auth-failure:${builderCredentialFingerprint("bpk-secret", "pub-secret")}`,
    );
  });
});

describe("provider credential auth failure markers", () => {
  it("records provider auth failures against a fingerprint without storing raw keys in the setting key", async () => {
    await recordProviderCredentialAuthFailure({
      key: "OPENAI_API_KEY",
      value: "sk-example-invalid",
      status: 401,
      code: "http_401",
      message: "401 status code (no body)",
    });

    expect(mockPutSetting).toHaveBeenCalledTimes(1);
    const [key, value] = mockPutSetting.mock.calls[0];
    expect(key).toMatch(/^provider-auth-failure:[a-f0-9]{24}$/);
    expect(key).not.toContain("OPENAI_API_KEY");
    expect(key).not.toContain("sk-example-invalid");
    expect(value).toMatchObject({
      key: "OPENAI_API_KEY",
      message: "401 status code (no body)",
      status: 401,
      code: "http_401",
      ownerEmail: null,
      orgId: null,
    });
  });

  it("reads a provider auth-failure marker for the same effective key", async () => {
    const fingerprint = providerCredentialFingerprint(
      "OPENAI_API_KEY",
      "sk-example-invalid",
    );
    const at = Date.now();
    mockGetSetting.mockResolvedValue({
      fingerprint,
      key: "OPENAI_API_KEY",
      message: "Invalid key",
      status: 401,
      code: "http_401",
      at,
    });

    const failure = await getProviderCredentialAuthFailure({
      key: "OPENAI_API_KEY",
      value: "sk-example-invalid",
    });

    expect(failure).toMatchObject({
      fingerprint,
      key: "OPENAI_API_KEY",
      message: "Invalid key",
      status: 401,
      code: "http_401",
      at,
    });
    expect(mockGetSetting).toHaveBeenCalledWith(
      `provider-auth-failure:${fingerprint}`,
    );
  });

  it("expires stale provider auth-failure markers", async () => {
    const fingerprint = providerCredentialFingerprint(
      "OPENAI_API_KEY",
      "sk-example-invalid",
    );
    mockGetSetting.mockResolvedValue({
      fingerprint,
      key: "OPENAI_API_KEY",
      message: "Invalid key",
      status: 401,
      code: "http_401",
      at: Date.now() - 16 * 60 * 1000,
    });

    await expect(
      getProviderCredentialAuthFailure({
        key: "OPENAI_API_KEY",
        value: "sk-example-invalid",
      }),
    ).resolves.toBeNull();
    expect(mockDeleteSetting).toHaveBeenCalledWith(
      `provider-auth-failure:${fingerprint}`,
    );
  });
});

describe("deleteBuilderCredentials", () => {
  it("deletes at user scope without options", async () => {
    await deleteBuilderCredentials("a@b.com");
    const scopes = mockDeleteAppSecret.mock.calls.map((c) => c[0].scope);
    expect(scopes.every((s) => s === "user")).toBe(true);
  });

  it("deletes at org scope for an owner — undoes a connect that landed at org scope", async () => {
    const target = await deleteBuilderCredentials("owner@b.com", {
      orgId: "builder_io",
      role: "owner",
    });
    expect(target).toEqual({ scope: "org", scopeId: "builder_io" });
    expect(
      mockDeleteAppSecret.mock.calls.every((c) => c[0].scope === "org"),
    ).toBe(true);
  });

  it("deletes at user scope for a plain member — never nukes the org-shared row", async () => {
    const target = await deleteBuilderCredentials("member@b.com", {
      orgId: "builder_io",
      role: "member",
    });
    expect(target).toEqual({ scope: "user", scopeId: "member@b.com" });
  });
});

describe("resolveBuilderCredential", () => {
  it("returns null without a request user", async () => {
    mockGetRequestUserEmail.mockReturnValue(undefined);
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(mockReadAppSecret).not.toHaveBeenCalled();
  });

  it("returns request-scoped credentials before the env fallback", async () => {
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockReadAppSecret.mockResolvedValueOnce({
      value: "personal-key",
      last4: "-key",
      updatedAt: 1,
    });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "personal-key",
    );
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
  });

  it("falls back to env when no scoped Builder key exists", async () => {
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "deploy-key",
    );
    // user, org, workspace/orgId, and the always-on workspace/solo fallback.
    expect(mockReadAppSecret).toHaveBeenCalledTimes(4);
  });

  it("does not use deploy-level Builder keys for signed-in users on production shared databases", async () => {
    process.env.NODE_ENV = "production";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(canUseDeployCredentialFallbackForRequest()).toBe(false);
  });

  it("does not use deploy-level Builder keys for signed-in Netlify users even without NODE_ENV=production", async () => {
    process.env.NODE_ENV = "development";
    process.env.NETLIFY = "true";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    process.env.BUILDER_PUBLIC_KEY = "space-id";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(await resolveSecret("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(await resolveBuilderCredentialSource()).toBeNull();
    expect(canUseDeployCredentialFallbackForRequest()).toBe(false);
  });

  it("uses app-provided deploy-level LLM keys for signed-in hosted workspace users", async () => {
    process.env.NODE_ENV = "development";
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    process.env.BUILDER_PUBLIC_KEY = "space-id";
    process.env.ANTHROPIC_API_KEY = "anthropic-deploy-key";
    process.env.OPENAI_API_KEY = "openai-deploy-key";
    process.env.GITHUB_TOKEN = "github-deploy-token";
    // Fusion/workspace dev servers can still look "local" to DB detection
    // during startup, but their Builder env fallback must not impersonate the
    // signed-in user. App-provided LLM keys are allowed because they do not
    // identify the user; they let the app developer pay for model usage.
    mockIsLocalDatabase.mockReturnValue(true);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(await resolveSecret("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(await resolveBuilderCredentialSource()).toBeNull();
    expect(await resolveSecret("ANTHROPIC_API_KEY")).toBe(
      "anthropic-deploy-key",
    );
    expect(await resolveSecret("OPENAI_API_KEY")).toBe("openai-deploy-key");
    expect(await resolveSecret("GITHUB_TOKEN")).toBeNull();
    expect(canUseDeployCredentialFallbackForRequest()).toBe(false);
    expect(canUseDeployCredentialFallbackForRequest("OPENAI_API_KEY")).toBe(
      true,
    );
  });

  it("uses app-provided LLM env keys for signed-in production shared-database users", async () => {
    process.env.NODE_ENV = "production";
    process.env.ANTHROPIC_API_KEY = "anthropic-deploy-key";
    process.env.OPENAI_API_KEY = "openai-deploy-key";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveSecret("ANTHROPIC_API_KEY")).toBe(
      "anthropic-deploy-key",
    );
    expect(await resolveSecret("OPENAI_API_KEY")).toBe("openai-deploy-key");
    expect(await resolveSecret("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(canUseDeployCredentialFallbackForRequest()).toBe(false);
    expect(canUseDeployCredentialFallbackForRequest("ANTHROPIC_API_KEY")).toBe(
      true,
    );
  });

  it("uses app-provided email env keys for signed-in production shared-database users", async () => {
    process.env.NODE_ENV = "production";
    process.env.SENDGRID_API_KEY = "sendgrid-deploy-key";
    process.env.EMAIL_FROM = "Clips <clips@example.com>";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveSecret("SENDGRID_API_KEY")).toBe("sendgrid-deploy-key");
    expect(await resolveSecret("EMAIL_FROM")).toBe("Clips <clips@example.com>");
    expect(canUseDeployCredentialFallbackForRequest("SENDGRID_API_KEY")).toBe(
      true,
    );
    expect(canUseDeployCredentialFallbackForRequest("EMAIL_FROM")).toBe(true);
  });

  it("honors env Builder keys for a signed-in workspace user when the local dev escape hatch is set", async () => {
    process.env.NODE_ENV = "development";
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.AGENT_NATIVE_LOCAL_BUILDER_ENV = "1";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    process.env.BUILDER_PUBLIC_KEY = "space-id";
    mockIsLocalDatabase.mockReturnValue(true);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue(null);
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "deploy-key",
    );
  });

  it("does not honor the local dev escape hatch in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.AGENT_NATIVE_LOCAL_BUILDER_ENV = "1";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    process.env.BUILDER_PUBLIC_KEY = "space-id";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue(null);
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
  });

  it("falls back to org scope when no user-scope row exists", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce({ value: "org-key", last4: "-key", updatedAt: 1 });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "org-key",
    );
    const refs = mockReadAppSecret.mock.calls.map((c) => c[0]);
    expect(refs[0]).toEqual({
      key: "BUILDER_PRIVATE_KEY",
      scope: "user",
      scopeId: "member@b.com",
    });
    expect(refs[1]).toEqual({
      key: "BUILDER_PRIVATE_KEY",
      scope: "org",
      scopeId: "builder_io",
    });
  });

  it("falls back to workspace scope for legacy shared Builder rows", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce(null) // org scope miss
      .mockResolvedValueOnce({
        value: "workspace-key",
        last4: "-key",
        updatedAt: 1,
      });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "workspace-key",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0].scope)).toEqual([
      "user",
      "org",
      "workspace",
    ]);
  });

  it("user-scope override wins over org-scope row", async () => {
    mockGetRequestUserEmail.mockReturnValue("dev@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValueOnce({
      value: "personal-key",
      last4: "-key",
      updatedAt: 1,
    });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "personal-key",
    );
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
  });

  it("returns null when no scoped Builder row has the key", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
  });

  it("does not trace Builder credential scope resolution by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      mockGetRequestUserEmail.mockReturnValue("member@b.com");
      mockGetRequestOrgId.mockReturnValue("builder_io");
      mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
        value: "org-key",
        last4: "-key",
        updatedAt: 1,
      });

      expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
        "org-key",
      );
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("checks solo workspace scope when caller has no active org", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce({
        value: "solo-workspace-key",
        last4: "-key",
        updatedAt: 1,
      });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "solo-workspace-key",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      {
        key: "BUILDER_PRIVATE_KEY",
        scope: "user",
        scopeId: "a@b.com",
      },
      {
        key: "BUILDER_PRIVATE_KEY",
        scope: "workspace",
        scopeId: "solo:a@b.com",
      },
    ]);
  });

  it("reports the effective credential source", async () => {
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ key, scope }) =>
      scope === "org" &&
      (key === "BUILDER_PRIVATE_KEY" || key === "BUILDER_PUBLIC_KEY")
        ? { value: `${scope}-${key}`, last4: "-key", updatedAt: 1 }
        : null,
    );
    expect(await resolveBuilderCredentialSource()).toBe("org");
  });

  it("reports workspace as the credential source for legacy shared Builder rows", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ key, scope }) =>
      scope === "workspace" &&
      (key === "BUILDER_PRIVATE_KEY" || key === "BUILDER_PUBLIC_KEY")
        ? { value: `${scope}-${key}`, last4: "-key", updatedAt: 1 }
        : null,
    );
    expect(await resolveBuilderCredentialSource()).toBe("workspace");
  });

  it("reports env as the credential source when scoped credentials are missing", async () => {
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveBuilderCredentialSource()).toBe("env");
  });

  it("does not report env as the credential source for signed-in production shared-database users", async () => {
    process.env.NODE_ENV = "production";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveBuilderCredentialSource()).toBeNull();
  });

  it("resolves Builder credentials from one complete scope instead of mixing partial user rows with org rows", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ key, scope }) => {
      if (scope === "user" && key === "BUILDER_PRIVATE_KEY") {
        return { value: "stale-user-private", last4: "vate", updatedAt: 1 };
      }
      if (scope === "org" && key === "BUILDER_PRIVATE_KEY") {
        return { value: "org-private", last4: "vate", updatedAt: 2 };
      }
      if (scope === "org" && key === "BUILDER_PUBLIC_KEY") {
        return { value: "org-public", last4: "blic", updatedAt: 2 };
      }
      if (scope === "org" && key === "BUILDER_ORG_NAME") {
        return { value: "Builder.io", last4: ".io", updatedAt: 2 };
      }
      return null;
    });

    await expect(resolveBuilderCredentials()).resolves.toEqual({
      privateKey: "org-private",
      publicKey: "org-public",
      userId: null,
      orgName: "Builder.io",
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
    });
    expect(mockReadAppSecrets).toHaveBeenCalledTimes(2);
    expect(
      mockReadAppSecrets.mock.calls.map(([request]) => request.scope),
    ).toEqual(["user", "org"]);
    await expect(resolveBuilderCredentialSource()).resolves.toBe("org");
  });

  it("only reports a complete Builder connection when private and public keys resolve together", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ key }) =>
      key === "BUILDER_PRIVATE_KEY"
        ? { value: "private-only", last4: "only", updatedAt: 1 }
        : null,
    );

    await expect(resolveHasCompleteBuilderConnection()).resolves.toBe(false);

    mockReadAppSecret.mockImplementation(async ({ key, scope }) =>
      scope === "org" &&
      (key === "BUILDER_PRIVATE_KEY" || key === "BUILDER_PUBLIC_KEY")
        ? { value: `${scope}-${key}`, last4: "-key", updatedAt: 1 }
        : null,
    );

    await expect(resolveHasCompleteBuilderConnection()).resolves.toBe(true);
  });
});

describe("Builder org fallback (transient org-context dropout)", () => {
  it("finds org-scoped credentials when getRequestOrgId() is null but resolveOrgIdForEmail resolves an org", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockResolveOrgIdForEmail.mockResolvedValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ key, scope, scopeId }) =>
      scope === "org" && scopeId === "builder_io"
        ? { value: `${scope}-${key}`, last4: "-key", updatedAt: 1 }
        : null,
    );

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "org-BUILDER_PRIVATE_KEY",
    );
    expect(mockResolveOrgIdForEmail).toHaveBeenCalledWith("member@b.com");
  });

  it("does not pick up org credentials for an explicit Personal selection (resolveOrgIdForEmail resolves null)", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockResolveOrgIdForEmail.mockResolvedValue(null);
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "org"
        ? { value: "should-not-be-used", last4: "used", updatedAt: 1 }
        : null,
    );

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    const scopesQueried = mockReadAppSecret.mock.calls.map((c) => c[0].scope);
    expect(scopesQueried).not.toContain("org");
  });

  it("finds solo-workspace credentials even when an orgId is present but has no credentials", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "workspace" && scopeId === "solo:a@b.com"
        ? { value: "solo-key", last4: "-key", updatedAt: 1 }
        : null,
    );

    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "solo-key",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      { key: "BUILDER_PRIVATE_KEY", scope: "user", scopeId: "a@b.com" },
      { key: "BUILDER_PRIVATE_KEY", scope: "org", scopeId: "builder_io" },
      {
        key: "BUILDER_PRIVATE_KEY",
        scope: "workspace",
        scopeId: "builder_io",
      },
      {
        key: "BUILDER_PRIVATE_KEY",
        scope: "workspace",
        scopeId: "solo:a@b.com",
      },
    ]);
  });
});

describe("resolveBuilderCredentialsDetailed", () => {
  it("sets lookupFailed=true when the secrets store read throws a db error", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecrets.mockRejectedValue(
      new Error("connection terminated unexpectedly"),
    );

    const result = await resolveBuilderCredentialsDetailed();
    expect(result.lookupFailed).toBe(true);
    expect(result.privateKey).toBeNull();
    expect(result.source).toBeNull();
  });

  it("sets lookupFailed=false when the row is simply absent", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecrets.mockResolvedValue(new Map());

    const result = await resolveBuilderCredentialsDetailed();
    expect(result.lookupFailed).toBe(false);
    expect(result.privateKey).toBeNull();
    expect(result.source).toBeNull();
  });

  it("reports source=org and lookupFailed=false for a healthy org-scoped connection", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ key, scope }) =>
      scope === "org" &&
      (key === "BUILDER_PRIVATE_KEY" || key === "BUILDER_PUBLIC_KEY")
        ? { value: `${scope}-${key}`, last4: "-key", updatedAt: 1 }
        : null,
    );

    const result = await resolveBuilderCredentialsDetailed();
    expect(result.source).toBe("org");
    expect(result.lookupFailed).toBe(false);
  });

  it("skips a user-scoped credential the gateway already rejected and falls through to a working org-scoped one", async () => {
    // Root-cause regression: once a Builder credential is marked bad, every
    // subsequent resolution must skip it instead of resending it forever.
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockImplementation(async ({ key, scope }) => {
      if (
        scope === "user" &&
        (key === "BUILDER_PRIVATE_KEY" || key === "BUILDER_PUBLIC_KEY")
      ) {
        return { value: `user-${key}`, last4: "-key", updatedAt: 1 };
      }
      if (
        scope === "org" &&
        (key === "BUILDER_PRIVATE_KEY" || key === "BUILDER_PUBLIC_KEY")
      ) {
        return { value: `org-${key}`, last4: "-key", updatedAt: 1 };
      }
      return null;
    });
    const rejectedFingerprint = builderCredentialFingerprint(
      "user-BUILDER_PRIVATE_KEY",
      "user-BUILDER_PUBLIC_KEY",
    );
    mockGetSetting.mockImplementation(async (settingKey: string) =>
      settingKey === `builder-auth-failure:${rejectedFingerprint}`
        ? {
            message: "Invalid key",
            status: 401,
            code: "unauthorized",
            at: Date.now(),
          }
        : null,
    );

    const result = await resolveBuilderCredentialsDetailed();
    expect(result.source).toBe("org");
    expect(result.privateKey).toBe("org-BUILDER_PRIVATE_KEY");
  });

  it("does not use a solo row when the org membership lookup fails", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockResolveOrgIdForEmail.mockRejectedValue(new Error("membership timeout"));
    mockReadAppSecrets.mockImplementation(async ({ scopeId }) =>
      scopeId === "solo:member@b.com"
        ? new Map([
            ["BUILDER_PRIVATE_KEY", { value: "solo-private-key" }],
            ["BUILDER_PUBLIC_KEY", { value: "solo-public-key" }],
          ])
        : new Map(),
    );

    const result = await resolveBuilderCredentialsDetailed();
    expect(result).toMatchObject({
      privateKey: null,
      publicKey: null,
      lookupFailed: true,
    });
  });
});

describe("resolveBuilderCredentials (original shape)", () => {
  it("still returns only the original fields, without source or lookupFailed", async () => {
    mockGetRequestUserEmail.mockReturnValue(undefined);
    const result = await resolveBuilderCredentials();
    expect(Object.keys(result).sort()).toEqual(
      [
        "isEnterprise",
        "isFreeAccount",
        "orgKind",
        "orgName",
        "privateKey",
        "publicKey",
        "subscription",
        "subscriptionLevel",
        "subscriptionName",
        "userId",
      ].sort(),
    );
    expect(result).not.toHaveProperty("source");
    expect(result).not.toHaveProperty("lookupFailed");
  });

  it("still returns null fields when nothing resolves (behavior unchanged)", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecret.mockResolvedValue(null);

    await expect(resolveBuilderCredentials()).resolves.toEqual({
      privateKey: null,
      publicKey: null,
      userId: null,
      orgName: null,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
    });
  });
});

describe("resolveSecret (generic)", () => {
  it("falls back to org scope for arbitrary keys (e.g. OPENAI_API_KEY)", async () => {
    mockGetRequestUserEmail.mockReturnValue("teammate@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
      value: "sk-...shared",
      last4: "ared",
      updatedAt: 1,
    });
    expect(await resolveSecret("OPENAI_API_KEY")).toBe("sk-...shared");
  });

  it("falls back to workspace scope for registered shared secrets", async () => {
    mockGetRequestUserEmail.mockReturnValue("teammate@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce(null) // org scope miss
      .mockResolvedValueOnce({
        value: "workspace-secret",
        last4: "cret",
        updatedAt: 1,
      });
    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe(
      "workspace-secret",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0].scope)).toEqual([
      "user",
      "org",
      "workspace",
    ]);
  });

  it("does not trace Builder secret resolution by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      mockGetRequestUserEmail.mockReturnValue("teammate@b.com");
      mockGetRequestOrgId.mockReturnValue("builder_io");
      mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
        value: "builder-private-key",
        last4: "-key",
        updatedAt: 1,
      });

      expect(await resolveSecret("BUILDER_PRIVATE_KEY")).toBe(
        "builder-private-key",
      );
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("traces secret resolution when AGENT_NATIVE_DEBUG_CREDENTIAL_RESOLVE is enabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      process.env.AGENT_NATIVE_DEBUG_CREDENTIAL_RESOLVE = "1";
      mockGetRequestUserEmail.mockReturnValue("teammate@b.com");
      mockGetRequestOrgId.mockReturnValue("builder_io");
      mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
        value: "shared-key",
        last4: "-key",
        updatedAt: 1,
      });

      expect(await resolveSecret("OPENAI_API_KEY")).toBe("shared-key");
      expect(log).toHaveBeenCalledWith(
        "[resolve-secret] key=OPENAI_API_KEY email=teammate@b.com orgId=builder_io scope=org hit=true",
      );
    } finally {
      delete process.env.AGENT_NATIVE_DEBUG_CREDENTIAL_RESOLVE;
      log.mockRestore();
    }
  });

  it("checks solo workspace scope when an authenticated user has no org", async () => {
    mockGetRequestUserEmail.mockReturnValue("solo@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce({
        value: "solo-workspace-secret",
        last4: "cret",
        updatedAt: 1,
      });
    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe(
      "solo-workspace-secret",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      {
        key: "GOOGLE_CLIENT_SECRET",
        scope: "user",
        scopeId: "solo@b.com",
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        scope: "workspace",
        scopeId: "solo:solo@b.com",
      },
    ]);
  });

  it("falls back to the designated Dispatch vault organization", async () => {
    process.env.AGENT_VAULT_ORG_ID = "dispatch-vault";
    mockGetRequestUserEmail.mockReturnValue("builder@b.com");
    mockGetRequestOrgId.mockReturnValue("app-org");
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "org" && scopeId === "dispatch-vault"
        ? { value: "workspace-vault-secret", last4: "cret", updatedAt: 1 }
        : null,
    );

    expect(await resolveSecret("HUBSPOT_MCP_CLIENT_SECRET")).toBe(
      "workspace-vault-secret",
    );
    expect(
      mockReadAppSecret.mock.calls.some(
        ([call]) => call.scope === "org" && call.scopeId === "dispatch-vault",
      ),
    ).toBe(true);
  });

  it("does not bypass manual vault grants through the designated fallback", async () => {
    process.env.AGENT_VAULT_ORG_ID = "dispatch-vault";
    mockGetRequestUserEmail.mockReturnValue("builder@b.com");
    mockGetRequestOrgId.mockReturnValue("app-org");
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "o:dispatch-vault:dispatch-vault-access-settings"
        ? { mode: "manual" }
        : null,
    );
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveSecret("HUBSPOT_MCP_CLIENT_SECRET")).toBeNull();
    expect(
      mockReadAppSecret.mock.calls.some(
        ([call]) => call.scopeId === "dispatch-vault",
      ),
    ).toBe(false);
  });

  it("uses an active app grant for a manual vault in another organization", async () => {
    process.env.AGENT_VAULT_ORG_ID = "dispatch-vault";
    process.env.AGENT_NATIVE_WORKSPACE_APP_ID = "factory";
    mockGetRequestUserEmail.mockReturnValue("builder@b.com");
    mockGetRequestOrgId.mockReturnValue("app-org");
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "o:dispatch-vault:dispatch-vault-access-settings"
        ? { mode: "manual" }
        : null,
    );
    mockGetDbExec.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ rows: [{ 1: 1 }] }),
    });
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "org" && scopeId === "dispatch-vault"
        ? { value: "granted-secret", last4: "cret", updatedAt: 1 }
        : null,
    );

    await expect(resolveSecret("HUBSPOT_MCP_CLIENT_SECRET")).resolves.toBe(
      "granted-secret",
    );
    expect(mockGetDbExec().execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["dispatch-vault", "factory", "HUBSPOT_MCP_CLIENT_SECRET"],
      }),
    );
  });

  it("recovers the org-scoped row when request org context is transiently missing", async () => {
    mockGetRequestUserEmail.mockReturnValue("tim@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockResolveOrgIdForEmail.mockResolvedValue("builder_io");
    mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
      value: "https://academy.example.test",
      last4: "test",
      updatedAt: 1,
    });

    expect(await resolveSecret("ACADEMY_CONVEX_SITE_URL")).toBe(
      "https://academy.example.test",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      { key: "ACADEMY_CONVEX_SITE_URL", scope: "user", scopeId: "tim@b.com" },
      { key: "ACADEMY_CONVEX_SITE_URL", scope: "org", scopeId: "builder_io" },
      {
        key: "ACADEMY_CONVEX_SITE_URL",
        scope: "workspace",
        scopeId: "builder_io",
      },
    ]);
  });

  it("reads the store on every call rather than caching the first resolution", async () => {
    mockGetRequestUserEmail.mockReturnValue("tim@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue({
      value: "https://academy.example.test",
      last4: "test",
      updatedAt: 1,
    });

    await resolveSecret("ACADEMY_CONVEX_SITE_URL");
    const callsAfterFirst = mockReadAppSecret.mock.calls.length;
    await resolveSecret("ACADEMY_CONVEX_SITE_URL");

    expect(mockReadAppSecret.mock.calls.length).toBe(callsAfterFirst * 2);
  });

  it("uses app-provided Google OAuth client env in a signed-in production shared-database request", async () => {
    process.env.NODE_ENV = "production";
    process.env.GOOGLE_CLIENT_ID = "deploy-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "deploy-secret";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveSecret("GOOGLE_CLIENT_ID")).toBe("deploy-client-id");
    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe("deploy-secret");
    expect(canUseDeployCredentialFallbackForRequest("GOOGLE_CLIENT_ID")).toBe(
      true,
    );
    expect(
      canUseDeployCredentialFallbackForRequest("GOOGLE_CLIENT_SECRET"),
    ).toBe(true);
  });

  it("blocks generic deploy env secrets for signed-in production shared-database users even when an LLM key is allowed", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENT_ENGINE = "builder";
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    process.env.BUILDER_PUBLIC_KEY = "space-id";
    process.env.OPENAI_API_KEY = "openai-deploy-key";
    process.env.GITHUB_TOKEN = "github-deploy-token";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockReadAppSecret.mockResolvedValue(null);

    expect(await resolveSecret("OPENAI_API_KEY")).toBe("openai-deploy-key");
    expect(await resolveSecret("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(await resolveSecret("GITHUB_TOKEN")).toBeNull();
  });

  it("uses process.env for authenticated requests on local/single-tenant databases", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPENAI_API_KEY = "deploy-key";
    mockIsLocalDatabase.mockReturnValue(true);
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveSecret("OPENAI_API_KEY")).toBe("deploy-key");
  });

  it("uses process.env outside an authenticated request (CLI / unauth)", async () => {
    process.env.SOME_KEY = "v";
    mockGetRequestUserEmail.mockReturnValue(undefined);
    expect(await resolveSecret("SOME_KEY")).toBe("v");
    delete process.env.SOME_KEY;
  });
});

describe("pre-org solo workspace fallback (generic secrets)", () => {
  beforeEach(() => {
    mockGetRequestUserEmail.mockReturnValue("owner@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
  });

  it("finds a pre-org solo workspace row when the org has none", async () => {
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "workspace" && scopeId === "solo:owner@b.com"
        ? { value: "pre-org-secret", last4: "cret", updatedAt: 1 }
        : null,
    );

    await expect(
      resolveSecretDetailed("GOOGLE_CLIENT_SECRET"),
    ).resolves.toMatchObject({
      value: "pre-org-secret",
      lookupFailed: false,
    });
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      { key: "GOOGLE_CLIENT_SECRET", scope: "user", scopeId: "owner@b.com" },
      { key: "GOOGLE_CLIENT_SECRET", scope: "org", scopeId: "builder_io" },
      {
        key: "GOOGLE_CLIENT_SECRET",
        scope: "workspace",
        scopeId: "builder_io",
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        scope: "workspace",
        scopeId: "solo:owner@b.com",
      },
    ]);
    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe("pre-org-secret");
  });

  it("prefers the current org-scoped row over a stale pre-org solo row", async () => {
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) => {
      if (scope === "org" && scopeId === "builder_io") {
        return { value: "current-org-secret", last4: "cret", updatedAt: 2 };
      }
      if (scope === "workspace" && scopeId === "solo:owner@b.com") {
        return { value: "stale-pre-org-secret", last4: "cret", updatedAt: 1 };
      }
      return null;
    });

    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe(
      "current-org-secret",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0].scopeId)).not.toContain(
      "solo:owner@b.com",
    );
  });

  it("prefers the org's workspace row over a stale pre-org solo row", async () => {
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) => {
      if (scope === "workspace" && scopeId === "builder_io") {
        return { value: "org-workspace-secret", last4: "cret", updatedAt: 2 };
      }
      if (scope === "workspace" && scopeId === "solo:owner@b.com") {
        return { value: "stale-pre-org-secret", last4: "cret", updatedAt: 1 };
      }
      return null;
    });

    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe(
      "org-workspace-secret",
    );
  });

  it("still reports a failed org-scoped read as retryable instead of answering from the solo row", async () => {
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) => {
      if (scope === "org") throw new Error("db query timed out after 12000ms");
      if (scope === "workspace" && scopeId === "solo:owner@b.com") {
        return { value: "stale-pre-org-secret", last4: "cret", updatedAt: 1 };
      }
      return null;
    });

    await expect(
      resolveSecretDetailed("GOOGLE_CLIENT_SECRET"),
    ).resolves.toMatchObject({ value: null, lookupFailed: true });
    await expect(resolveSecret("GOOGLE_CLIENT_SECRET")).rejects.toBeInstanceOf(
      CredentialStoreUnavailableError,
    );
  });

  it("does not answer from the solo row when org membership lookup fails", async () => {
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockResolveOrgIdForEmail.mockRejectedValue(
      Object.assign(new Error("membership query timed out"), { code: "57014" }),
    );
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "workspace" && scopeId === "solo:owner@b.com"
        ? { value: "stale-pre-org-secret", last4: "cret", updatedAt: 1 }
        : null,
    );

    await expect(
      resolveSecretDetailed("GOOGLE_CLIENT_SECRET"),
    ).resolves.toMatchObject({ value: null, lookupFailed: true });
    expect(
      mockReadAppSecret.mock.calls.map((call) => call[0].scopeId),
    ).not.toContain("solo:owner@b.com");
  });
});

describe("unreadable credential store is not 'not configured'", () => {
  beforeEach(() => {
    mockGetRequestUserEmail.mockReturnValue("tim@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockResolveOrgIdForEmail.mockResolvedValue(null);
  });

  it("throws a retryable error when the secrets read fails and nothing else answers", async () => {
    mockReadAppSecret.mockRejectedValue(
      new Error("db query timed out after 12000ms"),
    );

    await expect(resolveSecret("OPENAI_API_KEY")).rejects.toBeInstanceOf(
      CredentialStoreUnavailableError,
    );
    const detailed = await resolveSecretDetailed("OPENAI_API_KEY");
    expect(detailed).toMatchObject({ value: null, lookupFailed: true });
  });

  it("throws when the org lookup fails, because org-scoped rows were never searched", async () => {
    mockResolveOrgIdForEmail.mockRejectedValue(
      Object.assign(new Error("db query timed out"), { code: "57014" }),
    );
    mockReadAppSecret.mockResolvedValue(null);

    await expect(resolveSecret("OPENAI_API_KEY")).rejects.toBeInstanceOf(
      CredentialStoreUnavailableError,
    );
  });

  it("still returns null (definitively absent) when the store answers with no row", async () => {
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveSecret("OPENAI_API_KEY")).toBeNull();
    expect(await resolveSecretDetailed("OPENAI_API_KEY")).toMatchObject({
      value: null,
      lookupFailed: false,
    });
  });

  it("prefers a working env fallback over throwing", async () => {
    process.env.OPENAI_API_KEY = "deploy-key";
    mockIsLocalDatabase.mockReturnValue(true);
    mockReadAppSecret.mockRejectedValue(new Error("db query timed out"));
    try {
      expect(await resolveSecret("OPENAI_API_KEY")).toBe("deploy-key");
      await expect(
        resolveSecretDetailed("OPENAI_API_KEY"),
      ).resolves.toMatchObject({ value: "deploy-key", lookupFailed: true });
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("throws instead of reporting Builder as not connected", async () => {
    mockReadAppSecret.mockRejectedValue(new Error("db query timed out"));

    await expect(
      resolveBuilderCredential("BUILDER_PRIVATE_KEY"),
    ).rejects.toBeInstanceOf(CredentialStoreUnavailableError);
  });

  it("does not report the retryable error as a missing-LLM-credential error", () => {
    expect(isLlmCredentialError(new CredentialStoreUnavailableError())).toBe(
      false,
    );
  });
});

describe("Builder gateway credential lane", () => {
  const hostedVisitor = () => {
    process.env.NODE_ENV = "production";
    mockIsLocalDatabase.mockReturnValue(false);
    mockGetRequestUserEmail.mockReturnValue("visitor@example.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecret.mockResolvedValue(null);
  };

  it("treats the Builder-credits pair as app-provided for a signed-in hosted user", () => {
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    mockGetRequestUserEmail.mockReturnValue("visitor@example.com");

    expect(
      canUseDeployCredentialFallbackForRequest("BUILDER_GATEWAY_TOKEN"),
    ).toBe(true);
    expect(
      canUseDeployCredentialFallbackForRequest("BUILDER_GATEWAY_SPACE_ID"),
    ).toBe(true);
    expect(
      canUseDeployCredentialFallbackForRequest("BUILDER_PRIVATE_KEY"),
    ).toBe(false);
  });

  it("resolves the deploy pair on a hosted app with no per-user connection", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";

    await expect(resolveBuilderGatewayCredentials()).resolves.toMatchObject({
      privateKey: "btk-site-token",
      publicKey: "space-abc",
      userId: null,
    });
    await expect(
      resolveBuilderGatewayCredentialsDetailed(),
    ).resolves.toMatchObject({ lane: "gateway-deploy" });
    expect(isBuilderGatewayDeployConfigured()).toBe(true);
  });

  it("keeps the identity resolver off the gateway token", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";

    await expect(resolveBuilderCredentials()).resolves.toMatchObject({
      privateKey: null,
      publicKey: null,
    });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(await resolveBuilderCredentialSource()).toBeNull();
  });

  it("does not resolve a gateway token without its space id", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";

    await expect(resolveBuilderGatewayCredentials()).resolves.toMatchObject({
      privateKey: null,
      publicKey: null,
    });
    await expect(resolveBuilderGatewayAuth()).resolves.toBeNull();
  });

  it("lets a user's own connection outrank the deploy pair", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";
    mockReadAppSecret.mockImplementation(async ({ key, scope }: any) => {
      if (scope !== "user") return null;
      if (key === "BUILDER_PRIVATE_KEY") return { key, value: "bpk-user" };
      if (key === "BUILDER_PUBLIC_KEY") return { key, value: "space-user" };
      return null;
    });

    await expect(
      resolveBuilderGatewayCredentialsDetailed(),
    ).resolves.toMatchObject({
      privateKey: "bpk-user",
      publicKey: "space-user",
      lane: "identity",
    });
  });

  it("skips a gateway token the gateway already rejected", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";
    const fingerprint = providerCredentialFingerprint(
      "BUILDER_GATEWAY_TOKEN",
      "btk-site-token",
    );
    mockGetSetting.mockImplementation(async (key: string) =>
      key === `provider-auth-failure:${fingerprint}`
        ? {
            fingerprint,
            key: "BUILDER_GATEWAY_TOKEN",
            message: "Invalid or inactive personal access token",
            status: 403,
            at: Date.now(),
          }
        : null,
    );

    await expect(resolveBuilderGatewayCredentials()).resolves.toMatchObject({
      privateKey: null,
      publicKey: null,
    });
  });

  it("sends the space id as the gateway auth space", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";

    await expect(resolveBuilderGatewayAuth()).resolves.toEqual({
      authorization: "Bearer btk-site-token",
      spaceId: "space-abc",
      userId: null,
    });
  });

  it("still authenticates a legacy single-key deployment", async () => {
    process.env.BUILDER_PRIVATE_KEY = "bpk-legacy";
    mockGetRequestUserEmail.mockReturnValue(undefined);

    await expect(resolveBuilderGatewayAuth()).resolves.toEqual({
      authorization: "Bearer bpk-legacy",
      spaceId: null,
      userId: null,
    });
  });

  it("fingerprints the gateway token when the deploy pair is rejected", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";

    await recordBuilderGatewayAuthFailure({
      status: 403,
      code: "http_403",
      message: "Invalid or inactive personal access token",
    });

    const fingerprint = providerCredentialFingerprint(
      "BUILDER_GATEWAY_TOKEN",
      "btk-site-token",
    );
    expect(mockPutSetting).toHaveBeenCalledWith(
      `provider-auth-failure:${fingerprint}`,
      expect.objectContaining({
        key: "BUILDER_GATEWAY_TOKEN",
        status: 403,
      }),
    );
    // The legacy pair marker is a no-op without both legacy keys, so it must
    // not be the one this lane writes.
    expect(builderCredentialFingerprint("btk-site-token", null)).toBeNull();
  });

  it("falls back to the legacy pair marker on the identity lane", async () => {
    process.env.BUILDER_PRIVATE_KEY = "bpk-legacy";
    process.env.BUILDER_PUBLIC_KEY = "space-legacy";
    mockGetRequestUserEmail.mockReturnValue(undefined);

    await recordBuilderGatewayAuthFailure({
      status: 401,
      code: "unauthorized",
    });

    const fingerprint = builderCredentialFingerprint(
      "bpk-legacy",
      "space-legacy",
    );
    expect(mockPutSetting).toHaveBeenCalledWith(
      `builder-auth-failure:${fingerprint}`,
      expect.objectContaining({ status: 401 }),
    );
  });

  it("clears both markers for an accepted pair", async () => {
    await clearBuilderGatewayAuthFailure({
      privateKey: "btk-site-token",
      publicKey: "space-abc",
    });

    expect(mockDeleteSetting).toHaveBeenCalledWith(
      `builder-auth-failure:${builderCredentialFingerprint(
        "btk-site-token",
        "space-abc",
      )}`,
    );
    expect(mockDeleteSetting).toHaveBeenCalledWith(
      `provider-auth-failure:${providerCredentialFingerprint(
        "BUILDER_GATEWAY_TOKEN",
        "btk-site-token",
      )}`,
    );
  });

  // A LEGACY env deployment now gets an x-builder-api-key it did not send
  // before. That is only safe because the token and the space id always come
  // from ONE scope, so the space id is the key's own ownerId: ai-services' bpk-
  // branch 403s "Private key does not match spaceId" for any other combination.
  it("pairs a legacy env deployment's key with its own space id", async () => {
    process.env.BUILDER_PRIVATE_KEY = "bpk-legacy";
    process.env.BUILDER_PUBLIC_KEY = "space-legacy";
    mockGetRequestUserEmail.mockReturnValue(undefined);

    await expect(resolveBuilderGatewayAuth()).resolves.toEqual({
      authorization: "Bearer bpk-legacy",
      spaceId: "space-legacy",
      userId: null,
    });
  });

  it("does not mix a user's private key with a deploy-level space id", async () => {
    process.env.BUILDER_PRIVATE_KEY = "bpk-deploy";
    process.env.BUILDER_PUBLIC_KEY = "space-deploy";
    mockGetRequestUserEmail.mockReturnValue("owner@example.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    // A partial user row is a miss, so the complete deploy scope answers whole.
    mockReadAppSecret.mockImplementation(async ({ key, scope }: any) =>
      scope === "user" && key === "BUILDER_PRIVATE_KEY"
        ? { key, value: "bpk-user-only" }
        : null,
    );

    await expect(resolveBuilderGatewayAuth()).resolves.toEqual({
      authorization: "Bearer bpk-deploy",
      spaceId: "space-deploy",
      userId: null,
    });
  });

  // The gate for every gateway-lane feature. Answering the identity-only
  // question here is what left transcription dead on credits-only sites.
  it("reports a usable Builder credential on the credits lane alone", async () => {
    hostedVisitor();
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";

    await expect(resolveHasBuilderGatewayCredential()).resolves.toBe(true);
    await expect(resolveHasBuilderPrivateKey()).resolves.toBe(false);
  });

  it("reports no usable Builder credential when neither lane resolves", async () => {
    hostedVisitor();

    await expect(resolveHasBuilderGatewayCredential()).resolves.toBe(false);
  });

  it("rewrites a gateway-lane rejection for a visitor and leaves an owner's alone", () => {
    const ownerFacing = "Connect Builder.io in Settings to enable this.";
    expect(gatewayLaneUnavailableMessage(ownerFacing)).toBe(ownerFacing);

    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    expect(gatewayLaneUnavailableMessage(ownerFacing)).toBe(
      GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    );
  });

  // The dev-preview pod is injected with the SAME gateway token as the published
  // site, so a token-only test cannot tell the two apart — and the reader there
  // is the project owner in the Fusion editor, who needs the real reason.
  it("keeps owner-facing copy in the dev-preview runtime", () => {
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";
    process.env.FUSION_ENVIRONMENT = "preview";

    expect(isBuilderGatewayDeployConfigured()).toBe(false);
    expect(gatewayLaneUnavailableMessage("Add a provider key.")).toBe(
      "Add a provider key.",
    );
  });

  it("still resolves the credits lane inside the dev-preview runtime", async () => {
    hostedVisitor();
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    process.env.BUILDER_GATEWAY_SPACE_ID = "space-abc";

    await expect(
      resolveBuilderGatewayCredentialsDetailed(),
    ).resolves.toMatchObject({
      privateKey: "btk-site-token",
      publicKey: "space-abc",
      lane: "gateway-deploy",
    });
  });
});
