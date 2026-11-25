import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ActionContractError,
  AgentConnectionRequiredError,
} from "../action.js";
import {
  extractMcpConnectionRequiredFromError,
  extractMcpConnectionRequiredFromResult,
  isMcpActionConnectionState,
  MCP_CONNECTION_REQUIRED_TTL_SECONDS,
  resolveTrustedMcpConnectUrl,
} from "./execute-action-call.js";

const APP_ORIGIN = "https://calendar.agent-native.com";

describe("execute-action-call connection_required helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes a 10-minute TTL and validates McpActionConnectionState payloads", () => {
    expect(MCP_CONNECTION_REQUIRED_TTL_SECONDS).toBe(600);
    expect(
      isMcpActionConnectionState({
        kind: "connection_required",
        version: 1,
        nonce: "n1",
        actionName: "list-events",
        argumentsHash: "h1",
        provider: "google_calendar",
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(true);
    expect(isMcpActionConnectionState(null)).toBe(false);
    expect(isMcpActionConnectionState(undefined)).toBe(false);
    expect(isMcpActionConnectionState("connection_required")).toBe(false);
    expect(isMcpActionConnectionState({ kind: "approval", version: 1 })).toBe(
      false,
    );
    expect(
      isMcpActionConnectionState({ kind: "connection_required", version: 2 }),
    ).toBe(false);
  });

  it("accepts relative app paths and trusted app origins, and rejects untrusted or malformed URLs", () => {
    vi.stubEnv("APP_URL", APP_ORIGIN);
    vi.stubEnv("WORKSPACE_OAUTH_ORIGIN", "https://oauth.agent-native.com");

    expect(
      resolveTrustedMcpConnectUrl(
        "  /_agent-native/google/auth-url?redirect=1&calendar=1  ",
        { origin: APP_ORIGIN },
      ),
    ).toBe(`${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`);

    expect(
      resolveTrustedMcpConnectUrl(
        `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1`,
        { origin: APP_ORIGIN },
      ),
    ).toBe(`${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1`);

    expect(
      resolveTrustedMcpConnectUrl(
        "https://oauth.agent-native.com/connect/google_calendar",
        { origin: APP_ORIGIN },
      ),
    ).toBe("https://oauth.agent-native.com/connect/google_calendar");

    const rejected: Array<string | undefined> = [
      "https://evil.example/oauth",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=123",
      "https://calendar.agent-native.com.evil.com/connect",
      "//evil.example/oauth",
      "/\\evil.example/oauth",
      "/_agent-native/google/auth-url?a=1 b=2",
      "/_agent-native/google/\tauth-url",
      "/_agent-native/google/auth-url\u0000x",
      "/_agent-native/google/auth-url\u001fx",
      "/_agent-native/google/auth-url\u007fx",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://calendar.agent-native.com/connect",
      "file:///etc/passwd",
      "evil.example/oauth",
      "https://user:pass@calendar.agent-native.com/connect",
      "https://user@calendar.agent-native.com/connect",
      "https://:pass@calendar.agent-native.com/connect",
      "http://calendar.agent-native.com/_agent-native/google/auth-url",
      "http://localhost:8080/_agent-native/google/auth-url",
      "/_agent-native/embed/start?ticket=secret-ticket-value-1234567890",
      "   ",
      "",
      undefined,
    ];
    for (const candidate of rejected) {
      expect(
        resolveTrustedMcpConnectUrl(candidate, { origin: APP_ORIGIN }),
        `expected ${String(candidate)} to be rejected`,
      ).toBeUndefined();
    }
  });

  it("allows loopback http in local dev when no public origin env vars are configured, and fails closed on untrusted public hosts", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VITE_APP_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubEnv("VITE_BETTER_AUTH_URL", "");
    vi.stubEnv("WORKSPACE_OAUTH_ORIGIN", "");
    vi.stubEnv("VITE_WORKSPACE_OAUTH_ORIGIN", "");
    vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "");
    vi.stubEnv("VITE_WORKSPACE_GATEWAY_URL", "");
    vi.stubEnv("URL", "");
    vi.stubEnv("DEPLOY_URL", "");

    expect(
      resolveTrustedMcpConnectUrl("/_agent-native/google/auth-url?redirect=1", {
        origin: "http://localhost:8080",
      }),
    ).toBe("http://localhost:8080/_agent-native/google/auth-url?redirect=1");

    expect(
      resolveTrustedMcpConnectUrl(
        "http://localhost:8080/_agent-native/google/auth-url",
        { origin: "http://localhost:8080" },
      ),
    ).toBe("http://localhost:8080/_agent-native/google/auth-url");

    expect(
      resolveTrustedMcpConnectUrl(
        "http://127.0.0.1:9090/_agent-native/google/auth-url",
        { origin: "http://localhost:8080" },
      ),
    ).toBeUndefined();

    expect(
      resolveTrustedMcpConnectUrl("/_agent-native/google/auth-url?redirect=1", {
        origin: "https://spoofed.example.com",
      }),
    ).toBeUndefined();

    expect(
      resolveTrustedMcpConnectUrl("/_agent-native/google/auth-url", undefined),
    ).toBeUndefined();
  });

  it("extracts typed connection_required metadata from errors and results across all reasons and rejects invalid or committed cases", () => {
    const err = new AgentConnectionRequiredError(
      "Connect Google Calendar to view events.",
      {
        provider: "google_calendar",
        reason: "connect",
        connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
      },
    );
    expect(extractMcpConnectionRequiredFromError(err)).toEqual({
      provider: "google_calendar",
      connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
      message: "Connect Google Calendar to view events.",
      reason: "connect",
      fromError: true,
    });

    const errWithNoneEffect = Object.assign(
      new AgentConnectionRequiredError("", {
        provider: "google_calendar",
        reason: "grant",
        connectUrl: "/_agent-native/google/auth-url",
      }),
      { effect: "none" as const },
    );
    expect(extractMcpConnectionRequiredFromError(errWithNoneEffect)).toEqual({
      provider: "google_calendar",
      connectUrl: "/_agent-native/google/auth-url",
      message: "Grant access to google_calendar to continue.",
      reason: "grant",
      fromError: true,
    });

    const errWithDetailsUrl = Object.assign(
      new AgentConnectionRequiredError("   ", {
        provider: "slack",
        reason: "admin_required",
      }),
      { details: { url: "/_agent-native/slack/connect" } },
    );
    expect(extractMcpConnectionRequiredFromError(errWithDetailsUrl)).toEqual({
      provider: "slack",
      connectUrl: "/_agent-native/slack/connect",
      message:
        "An administrator must connect slack before this action can run.",
      reason: "admin_required",
      fromError: true,
    });

    const errWithDetailsConnectUrl = Object.assign(
      new AgentConnectionRequiredError("", {
        provider: "gmail",
        reason: "reauthorize",
      }),
      { details: { connectUrl: "/_agent-native/google/auth-url?gmail=1" } },
    );
    expect(
      extractMcpConnectionRequiredFromError(errWithDetailsConnectUrl),
    ).toEqual({
      provider: "gmail",
      connectUrl: "/_agent-native/google/auth-url?gmail=1",
      message: "Reconnect gmail to continue.",
      reason: "reauthorize",
      fromError: true,
    });

    expect(
      extractMcpConnectionRequiredFromError(
        Object.assign(
          new AgentConnectionRequiredError("Array details", {
            provider: "slack",
          }),
          { details: ["not-an-object"] },
        ),
      ),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromError(
        new AgentConnectionRequiredError("Missing url", {
          provider: "google_calendar",
        }),
      ),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromError(
        new AgentConnectionRequiredError("Missing provider", {
          provider: "  ",
          connectUrl: "/_agent-native/google/auth-url",
        }),
      ),
    ).toBeUndefined();

    const committedErr = Object.assign(
      new AgentConnectionRequiredError("Committed write", {
        provider: "google_calendar",
        connectUrl: "/_agent-native/google/auth-url",
      }),
      { effect: "committed" as const },
    );
    expect(extractMcpConnectionRequiredFromError(committedErr)).toBeUndefined();

    const contractErr = new ActionContractError("Connect Notion first.", {
      errorCode: "connection_required",
      details: {
        provider: "notion",
        connectUrl: "/_agent-native/notion/connect",
        reason: "reauthorize",
      },
    });
    expect(extractMcpConnectionRequiredFromError(contractErr)).toEqual({
      provider: "notion",
      connectUrl: "/_agent-native/notion/connect",
      message: "Connect Notion first.",
      reason: "reauthorize",
      fromError: true,
    });

    const contractWithFallbackUrl = new ActionContractError("", {
      errorCode: "connection_required",
      details: {
        provider: "linear",
        url: "/_agent-native/linear/connect",
        reason: "unknown_reason",
      },
    });
    expect(
      extractMcpConnectionRequiredFromError(contractWithFallbackUrl),
    ).toEqual({
      provider: "linear",
      connectUrl: "/_agent-native/linear/connect",
      message: "Connect linear to continue.",
      reason: "connect",
      fromError: true,
    });

    expect(
      extractMcpConnectionRequiredFromError(
        new ActionContractError("Other failure", {
          errorCode: "action_failed",
          details: { provider: "notion", connectUrl: "/connect" },
        }),
      ),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromError(
        new ActionContractError("No details", {
          errorCode: "connection_required",
        }),
      ),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromError(
        new ActionContractError("Missing connectUrl", {
          errorCode: "connection_required",
          details: { provider: "notion" },
        }),
      ),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromError(
        new ActionContractError("Missing provider", {
          errorCode: "connection_required",
          details: { connectUrl: "/_agent-native/notion/connect" },
        }),
      ),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromError(
        Object.assign(
          new ActionContractError("Committed contract", {
            errorCode: "connection_required",
            details: { provider: "notion", connectUrl: "/connect" },
          }),
          { effect: "committed" },
        ),
      ),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromError(new Error("generic")),
    ).toBeUndefined();

    const throwingError = {
      get agentConnectionRequired() {
        throw new Error("hostile getter");
      },
    };
    expect(
      extractMcpConnectionRequiredFromError(throwingError),
    ).toBeUndefined();

    expect(
      extractMcpConnectionRequiredFromResult({
        status: "connection_required",
        provider: "gmail",
        connectUrl: "/_agent-native/google/auth-url?redirect=1&gmail=1",
        message: "Connect Gmail to read threads.",
      }),
    ).toEqual({
      provider: "gmail",
      connectUrl: "/_agent-native/google/auth-url?redirect=1&gmail=1",
      message: "Connect Gmail to read threads.",
      reason: "connect",
      fromError: false,
    });

    expect(
      extractMcpConnectionRequiredFromResult({
        type: "connection_required",
        provider: "github",
        url: "/_agent-native/github/connect",
        reason: "grant",
      }),
    ).toEqual({
      provider: "github",
      connectUrl: "/_agent-native/github/connect",
      message: "Grant access to github to continue.",
      reason: "grant",
      fromError: false,
    });

    expect(
      extractMcpConnectionRequiredFromResult({
        errorCode: "connection_required",
        provider: "jira",
        connectUrl: "/_agent-native/jira/connect",
        reason: "reauthorize",
      }),
    ).toEqual({
      provider: "jira",
      connectUrl: "/_agent-native/jira/connect",
      message: "Reconnect jira to continue.",
      reason: "reauthorize",
      fromError: false,
    });

    expect(extractMcpConnectionRequiredFromResult(null)).toBeUndefined();
    expect(extractMcpConnectionRequiredFromResult("str")).toBeUndefined();
    expect(extractMcpConnectionRequiredFromResult([])).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromResult({
        status: "connection_required",
        provider: "gmail",
      }),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromResult({
        status: "connection_required",
        connectUrl: "/_agent-native/gmail/connect",
      }),
    ).toBeUndefined();
    expect(
      extractMcpConnectionRequiredFromResult({
        provider: "google_calendar",
        url: "/_agent-native/google/auth-url?redirect=1&calendar=1",
        label: "Connect Google Calendar",
        message: "Open this link to connect.",
      }),
    ).toBeUndefined();

    const throwingResult = {
      get status() {
        throw new Error("hostile getter");
      },
    };
    expect(
      extractMcpConnectionRequiredFromResult(throwingResult),
    ).toBeUndefined();
  });
});
