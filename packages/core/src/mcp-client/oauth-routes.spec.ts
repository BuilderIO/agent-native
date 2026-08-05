import { mockEvent, type H3Event } from "h3";
import { describe, expect, it } from "vitest";

import {
  clearMcpOAuthFlowCookies,
  isValidMcpOAuthFlow,
  readMcpOAuthFlowCookie,
  redirectWithStagedCookies,
  setMcpOAuthFlowCookie,
  type McpOAuthFlow,
} from "./oauth-routes.js";

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
