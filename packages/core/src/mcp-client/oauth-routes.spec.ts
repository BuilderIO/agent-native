import { mockEvent, type H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

const resolveSecretPairsMock = vi.hoisted(() => vi.fn());
const CredentialStoreUnavailableErrorMock = vi.hoisted(
  () =>
    class CredentialStoreUnavailableErrorMock extends Error {
      readonly errorCode = "credential_store_unavailable";
      readonly retryable = true;
    },
);

vi.mock("../server/credential-provider.js", () => ({
  CredentialStoreUnavailableError: CredentialStoreUnavailableErrorMock,
  resolveSecretPairs: resolveSecretPairsMock,
}));

import { CredentialStoreUnavailableError } from "../server/credential-provider.js";
import {
  bindMcpOAuthAuthorizationScope,
  clearMcpOAuthFlowCookies,
  isValidMcpOAuthFlow,
  readMcpOAuthFlowCookie,
  redirectWithStagedCookies,
  resolveMcpOAuthStartError,
  resolveMcpOAuthScope,
  resolveTrustedMcpOAuthAuthorizationScope,
  resolveManagedMcpOAuthClient,
  setMcpOAuthFlowCookie,
  stripMcpOAuthAppBasePath,
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
        new URL("https://mcp.builder.io/mcp/fusion"),
      ),
    ).toBeUndefined();
  });

  it("requires Builder Publish connections to use organization scope", () => {
    const serverUrl = new URL("https://mcp.builder.io/mcp/publish");

    expect(resolveMcpOAuthScope(serverUrl, "user")).toBeNull();
    expect(resolveMcpOAuthScope(serverUrl, undefined)).toBeNull();
    expect(resolveMcpOAuthScope(serverUrl, "org")).toBe("org");
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

describe("MCP OAuth callback flow validation", () => {
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
    ).toBeNull();
    expect(
      resolveMcpOAuthScope(new URL("https://mcp.hubspot.com"), "org", {
        allowManagedOrgReconnect: true,
      }),
    ).toBe("org");
    expect(
      resolveMcpOAuthScope(new URL("https://drivemcp.googleapis.com"), "org", {
        allowManagedOrgReconnect: true,
      }),
    ).toBe("org");
    expect(
      resolveMcpOAuthScope(new URL("https://mcp.hubspot.com"), "user"),
    ).toBe("user");
    expect(
      resolveMcpOAuthScope(new URL("https://mcp.example.com"), "org"),
    ).toBe("org");
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
      expect(resolveMcpOAuthScope(new URL(origin), "org")).toBeNull();
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
          "This MCP server could not start OAuth. It may not support standard MCP OAuth discovery or dynamic client registration.",
      },
    });
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

function cookieName(setCookie: string): string {
  return setCookie.slice(0, setCookie.indexOf("="));
}
