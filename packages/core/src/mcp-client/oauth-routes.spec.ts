import { mockEvent, type H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveSecretPairsMock = vi.hoisted(() => vi.fn());
const CredentialStoreUnavailableErrorMock = vi.hoisted(
  () =>
    class CredentialStoreUnavailableErrorMock extends Error {
      readonly errorCode = "credential_store_unavailable";
      readonly retryable = true;
    },
);
const McpOAuthRegistrationUnsupportedErrorMock = vi.hoisted(
  () =>
    class McpOAuthRegistrationUnsupportedErrorMock extends Error {
      readonly issuer?: string;
      readonly authorizationServerUrl?: string;

      constructor(details: {
        issuer?: string;
        authorizationServerUrl?: string;
      }) {
        super("MCP OAuth dynamic client registration is unsupported");
        this.name = "McpOAuthRegistrationUnsupportedError";
        this.issuer = details.issuer;
        this.authorizationServerUrl = details.authorizationServerUrl;
      }
    },
);

vi.mock("../server/credential-provider.js", () => ({
  CredentialStoreUnavailableError: CredentialStoreUnavailableErrorMock,
  resolveSecretPairs: resolveSecretPairsMock,
}));

const callbackMocks = vi.hoisted(() => ({
  addOAuthRemoteServer: vi.fn(),
  finishMcpOAuthAuthorization: vi.fn(),
  getH3App: vi.fn(),
  getOrgContext: vi.fn(),
  getSession: vi.fn(),
  listRemoteServers: vi.fn(),
  readMcpOAuthCredentials: vi.fn(),
  replaceOAuthRemoteServer: vi.fn(),
  resolveMcpOAuthAuthorizationServerDiscovery: vi.fn(),
  resolveMcpOAuthAuthorizationServerUrl: vi.fn(),
  startMcpOAuthAuthorization: vi.fn(),
  validateMcpOAuthCallbackIssuer: vi.fn(),
}));

vi.mock("../server/auth.js", () => ({
  getSession: callbackMocks.getSession,
  safeReturnPath: (value: string) => value,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: callbackMocks.getOrgContext,
}));

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: callbackMocks.getH3App,
}));

vi.mock("./oauth-client.js", () => ({
  finishMcpOAuthAuthorization: callbackMocks.finishMcpOAuthAuthorization,
  isGoogleWorkspaceMcpServer: () => false,
  McpOAuthRegistrationUnsupportedError:
    McpOAuthRegistrationUnsupportedErrorMock,
  readMcpOAuthCredentials: callbackMocks.readMcpOAuthCredentials,
  resolveMcpOAuthAuthorizationServerDiscovery:
    callbackMocks.resolveMcpOAuthAuthorizationServerDiscovery,
  resolveMcpOAuthAuthorizationServerUrl:
    callbackMocks.resolveMcpOAuthAuthorizationServerUrl,
  startMcpOAuthAuthorization: callbackMocks.startMcpOAuthAuthorization,
  validateMcpOAuthCallbackIssuer: callbackMocks.validateMcpOAuthCallbackIssuer,
}));

vi.mock("./remote-store.js", () => ({
  addOAuthRemoteServer: callbackMocks.addOAuthRemoteServer,
  listRemoteServers: callbackMocks.listRemoteServers,
  normalizeServerName: (value: string) => value.trim(),
  replaceOAuthRemoteServer: callbackMocks.replaceOAuthRemoteServer,
  validateRemoteUrl: (value: string) => {
    try {
      return { ok: true, url: new URL(value) };
    } catch {
      return { ok: false, error: "MCP server URL is invalid." };
    }
  },
}));

