import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();
const mockReadAppSecretMeta = vi.fn();
const mockListAppSecretsForScope = vi.fn();
const mockGetRequiredSecret = vi.fn();
const mockListRequiredSecrets = vi.fn();
const mockHasOAuthTokens = vi.fn();
const mockListOAuthAccountsByOwner = vi.fn();
const mockResolveSecretDetailed = vi.fn();

let lastStatus = 200;

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event._method ?? "GET",
  setResponseStatus: (_event: any, code: number) => {
    lastStatus = code;
  },
  setResponseHeader: vi.fn(),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (event: any) => Promise.resolve(event._body ?? {}),
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
}));

vi.mock("../oauth-tokens/store.js", () => ({
  hasOAuthTokens: (...args: any[]) => mockHasOAuthTokens(...args),
  listOAuthAccountsByOwner: (...args: any[]) =>
    mockListOAuthAccountsByOwner(...args),
}));

vi.mock("./register.js", () => ({
  getRequiredSecret: (...args: any[]) => mockGetRequiredSecret(...args),
  listRequiredSecrets: (...args: any[]) => mockListRequiredSecrets(...args),
}));

vi.mock("./storage.js", () => ({
  writeAppSecret: (...args: any[]) => mockWriteAppSecret(...args),
  deleteAppSecret: (...args: any[]) => mockDeleteAppSecret(...args),
  readAppSecretMeta: (...args: any[]) => mockReadAppSecretMeta(...args),
  listAppSecretsForScope: (...args: any[]) =>
    mockListAppSecretsForScope(...args),
  last4: (value: string) => (value ? value.slice(-4) : ""),
  VAULT_SYNC_DESCRIPTION_PREFIX: "Synced from Dispatch vault:",
}));

vi.mock("../server/credential-provider.js", () => ({
  resolveSecretDetailed: (...args: any[]) => mockResolveSecretDetailed(...args),
}));

vi.mock("../server/request-context.js", () => ({
  runWithRequestContext: (_ctx: any, fn: () => any) => fn(),
}));

import {
  createAdHocSecretHandler,
  createListSecretsHandler,
  createTestSecretHandler,
  createWriteSecretHandler,
} from "./routes.js";

function event(pathname: string, method: string, body?: unknown) {
  return {
    _method: method,
    _body: body,
    url: new URL(`http://example.test${pathname}`),
  };
}

