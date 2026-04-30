import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();
const mockGetAppSecretMeta = vi.fn();
const mockReadAppSecret = vi.fn();
const mockListAppSecretsForScope = vi.fn();
const mockGetRequiredSecret = vi.fn();
const mockListRequiredSecrets = vi.fn();
const mockHasOAuthTokens = vi.fn();
const mockListOAuthAccountsByOwner = vi.fn();

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
  DEV_MODE_USER_EMAIL: "local@localhost",
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
  getAppSecretMeta: (...args: any[]) => mockGetAppSecretMeta(...args),
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
  listAppSecretsForScope: (...args: any[]) =>
    mockListAppSecretsForScope(...args),
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
    mockReadAppSecret.mockResolvedValue(null);
    mockListOAuthAccountsByOwner.mockResolvedValue([]);
    mockHasOAuthTokens.mockResolvedValue(false);
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
    mockReadAppSecret.mockResolvedValue({
      value: "stored-secret-value",
      last4: "alue",
      updatedAt: 123,
    });

    const handler = createTestSecretHandler();
    const result = await handler(event("/API_TOKEN/test", "POST"));

    expect(result).toEqual({
      ok: false,
      error: "Token [redacted] is expired",
    });
    expect(JSON.stringify(result)).not.toContain("stored-secret-value");
  });
});