import {
  DEFAULT_MCP_INTEGRATIONS,
  mcpUrlRequiresOrganizationScope,
} from "../client/resources/mcp-integration-catalog.js";
import { CredentialStoreUnavailableError } from "../server/credential-provider.js";
import { McpOAuthRegistrationUnsupportedError } from "./oauth-client.js";
import {
  bindMcpOAuthAuthorizationScope,
  clearMcpOAuthFlowCookies,
  isValidMcpOAuthFlow,
  mcpOAuthStartFailureResponse,
  readMcpOAuthFlowCookie,
  redirectWithStagedCookies,
  resolveMcpOAuthStartError,
  resolveMcpOAuthScope,
  describeMcpOAuthScopeViolation,
  resolveTrustedMcpOAuthAuthorizationScope,
  resolveManagedMcpOAuthClient,
  resolveMcpOAuthReturnPath,
  mountMcpOAuthRoutes,
  setMcpOAuthFlowCookie,
  stripMcpOAuthAppBasePath,
  wantsHtmlResponse,
  type McpOAuthFlow,
} from "./oauth-routes.js";

describe("trusted MCP OAuth authorization scopes", () => {
  it("pins Builder Publish to its read-only scope", () => {
    expect(
      resolveTrustedMcpOAuthAuthorizationScope(
        new URL("https://mcp.builder.io/mcp/publish"),
      ),
    ).toBe("mcp:publish:read");
    expect(
      resolveTrustedMcpOAuthAuthorizationScope(
        new URL("https://mcp.builder.io/mcp/publish/"),
      ),
    ).toBe("mcp:publish:read");
    expect(
      resolveTrustedMcpOAuthAuthorizationScope(
        new URL("https://mcp.builder.io/mcp/fusion"),
      ),
    ).toBeUndefined();
  });

  it("requires Builder Publish connections to use organization scope", () => {
    const serverUrl = new URL("https://mcp.builder.io/mcp/publish");

    expect(resolveMcpOAuthScope(serverUrl, "user")).toEqual({
      ok: false,
      violation: "organization-scope-required",
    });
    expect(resolveMcpOAuthScope(serverUrl, undefined)).toEqual({
      ok: false,
      violation: "organization-scope-required",
    });
    expect(resolveMcpOAuthScope(serverUrl, "org")).toEqual({
      ok: true,
      scope: "org",
    });
  });

  it("explains each violated scope constraint in its own direction", () => {
    const orgOnly = describeMcpOAuthScopeViolation(
      "organization-scope-required",
    );
    const personalOnly = describeMcpOAuthScopeViolation(
      "personal-scope-required",
    );

    expect(orgOnly).not.toBe(personalOnly);
    expect(orgOnly).toMatch(/set up for your workspace/i);
    expect(orgOnly).toMatch(/owner or admin/i);
    expect(orgOnly).not.toMatch(/personal connection/i);
    expect(personalOnly).toMatch(/personal connection/i);
    expect(personalOnly).not.toMatch(/set up for your workspace/i);

    for (const message of [orgOnly, personalOnly]) {
      expect(message).not.toMatch(/managed mcp oauth/i);
      expect(message).not.toMatch(/scope/i);
    }
  });

  it("records the trusted read scope when the token response omits scope", () => {
    const credentials = {
      serverUrl: "https://mcp.builder.io/mcp/publish",
      clientInformation: { client_id: "builder-client" },
      tokens: { access_token: "builder-token" },
    };

    expect(
      bindMcpOAuthAuthorizationScope(
        { authorizationScope: "mcp:publish:read" },
        credentials,
      ).tokens.scope,
    ).toBe("mcp:publish:read");
  });
});

const baseFlow: McpOAuthFlow = {
  name: "linear",
  url: "https://mcp.example.com/mcp",
  scope: "user",
  scopeId: "alice@example.com",
  owner: "alice@example.com",
  redirectUri:
    "https://app.example.com/_agent-native/mcp/servers/oauth/callback",
  state: "<STATE>",
  codeVerifier: "<CODE_VERIFIER>",
  clientInformation: { client_id: "mcp-client-test" },
  expiresAt: Date.now() + 60_000,
};

const persistedServer = {
  id: "mcp-linear",
  name: "linear",
  url: baseFlow.url,
  createdAt: Date.now(),
};

