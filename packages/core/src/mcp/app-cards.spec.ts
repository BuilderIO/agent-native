// oracle-change(packages/core/src/mcp/app-cards-lab.spec.ts): the per-person cards lab is deleted; cards now follow the default rule tested here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetRetiredInlineEnvWarningForTests,
  isMcpAppsInlineEnabled,
  warnIfRetiredInlineEnvSet,
} from "./app-cards.js";
import type { MCPCallerIdentity } from "./build-server.js";

const RETIRED_ENV_VARS = [
  "AGENT_NATIVE_MCP_APPS_INLINE",
  "AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS",
];

const ISSUED_AT_MS = Date.UTC(2026, 10, 1);

function person(userEmail: string, orgId?: string): MCPCallerIdentity {
  return {
    userEmail,
    orgDomain: undefined,
    identityAssurance: "user",
    mcpCredentialIssuedAtMs: ISSUED_AT_MS,
    oauthScopes: ["mcp:read", "mcp:write", "mcp:apps"],
    ...(orgId ? { orgId } : {}),
  };
}

describe("MCP Apps cards for each caller", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetRetiredInlineEnvWarningForTests();
    for (const name of RETIRED_ENV_VARS) delete process.env[name];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const name of RETIRED_ENV_VARS) delete process.env[name];
    warn.mockRestore();
  });

  it("gives cards to a person connected with write access", () => {
    expect(isMcpAppsInlineEnabled(person("alice@example.com"))).toBe(true);
    expect(isMcpAppsInlineEnabled(person("bob@example.com", "org_1"))).toBe(
      true,
    );
    expect(
      isMcpAppsInlineEnabled({
        ...person("carol@example.com"),
        oauthScopes: undefined,
      }),
    ).toBe(true);
  });

  it("gives no cards to a read-only grant or a credential with no issue time", () => {
    expect(
      isMcpAppsInlineEnabled({
        ...person("alice@example.com"),
        oauthScopes: ["mcp:read", "mcp:apps"],
      }),
    ).toBe(false);
    expect(
      isMcpAppsInlineEnabled({
        ...person("alice@example.com"),
        mcpCredentialIssuedAtMs: undefined,
      }),
    ).toBe(false);
    expect(
      isMcpAppsInlineEnabled({
        ...person("alice@example.com"),
        mcpCredentialIssuedAtMs: Number.NaN,
      }),
    ).toBe(false);
  });

  it("gives no cards to a caller that is not a signed-in person", () => {
    expect(
      isMcpAppsInlineEnabled({
        userEmail: "owner@example.com",
        orgDomain: undefined,
        mcpCredentialIssuedAtMs: ISSUED_AT_MS,
      }),
    ).toBe(false);
    expect(
      isMcpAppsInlineEnabled({
        ...person("svc-ci@service.org_1", "org_1"),
        identityAssurance: "service",
      }),
    ).toBe(false);
    expect(
      isMcpAppsInlineEnabled({
        ...person("member@example.com", "org_1"),
        identityAssurance: "org-member",
      }),
    ).toBe(false);
    expect(
      isMcpAppsInlineEnabled({
        userEmail: undefined,
        orgDomain: "example.com",
        identityAssurance: "organization",
      }),
    ).toBe(false);
    expect(isMcpAppsInlineEnabled(person("  "))).toBe(false);
    expect(isMcpAppsInlineEnabled(undefined)).toBe(false);
  });

  it("ignores the retired env vars", () => {
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "0";
    process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS = "bob@example.com";

    expect(isMcpAppsInlineEnabled(person("frank@example.com"))).toBe(true);
    expect(
      isMcpAppsInlineEnabled({
        userEmail: "bob@example.com",
        orgDomain: undefined,
      }),
    ).toBe(false);
  });

  it("warns once when both retired env vars are set", () => {
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "0";
    process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS = "bob@example.com";

    warnIfRetiredInlineEnvSet();
    warnIfRetiredInlineEnvSet();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("AGENT_NATIVE_MCP_APPS_INLINE and ");
    expect(message).toContain("AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS");
    expect(message).toContain("ignored");
    expect(message).toContain(
      "on by default for people connected with write access",
    );
  });

  it("warns about a single retired env var too", () => {
    process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS = "bob@example.com";

    warnIfRetiredInlineEnvSet();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /^\[mcp\] AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS is ignored\./,
    );
  });

  it("stays quiet when no retired env var is set", () => {
    warnIfRetiredInlineEnvSet();
    expect(isMcpAppsInlineEnabled(person("alice@example.com"))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
