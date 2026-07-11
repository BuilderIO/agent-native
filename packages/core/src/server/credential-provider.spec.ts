import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadAppSecret = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();
const mockGetSetting = vi.fn();
const mockPutSetting = vi.fn();
const mockDeleteSetting = vi.fn();
const mockGetRequestUserEmail = vi.fn<[], string | undefined>();
const mockGetRequestOrgId = vi.fn<[], string | undefined>();
const mockIsLocalDatabase = vi.fn<[], boolean>();

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
  writeAppSecret: (...args: any[]) => mockWriteAppSecret(...args),
  deleteAppSecret: (...args: any[]) => mockDeleteAppSecret(...args),
}));
vi.mock("./request-context.js", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
  getRequestOrgId: () => mockGetRequestOrgId(),
}));
vi.mock("../db/client.js", () => ({
  isLocalDatabase: () => mockIsLocalDatabase(),
}));
vi.mock("../settings/store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
  putSetting: (...args: any[]) => mockPutSetting(...args),
  deleteSetting: (...args: any[]) => mockDeleteSetting(...args),
}));

import {
  builderCredentialFingerprint,
  canUseDeployCredentialFallbackForRequest,
  getBuilderCredentialAuthFailure,
  getProviderCredentialAuthFailure,
  providerCredentialFingerprint,
  recordBuilderCredentialAuthFailure,
  recordProviderCredentialAuthFailure,
  resolveCredentialWriteScope,
  writeBuilderCredentials,
  deleteBuilderCredentials,
  resolveBuilderCredential,
  resolveBuilderCredentials,
  resolveBuilderCredentialSource,
  resolveHasCompleteBuilderConnection,
  resolveSecret,
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
  delete process.env.AGENT_NATIVE_LOCAL_BUILDER_ENV;
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
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GITHUB_TOKEN;
  mockReadAppSecret.mockResolvedValue(null);
  mockWriteAppSecret.mockResolvedValue("id");
  mockDeleteAppSecret.mockResolvedValue(true);
  mockGetSetting.mockResolvedValue(null);
  mockPutSetting.mockResolvedValue(undefined);
  mockDeleteSetting.mockResolvedValue(true);
  mockGetRequestUserEmail.mockReturnValue(undefined);
  mockGetRequestOrgId.mockReturnValue(undefined);
  mockIsLocalDatabase.mockReturnValue(true);
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
    mockGetSetting.mockResolvedValue({
      message: "Invalid key",
      status: 401,
      code: "unauthorized",
      at: 123,
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
      at: 123,
    });
    expect(mockGetSetting).toHaveBeenCalledWith(
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
    expect(mockReadAppSecret).toHaveBeenCalledTimes(3);
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
