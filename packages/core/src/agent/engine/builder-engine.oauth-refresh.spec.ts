import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  refresh: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@modelcontextprotocol/client")>()),
  refreshAuthorization: mocks.refresh,
}));

vi.mock("../../oauth-tokens/store.js", () => ({
  getOAuthTokenSnapshot: vi.fn(
    async (_provider: string, _account: string, owner: string) => {
      const tokens = mocks.rows.get(owner);
      return tokens
        ? {
            tokens,
            owner,
            revision: 1,
            legacyRevision: 1,
            storageVersion: "test-version",
          }
        : null;
    },
  ),
  getOAuthTokenSnapshotForUserOwner: vi.fn(async () => null),
  replaceOAuthTokensIfRevision: vi.fn(
    async (
      _provider: string,
      _account: string,
      owner: string,
      _revision: number,
      _legacy: number,
      _version: string,
      tokens: Record<string, unknown>,
    ) => {
      mocks.rows.set(owner, tokens);
      return true;
    },
  ),
  getOAuthTokens: vi.fn(
    async (_provider: string, _account: string, owner: string) =>
      mocks.rows.get(owner) ?? null,
  ),
}));

vi.mock("../../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/store.js")>()),
  mutateSetting: vi.fn(
    async (_key: string, updater: (current: null) => unknown) => updater(null),
  ),
}));

vi.mock("../../server/personal-provider-key-policy.js", () => ({
  isPersonalProviderKeyUseRestricted: vi.fn(async () => false),
  readOrgMemberRole: vi.fn(async () => "member"),
}));

vi.mock("../../usage/builder-credit-notice.js", () => ({
  clearBuilderCreditLimitNotice: vi.fn(async () => {}),
  sendBuilderCreditLimitNotice: vi.fn(async () => {}),
}));

vi.mock("../../server/request-context.js", () => ({
  getRequestContext: vi.fn(() => undefined),
  getRequestOrgId: vi.fn(() => "org-test"),
  getRequestRunContext: vi.fn(() => undefined),
  getRequestUserEmail: vi.fn(() => "person@example.com"),
}));

import { createBuilderEngine } from "./builder-engine.js";
import type { EngineStreamOptions } from "./types.js";

const owner = "user:person@example.com";
const org = "org:org-test";
const options: EngineStreamOptions = {
  model: "auto",
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
};

function grant(expiresAt: number, scope = "builder:ai:invoke") {
  return {
    serverUrl: "https://api.builder.io",
    clientInformation: {
      client_id: "example-client",
      issuer: "https://mcp.builder.io",
    },
    discoveryState: {
      authorizationServerUrl: "https://mcp.builder.io",
      authorizationServerMetadata: { issuer: "https://mcp.builder.io" },
      resourceMetadata: { resource: "https://api.builder.io" },
    },
    tokens: {
      access_token: "<ACCESS_TOKEN>",
      refresh_token: "<REFRESH_TOKEN>",
      token_type: "bearer",
      issuer: "https://mcp.builder.io",
      scope,
    },
    tokenExpiresAt: expiresAt,
  };
}

async function run(privateContent = false) {
  const events = [];
  for await (const event of createBuilderEngine({
    privateKey: null,
    publicKey: null,
  }).stream({ ...options, privateContent }))
    events.push(event);
  return events;
}

function gatewaySuccess() {
  return new Response('{"type":"stop","reason":"end_turn"}\n', {
    status: 200,
    headers: { "content-type": "application/jsonl" },
  });
}