describe("MCP OAuth callback flow validation", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_SECRET", "oauth-routes-test-secret");
    callbackMocks.addOAuthRemoteServer.mockReset();
    callbackMocks.finishMcpOAuthAuthorization.mockReset();
    callbackMocks.getH3App.mockReset();
    callbackMocks.getOrgContext.mockReset().mockResolvedValue(null);
    callbackMocks.getSession
      .mockReset()
      .mockResolvedValue({ email: "alice@example.com" });
    callbackMocks.listRemoteServers.mockReset();
    callbackMocks.readMcpOAuthCredentials.mockReset();
    callbackMocks.replaceOAuthRemoteServer.mockReset();
    callbackMocks.resolveMcpOAuthAuthorizationServerDiscovery.mockReset();
    callbackMocks.resolveMcpOAuthAuthorizationServerUrl.mockReset();
    callbackMocks.startMcpOAuthAuthorization.mockReset();
    callbackMocks.validateMcpOAuthCallbackIssuer.mockReset();
    callbackMocks.finishMcpOAuthAuthorization.mockResolvedValue({
      credentials: {
        serverUrl: baseFlow.url,
        clientInformation: baseFlow.clientInformation,
        tokens: { access_token: "access-token", token_type: "bearer" },
      },
    });
    callbackMocks.addOAuthRemoteServer.mockResolvedValue({
      ok: true,
      server: persistedServer,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes an OAuth metadata hint through the start route", async () => {
    const routes: Array<{ handler: (event: H3Event) => unknown }> = [];
    callbackMocks.getH3App.mockReturnValue({
      use: (_base: string, handler: (event: H3Event) => unknown) => {
        routes.push({ handler });
      },
    });
    callbackMocks.resolveMcpOAuthAuthorizationServerDiscovery.mockResolvedValue(
      {
        authorizationServerUrl: "https://auth.example.com/tenant",
        authorizationServerMetadata: {
          issuer: "https://auth.example.com/tenant",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
        },
      },
    );
    callbackMocks.startMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: new URL("https://auth.example.com/authorize"),
      codeVerifier: "<CODE_VERIFIER>",
      state: "<STATE>",
      clientInformation: { client_id: "mcp-client" },
    });
    mountMcpOAuthRoutes({}, { reconfigure: vi.fn() });

    const event = mockEvent(
      new Request(
        "https://app.example.com/start?name=linear&url=https%3A%2F%2Fmcp.example.com%2Fmcp&oauthMetadataUrl=https%3A%2F%2Fauth.example.com%2F.well-known%2Fcustom",
      ),
    );
    await routes[0]!.handler(event);

    expect(
      callbackMocks.resolveMcpOAuthAuthorizationServerDiscovery,
    ).toHaveBeenCalledWith("https://auth.example.com/.well-known/custom");
    expect(callbackMocks.startMcpOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        discoveryState: {
          authorizationServerUrl: "https://auth.example.com/tenant",
          authorizationServerMetadata: {
            issuer: "https://auth.example.com/tenant",
            authorization_endpoint: "https://auth.example.com/authorize",
            token_endpoint: "https://auth.example.com/token",
            registration_endpoint: "https://auth.example.com/register",
          },
        },
      }),
    );
  });

  it("reuses the authorization server from a saved OAuth grant", async () => {
    const routes: Array<{ handler: (event: H3Event) => unknown }> = [];
    callbackMocks.getH3App.mockReturnValue({
      use: (_base: string, handler: (event: H3Event) => unknown) => {
        routes.push({ handler });
      },
    });
    callbackMocks.listRemoteServers.mockResolvedValue([
      { ...persistedServer, oauthSecretKey: "mcp_oauth:stored" },
    ]);
    callbackMocks.readMcpOAuthCredentials.mockResolvedValue({
      discoveryState: {
        authorizationServerUrl: "https://auth.example.com/tenant",
      },
    });
    callbackMocks.startMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: new URL("https://auth.example.com/authorize"),
      codeVerifier: "<CODE_VERIFIER>",
      state: "<STATE>",
      clientInformation: { client_id: "mcp-client" },
    });
    mountMcpOAuthRoutes({}, { reconfigure: vi.fn() });

    const event = mockEvent(
      new Request(
        "https://app.example.com/start?serverId=mcp-linear&scope=user",
      ),
    );
    await routes[0]!.handler(event);

    expect(callbackMocks.readMcpOAuthCredentials).toHaveBeenCalledWith({
      key: "mcp_oauth:stored",
      scope: "user",
      scopeId: "alice@example.com",
      serverUrl: baseFlow.url,
    });
    expect(callbackMocks.startMcpOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        discoveryState: {
          authorizationServerUrl: "https://auth.example.com/tenant",
        },
      }),
    );
  });

  it("returns to integrations when OAuth saved credentials do not connect", () => {
    expect(resolveMcpOAuthReturnPath(false, { ...baseFlow })).toBe(
      "/settings/integrations",
    );
    expect(
      resolveMcpOAuthReturnPath(true, {
        ...baseFlow,
        returnUrl: "/chat?thread=meeting-actions",
      }),
    ).toBe("/chat?thread=meeting-actions");
  });

  it("carries staged cookies on native redirects", () => {
    const event = {
      res: { headers: new Headers() },
    } as unknown as H3Event;
    event.res.headers.append(
      "set-cookie",
      "an_mcp_oauth_flow=encrypted-flow; Path=/; HttpOnly",
    );

    const response = redirectWithStagedCookies(
      event,
      "https://mcp-auth.example.com/oauth/authorize",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://mcp-auth.example.com/oauth/authorize",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "an_mcp_oauth_flow=encrypted-flow",
    );
  });

  it("round-trips large flow state in browser-safe cookie chunks", () => {
    const flow = {
      ...baseFlow,
      discoveryState: {
        authorizationServerUrl: "https://mcp-auth.example.com",
        authorizationServerMetadata: {
          issuer: "https://mcp-auth.example.com",
          authorization_endpoint:
            "https://mcp-auth.example.com/oauth2/authorize",
          token_endpoint: "https://mcp-auth.example.com/oauth2/token",
          registration_endpoint: "https://mcp-auth.example.com/oauth2/register",
          scopes_supported: Array.from(
            { length: 160 },
            (_, index) => `scope-${index}`,
          ),
        },
      },
    } satisfies McpOAuthFlow;
    const writeEvent = mockEvent(new Request("http://app.example.com"));

    setMcpOAuthFlowCookie(writeEvent, flow, false);

    const setCookies = writeEvent.res.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThan(1);
    expect(
      setCookies.every((cookie) => Buffer.byteLength(cookie) < 4_096),
    ).toBe(true);

    const readEvent = eventWithCookies(setCookies);
    expect(readMcpOAuthFlowCookie(readEvent)).toEqual(flow);
  });

  it("continues to read the legacy single-cookie flow format", () => {
    const writeEvent = mockEvent(new Request("http://app.example.com"));
    setMcpOAuthFlowCookie(writeEvent, baseFlow, false);
    const setCookies = writeEvent.res.headers.getSetCookie();

    expect(setCookies).toHaveLength(1);
    expect(readMcpOAuthFlowCookie(eventWithCookies(setCookies))).toEqual(
      baseFlow,
    );
  });

  it("rejects an invalid chunk marker instead of reading a flow", () => {
    const event = mockEvent(
      new Request("http://app.example.com", {
        headers: { cookie: "an_mcp_oauth_flow=__chunked__1" },
      }),
    );

    expect(readMcpOAuthFlowCookie(event)).toBeNull();
  });

  it("rejects flow state that exceeds the bounded chunk count", () => {
    const event = mockEvent(new Request("http://app.example.com"));

    expect(() =>
      setMcpOAuthFlowCookie(
        event,
        { ...baseFlow, description: "x".repeat(12_000) },
        false,
      ),
    ).toThrow("MCP OAuth flow state exceeds the cookie size limit.");
    expect(event.res.headers.getSetCookie()).toHaveLength(0);
  });

  it("deletes the primary flow cookie and every bounded chunk", () => {
    const event = mockEvent(new Request("http://app.example.com"));

    clearMcpOAuthFlowCookies(event);

    const deletedCookies = event.res.headers.getSetCookie();
    expect(deletedCookies).toHaveLength(9);
    expect(deletedCookies.map(cookieName)).toEqual([
      "an_mcp_oauth_flow",
      "an_mcp_oauth_flow.1",
      "an_mcp_oauth_flow.2",
      "an_mcp_oauth_flow.3",
      "an_mcp_oauth_flow.4",
      "an_mcp_oauth_flow.5",
      "an_mcp_oauth_flow.6",
      "an_mcp_oauth_flow.7",
      "an_mcp_oauth_flow.8",
    ]);
    expect(deletedCookies.every((cookie) => cookie.includes("Max-Age=0"))).toBe(
      true,
    );
  });

  it("binds a user flow to the initiating user without requiring an org", () => {
    expect(
      isValidMcpOAuthFlow(baseFlow, "alice@example.com", undefined, "<STATE>"),
    ).toBe(true);
    expect(
      isValidMcpOAuthFlow(baseFlow, "bob@example.com", undefined, "<STATE>"),
    ).toBe(false);
    expect(
      isValidMcpOAuthFlow(
        baseFlow,
        "alice@example.com",
        "org-other",
        "<STATE>",
      ),
    ).toBe(true);
    expect(
      isValidMcpOAuthFlow(
        { ...baseFlow, orgId: "org-acme" },
        "alice@example.com",
        "org-acme",
        "<STATE>",
      ),
    ).toBe(false);
  });

  it("binds an organization flow to the initiating organization", () => {
    const orgFlow: McpOAuthFlow = {
      ...baseFlow,
      scope: "org",
      scopeId: "org-acme",
      orgId: "org-acme",
    };

    expect(
      isValidMcpOAuthFlow(orgFlow, "alice@example.com", "org-acme", "<STATE>"),
    ).toBe(true);
    expect(
      isValidMcpOAuthFlow(orgFlow, "alice@example.com", "org-other", "<STATE>"),
    ).toBe(false);
  });

  it("rejects expired or replayed state", () => {
    expect(
      isValidMcpOAuthFlow(
        { ...baseFlow, expiresAt: Date.now() - 1 },
        "alice@example.com",
        undefined,
        "<STATE>",
      ),
    ).toBe(false);
    expect(
      isValidMcpOAuthFlow(
        baseFlow,
        "alice@example.com",
        undefined,
        "<OTHER_STATE>",
      ),
    ).toBe(false);
  });

  it("accepts the shared Google callback for workspace MCP OAuth", () => {
    expect(
      isValidMcpOAuthFlow(
        {
          ...baseFlow,
          redirectUri: "https://app.example.com/_agent-native/google/callback",
        },
        "alice@example.com",
        undefined,
        "<STATE>",
      ),
    ).toBe(true);
  });
});

