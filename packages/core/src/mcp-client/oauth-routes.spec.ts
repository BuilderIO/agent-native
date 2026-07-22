import type { H3Event } from "h3";
import { describe, expect, it } from "vitest";

import {
  isValidMcpOAuthFlow,
  redirectWithStagedCookies,
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