describe("secrets routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 200;
    mockGetSession.mockResolvedValue({ email: "alice+qa@example.com" });
    mockGetOrgContext.mockResolvedValue({
      orgId: "org-qa",
      email: "alice+qa@example.com",
      role: "owner",
    });
    mockGetRequiredSecret.mockReturnValue(undefined);
    mockListRequiredSecrets.mockReturnValue([]);
    mockWriteAppSecret.mockResolvedValue("sec_1");
    mockListOAuthAccountsByOwner.mockResolvedValue([]);
    mockHasOAuthTokens.mockResolvedValue(false);
    mockResolveSecretDetailed.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    mockReadAppSecretMeta.mockResolvedValue(null);
    mockListAppSecretsForScope.mockResolvedValue([]);
  });

  it("uses the registered user secret scope and ignores caller-supplied scopeId", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
    });

    const handler = createWriteSecretHandler();
    const result = await handler(
      event("/API_TOKEN", "POST", {
        value: "shh",
        scope: "workspace",
        scopeId: "victim+qa@example.com",
      }),
    );

    expect(result).toEqual({ ok: true, status: "set" });
    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "API_TOKEN",
      value: "shh",
      scope: "user",
      scopeId: "alice+qa@example.com",
    });
  });

  it("uses org context for registered workspace secrets", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "ORG_TOKEN",
      label: "Org token",
      scope: "workspace",
      kind: "api-key",
    });

    const handler = createWriteSecretHandler();
    await handler(
      event("/ORG_TOKEN", "POST", {
        value: "workspace-secret",
        scope: "user",
        scopeId: "other-org",
      }),
    );

    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "ORG_TOKEN",
      value: "workspace-secret",
      scope: "workspace",
      scopeId: "org-qa",
    });
  });

  it("writes registered org-scope secrets at the active org id when caller is admin", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "ORG_SHARED_TOKEN",
      label: "Org shared token",
      scope: "org",
      kind: "api-key",
    });
    mockGetOrgContext.mockResolvedValue({
      orgId: "org-qa",
      email: "alice+qa@example.com",
      role: "admin",
    });

    const handler = createWriteSecretHandler();
    const result = await handler(
      event("/ORG_SHARED_TOKEN", "POST", { value: "shared" }),
    );

    expect(result).toEqual({ ok: true, status: "set" });
    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "ORG_SHARED_TOKEN",
      value: "shared",
      scope: "org",
      scopeId: "org-qa",
    });
  });

  it("rejects org-scope secret writes from a plain member", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "ORG_SHARED_TOKEN",
      label: "Org shared token",
      scope: "org",
      kind: "api-key",
    });
    mockGetOrgContext.mockResolvedValue({
      orgId: "org-qa",
      email: "bob+qa@example.com",
      role: "member",
    });

    const handler = createWriteSecretHandler();
    const result = await handler(
      event("/ORG_SHARED_TOKEN", "POST", { value: "shared" }),
    );

    expect(lastStatus).toBe(403);
    expect(result).toEqual({
      error: "Only organization owners and admins can set org-scoped secrets",
    });
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("rejects org-scope secret writes when the user has no active org", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "ORG_SHARED_TOKEN",
      label: "Org shared token",
      scope: "org",
      kind: "api-key",
    });
    mockGetOrgContext.mockResolvedValue({
      orgId: null,
      email: "alice+qa@example.com",
      role: null,
    });

    const handler = createWriteSecretHandler();
    const result = await handler(
      event("/ORG_SHARED_TOKEN", "POST", { value: "shared" }),
    );

    expect(lastStatus).toBe(401);
    expect(result).toEqual({ error: "No active organization" });
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("rejects org-scope secret deletes from a plain member", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "ORG_SHARED_TOKEN",
      label: "Org shared token",
      scope: "org",
      kind: "api-key",
    });
    mockGetOrgContext.mockResolvedValue({
      orgId: "org-qa",
      email: "bob+qa@example.com",
      role: "member",
    });

    const handler = createWriteSecretHandler();
    const result = await handler(event("/ORG_SHARED_TOKEN", "DELETE"));

    expect(lastStatus).toBe(403);
    expect(result).toEqual({
      error:
        "Only organization owners and admins can delete org-scoped secrets",
    });
    expect(mockDeleteAppSecret).not.toHaveBeenCalled();
  });

  it("normalizes ad-hoc URL allowlists to unique origins", async () => {
    const handler = createAdHocSecretHandler();
    const result = await handler(
      event("/", "POST", {
        name: "WEBHOOK_TOKEN",
        value: "token-value",
        urlAllowlist: [
          "https://api.example.com/v1/hooks",
          "https://api.example.com/other",
          " http://localhost:3000/path ",
        ],
      }),
    );

    expect(result).toEqual({ ok: true, key: "WEBHOOK_TOKEN" });
    expect(mockWriteAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "WEBHOOK_TOKEN",
        scope: "user",
        scopeId: "alice+qa@example.com",
        urlAllowlist: JSON.stringify([
          "https://api.example.com",
          "http://localhost:3000",
        ]),
      }),
    );
  });

  it("rejects invalid ad-hoc URL allowlist entries", async () => {
    const handler = createAdHocSecretHandler();
    const result = await handler(
      event("/", "POST", {
        name: "WEBHOOK_TOKEN",
        value: "token-value",
        urlAllowlist: ["not a url"],
      }),
    );

    expect(lastStatus).toBe(400);
    expect(result).toEqual({
      error: 'urlAllowlist entry "not a url" is not a valid URL',
    });
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("scopes OAuth secret status to the current user", async () => {
    mockListRequiredSecrets.mockReturnValue([
      {
        key: "GOOGLE_OAUTH",
        label: "Google",
        scope: "user",
        kind: "oauth",
        required: true,
        oauthProvider: "google",
      },
    ]);
    mockListOAuthAccountsByOwner.mockResolvedValueOnce([]);

    const handler = createListSecretsHandler();
    const result = await handler(event("/", "GET"));

    expect(result).toEqual([
      expect.objectContaining({
        key: "GOOGLE_OAUTH",
        status: "unset",
      }),
    ]);
    expect(mockListOAuthAccountsByOwner).toHaveBeenCalledWith(
      "google",
      "alice+qa@example.com",
    );
    expect(mockHasOAuthTokens).not.toHaveBeenCalled();
  });

  it("redacts submitted secret values from validator responses", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator: vi.fn(async () => ({
        ok: false,
        error: "API rejected shh-secret-value",
      })),
    });

    const handler = createWriteSecretHandler();
    const result = await handler(
      event("/API_TOKEN", "POST", {
        value: "shh-secret-value",
      }),
    );

    expect(lastStatus).toBe(400);
    expect(result).toEqual({
      error: "API rejected [redacted]",
    });
    expect(JSON.stringify(result)).not.toContain("shh-secret-value");
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("redacts stored secret values from validator test responses", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator: vi.fn(async () => ({
        ok: false,
        error: "Token stored-secret-value is expired",
      })),
    });
    mockResolveSecretDetailed.mockResolvedValue({
      value: "stored-secret-value",
      lookupFailed: false,
      source: "user",
      scopeId: "alice+qa@example.com",
    });

    const handler = createTestSecretHandler();
    const result = await handler(event("/API_TOKEN/test", "POST"));

    expect(result).toEqual({
      ok: false,
      error: "Token [redacted] is expired",
    });
    expect(JSON.stringify(result)).not.toContain("stored-secret-value");
  });

  it("requires a signed-in user to validate a candidate user secret", async () => {
    const validator = vi.fn();
    mockGetSession.mockResolvedValue(null);
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator,
    });

    const handler = createTestSecretHandler();
    const result = await handler(
      event("/API_TOKEN/test", "POST", { value: "candidate-value" }),
    );

    expect(lastStatus).toBe(401);
    expect(result).toEqual({ error: "Authentication required" });
    expect(validator).not.toHaveBeenCalled();
  });

  it("requires an owner or admin to validate a stored workspace secret", async () => {
    const validator = vi.fn();
    mockGetOrgContext.mockResolvedValue({
      orgId: "org-qa",
      email: "bob+qa@example.com",
      role: "member",
    });
    mockGetRequiredSecret.mockReturnValue({
      key: "WORKSPACE_TOKEN",
      label: "Workspace token",
      scope: "workspace",
      kind: "api-key",
      validator,
    });

    const handler = createTestSecretHandler();
    const result = await handler(event("/WORKSPACE_TOKEN/test", "POST"));

    expect(lastStatus).toBe(403);
    expect(result).toEqual({
      error:
        "Only organization owners and admins can set workspace-scoped secrets",
    });
    expect(validator).not.toHaveBeenCalled();
  });

  it("requires an owner or admin to validate a candidate org secret", async () => {
    const validator = vi.fn();
    mockGetOrgContext.mockResolvedValue({
      orgId: "org-qa",
      email: "bob+qa@example.com",
      role: "member",
    });
    mockGetRequiredSecret.mockReturnValue({
      key: "ORG_TOKEN",
      label: "Org token",
      scope: "org",
      kind: "api-key",
      validator,
    });

    const handler = createTestSecretHandler();
    const result = await handler(
      event("/ORG_TOKEN/test", "POST", { value: "candidate-value" }),
    );

    expect(lastStatus).toBe(403);
    expect(result).toEqual({
      error: "Only organization owners and admins can set org-scoped secrets",
    });
    expect(validator).not.toHaveBeenCalled();
  });

  it("validates a candidate secret value without reading or writing storage", async () => {
    const validator = vi.fn(async () => ({ ok: true }));
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator,
    });

    const handler = createTestSecretHandler();
    const result = await handler(
      event("/API_TOKEN/test", "POST", { value: "candidate-value" }),
    );

    expect(result).toEqual({ ok: true });
    expect(validator).toHaveBeenCalledWith("candidate-value");
    expect(mockResolveSecretDetailed).not.toHaveBeenCalled();
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("rejects empty candidate secret values", async () => {
    const validator = vi.fn();
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator,
    });

    const handler = createTestSecretHandler();
    const result = await handler(
      event("/API_TOKEN/test", "POST", { value: " " }),
    );

    expect(lastStatus).toBe(400);
    expect(result).toEqual({ error: "value must be a non-empty string" });
    expect(validator).not.toHaveBeenCalled();
  });

  it("redacts candidate secret values from validator test responses", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator: vi.fn(async () => ({
        ok: false,
        error: "Token candidate-secret-value is expired",
      })),
    });

    const handler = createTestSecretHandler();
    const result = await handler(
      event("/API_TOKEN/test", "POST", { value: "candidate-secret-value" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Token [redacted] is expired",
    });
    expect(JSON.stringify(result)).not.toContain("candidate-secret-value");
  });

  it("redacts submitted secret values from registered secret storage errors", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
    });
    mockWriteAppSecret.mockRejectedValueOnce(
      new Error("database rejected shh-secret-value"),
    );

    const handler = createWriteSecretHandler();
    const result = await handler(
      event("/API_TOKEN", "POST", {
        value: "shh-secret-value",
      }),
    );

    expect(lastStatus).toBe(500);
    expect(result).toEqual({
      error: "Failed to save secret: database rejected [redacted]",
    });
    expect(JSON.stringify(result)).not.toContain("shh-secret-value");
  });

  it("redacts submitted secret values from ad-hoc secret storage errors", async () => {
    mockWriteAppSecret.mockRejectedValueOnce(
      new Error("database rejected ad-hoc-secret-value"),
    );

    const handler = createAdHocSecretHandler();
    const result = await handler(
      event("/", "POST", {
        name: "WEBHOOK_TOKEN",
        value: "ad-hoc-secret-value",
      }),
    );

    expect(lastStatus).toBe(500);
    expect(result).toEqual({
      error: "Failed to save secret: database rejected [redacted]",
    });
    expect(JSON.stringify(result)).not.toContain("ad-hoc-secret-value");
  });

  it("reports a Vault-synced org row as set/vault/not-managed-here", async () => {
    mockListRequiredSecrets.mockReturnValue([
      {
        key: "GOOGLE_API_KEY",
        label: "Google API key",
        scope: "workspace",
        kind: "api-key",
        required: false,
      },
    ]);
    mockResolveSecretDetailed.mockResolvedValue({
      value: "sk-live-vault-value",
      lookupFailed: false,
      source: "org",
      scopeId: "org-qa",
    });
    mockReadAppSecretMeta.mockResolvedValue({
      key: "GOOGLE_API_KEY",
      scope: "org",
      scopeId: "org-qa",
      last4: "vaul",
      description: "Synced from Dispatch vault: Google",
      urlAllowlist: null,
      createdAt: 1,
      updatedAt: 2,
    });

    const handler = createListSecretsHandler();
    const result = await handler(event("/", "GET"));

    expect(result).toEqual([
      expect.objectContaining({
        key: "GOOGLE_API_KEY",
        status: "set",
        source: "vault",
        managedHere: false,
        last4: "vaul",
      }),
    ]);
    expect(mockReadAppSecretMeta).toHaveBeenCalledWith({
      key: "GOOGLE_API_KEY",
      scope: "org",
      scopeId: "org-qa",
    });
  });

  it("reports managedHere + overrides when a personal row shadows a vault-synced value", async () => {
    mockListRequiredSecrets.mockReturnValue([
      {
        key: "GOOGLE_API_KEY",
        label: "Google API key",
        scope: "user",
        kind: "api-key",
        required: false,
      },
    ]);
    mockResolveSecretDetailed.mockImplementation(
      (_key: string, options?: { skipUserScope?: boolean }) =>
        options?.skipUserScope
          ? Promise.resolve({
              value: "vault-value",
              lookupFailed: false,
              source: "org",
              scopeId: "vault-org-id",
            })
          : Promise.resolve({
              value: "personal-value",
              lookupFailed: false,
              source: "user",
              scopeId: "alice+qa@example.com",
            }),
    );
    mockReadAppSecretMeta.mockImplementation(({ scope }: { scope: string }) =>
      scope === "user"
        ? Promise.resolve({
            key: "GOOGLE_API_KEY",
            scope: "user",
            scopeId: "alice+qa@example.com",
            last4: "pers",
            description: null,
            urlAllowlist: null,
            createdAt: 1,
            updatedAt: 2,
          })
        : Promise.resolve({
            key: "GOOGLE_API_KEY",
            scope: "org",
            scopeId: "vault-org-id",
            last4: "vaul",
            description: "Synced from Dispatch vault: Google",
            urlAllowlist: null,
            createdAt: 1,
            updatedAt: 2,
          }),
    );

    const handler = createListSecretsHandler();
    const result = await handler(event("/", "GET"));

    expect(result).toEqual([
      expect.objectContaining({
        key: "GOOGLE_API_KEY",
        status: "set",
        source: "personal",
        managedHere: true,
        overrides: "vault",
      }),
    ]);
    expect(mockResolveSecretDetailed).toHaveBeenCalledWith("GOOGLE_API_KEY", {
      skipUserScope: true,
    });
  });

  it("reports an env-resolved value with source env and last4 from the value", async () => {
    mockListRequiredSecrets.mockReturnValue([
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI",
        scope: "user",
        kind: "api-key",
        required: false,
      },
    ]);
    mockResolveSecretDetailed.mockResolvedValue({
      value: "sk-env-1234",
      lookupFailed: false,
      source: "env",
    });

    const handler = createListSecretsHandler();
    const result = await handler(event("/", "GET"));

    expect(result).toEqual([
      expect.objectContaining({
        key: "OPENAI_API_KEY",
        status: "set",
        source: "env",
        last4: "1234",
      }),
    ]);
    expect(mockReadAppSecretMeta).not.toHaveBeenCalled();
  });

  it("reports status unknown with an error when the lookup fails and nothing resolves", async () => {
    mockListRequiredSecrets.mockReturnValue([
      {
        key: "MISSING_KEY",
        label: "Missing",
        scope: "user",
        kind: "api-key",
        required: false,
      },
    ]);
    mockResolveSecretDetailed.mockResolvedValue({
      value: null,
      lookupFailed: true,
      cause: new Error("db unreachable"),
    });

    const handler = createListSecretsHandler();
    const result = await handler(event("/", "GET"));

    expect(result).toEqual([
      expect.objectContaining({
        key: "MISSING_KEY",
        status: "unknown",
        error: "Could not read the credential store",
      }),
    ]);
  });

  it("includes org-scope ad-hoc rows, tagging Vault-synced ones and excluding registered keys", async () => {
    mockListRequiredSecrets.mockReturnValue([
      {
        key: "REGISTERED_KEY",
        label: "Registered",
        scope: "org",
        kind: "api-key",
        required: false,
      },
    ]);
    mockListAppSecretsForScope.mockImplementation((scope: string) => {
      if (scope !== "org") return Promise.resolve([]);
      return Promise.resolve([
        {
          key: "VAULT_SYNCED_KEY",
          scope: "org",
          scopeId: "org-qa",
          last4: "1111",
          description: "Synced from Dispatch vault: Google",
          urlAllowlist: null,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          key: "MANUAL_ORG_KEY",
          scope: "org",
          scopeId: "org-qa",
          last4: "2222",
          description: null,
          urlAllowlist: null,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          key: "REGISTERED_KEY",
          scope: "org",
          scopeId: "org-qa",
          last4: "3333",
          description: null,
          urlAllowlist: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ]);
    });

    const handler = createAdHocSecretHandler();
    const result = (await handler(event("/", "GET"))) as Array<{
      name: string;
    }>;

    expect(result).toEqual([
      expect.objectContaining({
        name: "VAULT_SYNCED_KEY",
        scope: "org",
        source: "vault",
      }),
      expect.objectContaining({
        name: "MANUAL_ORG_KEY",
        scope: "org",
        source: "workspace",
      }),
    ]);
    expect(result.some((r) => r.name === "REGISTERED_KEY")).toBe(false);
  });

  it("validates the resolved effective value when no candidate is supplied", async () => {
    const validator = vi.fn(async () => ({ ok: true }));
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator,
    });
    mockResolveSecretDetailed.mockResolvedValue({
      value: "resolved-effective-value",
      lookupFailed: false,
      source: "user",
      scopeId: "alice+qa@example.com",
    });

    const handler = createTestSecretHandler();
    const result = await handler(event("/API_TOKEN/test", "POST"));

    expect(result).toEqual({ ok: true });
    expect(validator).toHaveBeenCalledWith("resolved-effective-value");
  });

  it("returns 404 'No value stored' when nothing resolves for the test handler", async () => {
    mockGetRequiredSecret.mockReturnValue({
      key: "API_TOKEN",
      label: "API token",
      scope: "user",
      kind: "api-key",
      validator: vi.fn(),
    });
    mockResolveSecretDetailed.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });

    const handler = createTestSecretHandler();
    const result = await handler(event("/API_TOKEN/test", "POST"));

    expect(lastStatus).toBe(404);
    expect(result).toEqual({ error: "No value stored" });
  });
});