describe("managed MCP OAuth clients", () => {
  it("strips the mounted app path before getAppUrl prefixes it", () => {
    expect(
      stripMcpOAuthAppBasePath(
        "/workspace/settings/integrations?connected=mcp-linear",
        "/workspace",
      ),
    ).toBe("/settings/integrations?connected=mcp-linear");
    expect(
      stripMcpOAuthAppBasePath("/settings/integrations", "/workspace"),
    ).toBe("/settings/integrations");
    expect(
      stripMcpOAuthAppBasePath("/workspace?connected=1", "/workspace"),
    ).toBe("/?connected=1");
    expect(stripMcpOAuthAppBasePath("/workspace#tab", "/workspace")).toBe(
      "/#tab",
    );
  });

  it("rejects organization scope for managed MCP OAuth servers", () => {
    expect(
      resolveMcpOAuthScope(new URL("https://mcp.hubspot.com"), "org"),
    ).toEqual({ ok: false, violation: "personal-scope-required" });
    expect(
      resolveMcpOAuthScope(new URL("https://mcp.hubspot.com"), "org", {
        allowManagedOrgReconnect: true,
      }),
    ).toEqual({ ok: true, scope: "org" });
    expect(
      resolveMcpOAuthScope(new URL("https://drivemcp.googleapis.com"), "org", {
        allowManagedOrgReconnect: true,
      }),
    ).toEqual({ ok: true, scope: "org" });
    expect(
      resolveMcpOAuthScope(new URL("https://mcp.hubspot.com"), "user"),
    ).toEqual({ ok: true, scope: "user" });
    expect(
      resolveMcpOAuthScope(new URL("https://mcp.example.com"), "org"),
    ).toEqual({ ok: true, scope: "org" });
  });

  it("matches the server org-only rule for hand-entered Builder Publish URLs", () => {
    for (const raw of [
      "https://mcp.builder.io/mcp/publish",
      "https://mcp.builder.io/mcp/publish/",
    ]) {
      expect(mcpUrlRequiresOrganizationScope(raw)).toBe(true);
      expect(resolveMcpOAuthScope(new URL(raw), "user").ok).toBe(false);
    }
    for (const raw of [
      "https://mcp.builder.io/mcp/fusion",
      "https://mcp.builder.io/mcp/publish?x=1",
      "https://mcp.builder.io/mcp/publish#frag",
      "https://mcp.example.com/mcp",
    ]) {
      expect(mcpUrlRequiresOrganizationScope(raw)).toBe(false);
      expect(resolveMcpOAuthScope(new URL(raw), "user")).toEqual({
        ok: true,
        scope: "user",
      });
    }
    for (const raw of ["https://mcp.hubspot.com", "not-a-url"]) {
      expect(mcpUrlRequiresOrganizationScope(raw)).toBe(false);
    }
  });

  it("keeps every catalog scope flag in step with what the server enforces", () => {
    for (const integration of DEFAULT_MCP_INTEGRATIONS) {
      if (integration.authMode !== "oauth" || !integration.url) continue;
      const serverUrl = new URL(integration.url);

      expect({
        id: integration.id,
        organizationScopeOnly: integration.organizationScopeOnly === true,
      }).toEqual({
        id: integration.id,
        organizationScopeOnly: !resolveMcpOAuthScope(serverUrl, "user").ok,
      });

      expect({
        id: integration.id,
        urlRequiresOrg: mcpUrlRequiresOrganizationScope(integration.url),
      }).toEqual({
        id: integration.id,
        urlRequiresOrg: !resolveMcpOAuthScope(serverUrl, "user").ok,
      });

      expect({
        id: integration.id,
        managedOAuth: integration.managedOAuth === true,
      }).toEqual({
        id: integration.id,
        managedOAuth: !resolveMcpOAuthScope(serverUrl, "org").ok,
      });
    }
  });

  it("resolves the workspace HubSpot client without exposing its secret to the browser", async () => {
    resolveSecretPairsMock.mockImplementation(
      async ([[clientIdKey, clientSecretKey]]) =>
        clientIdKey === "HUBSPOT_MCP_CLIENT_ID" &&
        clientSecretKey === "HUBSPOT_MCP_CLIENT_SECRET"
          ? ["hubspot-client-id", "hubspot-client-secret"]
          : null,
    );

    await expect(
      resolveManagedMcpOAuthClient(new URL("https://mcp.hubspot.com")),
    ).resolves.toEqual({
      client_id: "hubspot-client-id",
      client_secret: "hubspot-client-secret",
      token_endpoint_auth_method: "client_secret_post",
    });
  });

  it("resolves the shared Google client for official Workspace MCP servers", async () => {
    resolveSecretPairsMock.mockImplementation(
      async ([[clientIdKey, clientSecretKey]]) =>
        clientIdKey === "GOOGLE_CLIENT_ID" &&
        clientSecretKey === "GOOGLE_CLIENT_SECRET"
          ? ["google-client-id", "google-client-secret"]
          : null,
    );

    for (const origin of [
      "https://gmailmcp.googleapis.com",
      "https://drivemcp.googleapis.com",
      "https://docsmcp.googleapis.com",
      "https://sheetsmcp.googleapis.com",
      "https://slidesmcp.googleapis.com",
      "https://calendarmcp.googleapis.com",
      "https://chatmcp.googleapis.com",
      "https://people.googleapis.com",
      "https://workspacemcp.googleapis.com",
    ]) {
      await expect(
        resolveManagedMcpOAuthClient(new URL(`${origin}/mcp/v1`)),
      ).resolves.toEqual({
        client_id: "google-client-id",
        client_secret: "google-client-secret",
        token_endpoint_auth_method: "client_secret_post",
      });
      expect(resolveMcpOAuthScope(new URL(origin), "org")).toEqual({
        ok: false,
        violation: "personal-scope-required",
      });
    }
    expect(resolveSecretPairsMock).toHaveBeenLastCalledWith(
      [["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]],
      { allowUserScope: false, preferWorkspaceScope: true },
    );
  });

  it("does not resolve a managed client for an unrelated MCP server", async () => {
    resolveSecretPairsMock.mockReset();

    await expect(
      resolveManagedMcpOAuthClient(new URL("https://mcp.example.com")),
    ).resolves.toBeUndefined();
    expect(resolveSecretPairsMock).not.toHaveBeenCalled();
  });
});

describe("MCP OAuth start failures", () => {
  it("preserves credential-store outages as retryable service errors", () => {
    const result = resolveMcpOAuthStartError(
      new CredentialStoreUnavailableError("database timeout"),
    );

    expect(result).toEqual({
      status: 503,
      body: {
        error: "database timeout",
        errorCode: "credential_store_unavailable",
        retryable: true,
      },
    });
  });

  it("keeps remote OAuth failures as client errors", () => {
    expect(resolveMcpOAuthStartError(new Error("discovery failed"))).toEqual({
      status: 400,
      body: {
        error:
          "This MCP server could not start OAuth. Check that the server URL is correct, then try again.",
        errorCode: "oauth_start_failed",
      },
    });
  });

  // GitHub's authorization server advertises no registration_endpoint, so the
  // generic message told users to retry a flow that can never succeed.
  it("names the authorization server that cannot register a client", () => {
    const failure = resolveMcpOAuthStartError(
      new McpOAuthRegistrationUnsupportedError({
        issuer: "https://github.com/login/oauth",
        authorizationServerUrl: "https://github.com/login/oauth",
      }),
    );

    expect(failure.status).toBe(400);
    expect(failure.body.errorCode).toBe(
      "oauth_dynamic_registration_unsupported",
    );
    expect(failure.body.retryable).toBe(false);
    expect(failure.body.error).toContain("github.com/login/oauth");
    expect(failure.body.error).toContain("Authorization: Bearer <token>");
  });

  it("falls back to the authorization server URL when no issuer was published", () => {
    const failure = resolveMcpOAuthStartError(
      new McpOAuthRegistrationUnsupportedError({
        authorizationServerUrl: "https://auth.example.com/tenant/",
      }),
    );

    expect(failure.body.error).toContain("auth.example.com/tenant");
  });

  it("still describes the failure when discovery named no server at all", () => {
    const failure = resolveMcpOAuthStartError(
      new McpOAuthRegistrationUnsupportedError({}),
    );

    expect(failure.body.errorCode).toBe(
      "oauth_dynamic_registration_unsupported",
    );
    expect(failure.body.error).toContain("sign-in provider");
  });
});

describe("MCP OAuth start failure rendering", () => {
  const htmlEvent = () =>
    mockEvent(
      new Request(
        "http://app.example.com/_agent-native/mcp/servers/oauth/start",
        {
          headers: { accept: "text/html,application/xhtml+xml" },
        },
      ),
    );
  const jsonEvent = () =>
    mockEvent(
      new Request(
        "http://app.example.com/_agent-native/mcp/servers/oauth/start",
        {
          headers: { accept: "application/json" },
        },
      ),
    );

  it("recognizes a browser navigation from its Accept header", () => {
    expect(wantsHtmlResponse(htmlEvent())).toBe(true);
    expect(wantsHtmlResponse(jsonEvent())).toBe(false);
  });

  it("renders an HTML page for the popup instead of the raw JSON body", async () => {
    const response = mcpOAuthStartFailureResponse(htmlEvent(), {
      status: 400,
      body: { error: "GitHub cannot register a client.", errorCode: "x" },
    });

    expect(response).toBeInstanceOf(Response);
    const html = await (response as Response).text();
    expect((response as Response).status).toBe(400);
    expect((response as Response).headers.get("content-type")).toContain(
      "text/html",
    );
    expect(html).toContain("GitHub cannot register a client.");
    expect(html).not.toContain('{"error"');
  });

  it("escapes the message it renders", async () => {
    const response = mcpOAuthStartFailureResponse(htmlEvent(), {
      status: 400,
      body: { error: "<img src=x onerror=alert(1)>" },
    });

    const html = await (response as Response).text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("carries the staged flow-cookie deletion onto the HTML page", async () => {
    const event = htmlEvent();
    clearMcpOAuthFlowCookies(event);
    const staged = event.res.headers.getSetCookie();
    expect(staged.length).toBeGreaterThan(0);

    const response = mcpOAuthStartFailureResponse(event, {
      status: 400,
      body: { error: "MCP OAuth state is invalid or expired." },
    }) as Response;

    expect(response.headers.getSetCookie()).toEqual(staged);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain(
      "MCP OAuth state is invalid or expired.",
    );
  });

  it("keeps the JSON body for non-browser callers", () => {
    const event = jsonEvent();
    const response = mcpOAuthStartFailureResponse(event, {
      status: 503,
      body: { error: "store down", errorCode: "credential_store_unavailable" },
    });

    expect(response).toEqual({
      error: "store down",
      errorCode: "credential_store_unavailable",
    });
    expect(event.res.status).toBe(503);
  });
});

function eventWithCookies(setCookies: string[]): H3Event {
  const cookieHeader = setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
  return mockEvent(
    new Request("http://app.example.com", {
      headers: { cookie: cookieHeader },
    }),
  );
}

async function invokeCallback(
  flow: McpOAuthFlow,
  query: { state?: string; code?: string; error?: string },
  reconfigure: () => Promise<boolean>,
): Promise<{ result: unknown; event: H3Event }> {
  const writeEvent = mockEvent(
    new Request(
      "https://app.example.com/_agent-native/mcp/servers/oauth/start",
    ),
  );
  setMcpOAuthFlowCookie(writeEvent, flow, false);
  const cookie = writeEvent.res.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const params = new URLSearchParams({
    state: query.state ?? flow.state,
    ...(query.code === undefined ? { code: "authorization-code" } : {}),
    ...(query.code === undefined ? {} : { code: query.code }),
    ...(query.error === undefined ? {} : { error: query.error }),
  });
  const event = mockEvent(
    new Request(`https://app.example.com/callback?${params.toString()}`, {
      headers: { cookie },
    }),
  );
  const routes: Array<{ handler: (event: H3Event) => unknown }> = [];
  callbackMocks.getH3App.mockReturnValue({
    use: (_base: string, handler: (event: H3Event) => unknown) => {
      routes.push({ handler });
    },
  });
  mountMcpOAuthRoutes({}, { reconfigure });
  return { result: await routes[0]!.handler(event), event };
}

function cookieName(setCookie: string): string {
  return setCookie.slice(0, setCookie.indexOf("="));
}