describe("Builder engine OAuth refresh lifecycle", () => {
  beforeEach(() => {
    mocks.rows.clear();
    mocks.refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gatewaySuccess()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "keeps an expired grant connected and stops retryably when refresh is temporarily unavailable (private=%s)",
    async (privateContent) => {
      mocks.rows.set(owner, grant(Date.now() - 1));
      mocks.refresh.mockRejectedValue(new Error("private upstream detail"));
      const events = await run(privateContent);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "stop",
          reason: "error",
          errorCode: "http_503",
          statusCode: 503,
          ...(privateContent ? {} : { providerRetryable: true }),
        }),
      );
      expect(JSON.stringify(events)).not.toContain("private upstream detail");
      expect(mocks.rows.get(owner)).not.toHaveProperty(
        "oauthLifecycle.reconnectReason",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("uses an eligible alternate after a transient refresh failure", async () => {
    mocks.rows.set(owner, grant(Date.now() - 1));
    mocks.rows.set(org, grant(Date.now() + 3_600_000));
    mocks.refresh.mockRejectedValue(new Error("temporary outage"));
    const events = await run();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "stop", reason: "end_turn" }),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.rows.get(owner)).not.toHaveProperty(
      "oauthLifecycle.reconnectReason",
    );
    expect(mocks.rows.get(org)).not.toHaveProperty(
      "oauthLifecycle.reconnectReason",
    );
  });

  it("keeps revoked grants distinct from transient failures and uses a valid alternate", async () => {
    mocks.rows.set(owner, grant(Date.now() - 1));
    mocks.rows.set(org, grant(Date.now() + 3_600_000));
    mocks.refresh.mockRejectedValue(
      new OAuthError(OAuthErrorCode.InvalidGrant, "revoked"),
    );
    const events = await run();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "stop", reason: "end_turn" }),
    );
    expect(mocks.rows.get(owner)).toHaveProperty(
      "oauthLifecycle.reconnectReason",
    );
    expect(mocks.rows.get(org)).not.toHaveProperty(
      "oauthLifecycle.reconnectReason",
    );
  });

  it("uses an eligible alternate when the first grant has insufficient scope", async () => {
    mocks.rows.set(
      owner,
      grant(Date.now() + 3_600_000, "builder:assets:write"),
    );
    mocks.rows.set(org, grant(Date.now() + 3_600_000));
    const events = await run();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "stop", reason: "end_turn" }),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.rows.get(owner)).not.toHaveProperty(
      "oauthLifecycle.reconnectReason",
    );
    expect(mocks.rows.get(org)).not.toHaveProperty(
      "oauthLifecycle.reconnectReason",
    );
  });

  it.each(["revoked", "insufficient"] as const)(
    "reports a transient eligible alternate after a %s grant",
    async (first) => {
      mocks.rows.set(
        owner,
        first === "revoked"
          ? grant(Date.now() - 1)
          : grant(Date.now() + 3_600_000, "builder:assets:write"),
      );
      mocks.rows.set(org, grant(Date.now() - 1));
      if (first === "revoked")
        mocks.refresh.mockRejectedValueOnce(
          new OAuthError(OAuthErrorCode.InvalidGrant, "revoked"),
        );
      mocks.refresh.mockRejectedValueOnce(new Error("temporary outage"));
      const events = await run();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "stop",
          reason: "error",
          errorCode: "http_503",
          statusCode: 503,
          providerRetryable: true,
        }),
      );
      if (first === "revoked")
        expect(mocks.rows.get(owner)).toHaveProperty(
          "oauthLifecycle.reconnectReason",
        );
      else
        expect(mocks.rows.get(owner)).not.toHaveProperty(
          "oauthLifecycle.reconnectReason",
        );
      expect(mocks.rows.get(org)).not.toHaveProperty(
        "oauthLifecycle.reconnectReason",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not report an insufficient-scope transient grant as eligible", async () => {
    mocks.rows.set(owner, grant(Date.now() - 1, "builder:assets:write"));
    mocks.refresh.mockRejectedValue(new Error("temporary outage"));
    const events = await run();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "stop",
        reason: "error",
        errorCode: "builder_auth_error",
      }),
    );
    expect(mocks.rows.get(owner)).not.toHaveProperty(
      "oauthLifecycle.reconnectReason",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves retryable status after a 401 and transient forced refresh (private=%s)",
    async (privateContent) => {
      mocks.rows.set(owner, grant(Date.now() + 3_600_000));
      mocks.refresh.mockRejectedValue(new Error("private upstream detail"));
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response("private gateway detail", { status: 401 }),
      );
      const events = await run(privateContent);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "stop",
          reason: "error",
          errorCode: "http_503",
          statusCode: 503,
          ...(privateContent ? {} : { providerRetryable: true }),
        }),
      );
      expect(JSON.stringify(events)).not.toContain("private upstream detail");
      expect(JSON.stringify(events)).not.toContain("private gateway detail");
      expect(fetch).toHaveBeenCalledOnce();
      expect(mocks.rows.get(owner)).not.toHaveProperty(
        "oauthLifecycle.reconnectReason",
      );
    },
  );
});
