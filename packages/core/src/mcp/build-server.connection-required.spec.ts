import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type {
  CallToolResult,
  ClientCapabilities,
  ElicitResult,
  InputRequiredResult,
} from "@modelcontextprotocol/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActionContractError,
  AgentConnectionRequiredError,
} from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  MCP_ACTION_CONNECTION_INPUT_KEY,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";
import {
  extractMcpConnectionRequiredFromError,
  extractMcpConnectionRequiredFromResult,
  isMcpActionConnectionState,
  resolveTrustedMcpConnectUrl,
} from "./execute-action-call.js";
import { handleMcpFetchRequest } from "./framework-fetch-handler.js";

const APP_ORIGIN = "https://calendar.agent-native.com";
const TEST_AUTH_SECRET = "test-connection-elicitation-secret-0123456789abcdef";

let authSecretOverride: (() => string) | undefined;

vi.mock("../server/better-auth-instance.js", () => ({
  getAuthSecret: () =>
    authSecretOverride ? authSecretOverride() : TEST_AUTH_SECRET,
  findBetterAuthUserIdForEmail: async () => "user-steve-1",
}));

type ToolCallOutcome = CallToolResult | InputRequiredResult;

function firstText(result: ToolCallOutcome): string {
  if (!("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Expected CallToolResult with content blocks");
  }
  const block = result.content.at(0);
  if (!block || block.type !== "text") {
    throw new Error("Expected first content block to be text");
  }
  return block.text;
}

function asInputRequired(result: ToolCallOutcome): InputRequiredResult {
  if (!("resultType" in result) || result.resultType !== "input_required") {
    throw new Error("Expected input_required result");
  }
  return result;
}

function asCallToolResult(result: ToolCallOutcome): CallToolResult {
  if ("resultType" in result && result.resultType === "input_required") {
    throw new Error("Expected complete CallToolResult, got input_required");
  }
  return result as CallToolResult;
}

type CallToolRaw = (
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<ToolCallOutcome>;

async function callToolRaw(
  client: Client,
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  const invoke = client.callTool.bind(client) as unknown as CallToolRaw;
  return options ? invoke(params, options) : invoke(params);
}

function makeReadOnlyAction(
  description: string,
  run: (args: Record<string, unknown>) => Promise<unknown>,
  properties: Record<string, unknown> = {},
): ActionEntry {
  return {
    tool: {
      description,
      parameters: {
        type: "object",
        properties,
      },
    },
    readOnly: true,
    run: (args) => run(args as Record<string, unknown>),
  };
}

function makeCalendarConfig(actions: MCPConfig["actions"]): MCPConfig {
  return {
    name: "agent-native-calendar",
    title: "Agent-Native Calendar",
    appId: "calendar",
    catalogMode: "app",
    builtinCrossAppTools: false,
    actions,
    productionActions: actions,
  };
}

function makeRequestMeta(
  overrides: Partial<MCPRequestMeta> = {},
): MCPRequestMeta {
  return {
    origin: APP_ORIGIN,
    transport: "http",
    fullSurface: true,
    ...overrides,
  };
}

async function createModernMcpClient(
  config: MCPConfig,
  options: {
    elicitation?: NonNullable<ClientCapabilities["elicitation"]>;
    manualInputRequired?: boolean;
    onElicit?: (params: Record<string, unknown>) => Promise<ElicitResult>;
    requestMeta?: MCPRequestMeta;
    userEmail?: string;
    orgId?: string;
  } = {},
) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    return handleMcpFetchRequest(req, config, {
      identity: {
        identityAssurance: "user",
        userEmail: options.userEmail ?? "steve@builder.io",
        orgId: options.orgId ?? "org-builder",
        oauthClientId: "claude-client",
      },
      requestMeta: options.requestMeta ?? makeRequestMeta(),
    });
  };
  const transport = new StreamableHTTPClientTransport(
    new URL(`${APP_ORIGIN}/_agent-native/mcp`),
    { fetch: fetchImpl },
  );
  const client = new Client(
    { name: "test-mcp-client", version: "1.0.0" },
    {
      versionNegotiation: { mode: "auto" },
      ...(options.manualInputRequired
        ? { inputRequired: { autoFulfill: false } }
        : {}),
    },
  );
  if (options.elicitation) {
    client.registerCapabilities({ elicitation: options.elicitation });
  }
  const onElicit = options.onElicit;
  if (onElicit) {
    client.setRequestHandler("elicitation/create", async (req) =>
      onElicit(req.params as unknown as Record<string, unknown>),
    );
  }
  await client.connect(transport);
  return { client };
}

describe("connection_required URL validation, state guard, and extraction", () => {
  afterEach(() => {
    authSecretOverride = undefined;
    vi.unstubAllEnvs();
  });

  it("identifies valid McpActionConnectionState payloads and rejects invalid shapes", () => {
    expect(MCP_ACTION_CONNECTION_INPUT_KEY).toBe("connectionRequired");
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
    expect(err.connectUrl).toBe(
      "/_agent-native/google/auth-url?redirect=1&calendar=1",
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

describe("MCP direct action call typed connection_required URL elicitation", () => {
  beforeEach(() => {
    authSecretOverride = undefined;
    vi.stubEnv("APP_URL", APP_ORIGIN);
    vi.stubEnv("AUTH_SECRET", TEST_AUTH_SECRET);
  });

  afterEach(() => {
    authSecretOverride = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emits URL elicitation for thrown AgentConnectionRequiredError, re-runs on accept, and succeeds once real credential exists", async () => {
    let connected = false;
    const run = vi.fn(async (args: Record<string, unknown>) => {
      if (!connected) {
        throw new AgentConnectionRequiredError(
          "Connect Google Calendar to view your schedule.",
          {
            provider: "google_calendar",
            connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
          },
        );
      }
      return {
        events: [{ id: "evt-1", title: "Board Sync", range: args.range }],
      };
    });

    const config = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", run, {
        range: { type: "string" },
      }),
    });

    const { client } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    try {
      const first = asInputRequired(
        await callToolRaw(
          client,
          { name: "list-events", arguments: { range: "this-week" } },
          { allowInputRequired: true },
        ),
      );

      expect(first).toMatchObject({
        resultType: "input_required",
        inputRequests: {
          [MCP_ACTION_CONNECTION_INPUT_KEY]: {
            method: "elicitation/create",
            params: {
              mode: "url",
              message: "Connect Google Calendar to view your schedule.",
              url: `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
            },
          },
        },
      });
      expect(typeof first.requestState).toBe("string");
      expect(run).toHaveBeenCalledTimes(1);

      connected = true;
      const resumed = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "this-week" },
          requestState: first.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );

      expect(resumed.isError).not.toBe(true);
      expect(firstText(resumed)).toContain("Board Sync");
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
    }
  });

  it("completes automatically through the 2026-07-28 SDK auto-fulfillment driver once the user connects", async () => {
    let connected = false;
    const seenPrompts: Array<Record<string, unknown>> = [];
    const run = vi.fn(async () => {
      if (!connected) {
        throw new AgentConnectionRequiredError(
          "Connect Google Calendar to view your schedule.",
          {
            provider: "google_calendar",
            connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
          },
        );
      }
      return { events: [{ id: "evt-auto", title: "Design Review" }] };
    });

    const config = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", run),
    });

    const { client } = await createModernMcpClient(config, {
      elicitation: { url: {} },
      onElicit: async (params) => {
        seenPrompts.push(params);
        connected = true;
        return { action: "accept" };
      },
    });
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const result = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: {},
        }),
      );

      expect(seenPrompts).toEqual([
        expect.objectContaining({
          mode: "url",
          url: `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
          message: "Connect Google Calendar to view your schedule.",
        }),
      ]);
      expect(result.isError).not.toBe(true);
      expect(firstText(result)).toContain("Design Review");
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
    }
  });

  it("never trusts URL acceptance alone: returns a clear non-retrying error when credential is still absent after resume", async () => {
    const run = vi.fn(async () => {
      throw new AgentConnectionRequiredError(
        "Connect Google Calendar to view your schedule.",
        {
          provider: "google_calendar",
          connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
        },
      );
    });

    const config = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", run),
    });

    const { client } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    try {
      const first = asInputRequired(
        await callToolRaw(
          client,
          { name: "list-events", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(run).toHaveBeenCalledTimes(1);

      const resumed = asCallToolResult(
        await callToolRaw(
          client,
          {
            name: "list-events",
            arguments: {},
            requestState: first.requestState,
            inputResponses: {
              [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
            },
          },
          { allowInputRequired: true },
        ),
      );

      expect(resumed.isError).toBe(true);
      expect(firstText(resumed)).toContain(
        "google_calendar is still not connected",
      );
      expect(firstText(resumed)).toContain("Do not retry automatically");
      expect(firstText(resumed)).toContain(
        `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
      );
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
    }
  });

  it("supports typed connection_required returned action results (both connect success and still-unconnected resume)", async () => {
    let connected = false;
    const run = vi.fn(async () => {
      if (!connected) {
        return {
          status: "connection_required",
          provider: "notion",
          connectUrl: "/_agent-native/notion/connect",
          message: "Connect Notion to search your workspace.",
        };
      }
      return { pages: [{ id: "pg-1", title: "Roadmap" }] };
    });

    const config = makeCalendarConfig({
      "search-notion": makeReadOnlyAction("Search Notion pages", run, {
        query: { type: "string" },
      }),
    });

    const { client } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    try {
      const first = asInputRequired(
        await callToolRaw(
          client,
          { name: "search-notion", arguments: { query: "roadmap" } },
          { allowInputRequired: true },
        ),
      );
      expect(first).toMatchObject({
        resultType: "input_required",
        inputRequests: {
          [MCP_ACTION_CONNECTION_INPUT_KEY]: {
            method: "elicitation/create",
            params: {
              mode: "url",
              message: "Connect Notion to search your workspace.",
              url: `${APP_ORIGIN}/_agent-native/notion/connect`,
            },
          },
        },
      });

      const stillMissing = asCallToolResult(
        await callToolRaw(
          client,
          {
            name: "search-notion",
            arguments: { query: "roadmap" },
            requestState: first.requestState,
            inputResponses: {
              [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
            },
          },
          { allowInputRequired: true },
        ),
      );
      expect(stillMissing.isError).toBe(true);
      expect(firstText(stillMissing)).toContain(
        "notion is still not connected",
      );

      const second = asInputRequired(
        await callToolRaw(
          client,
          { name: "search-notion", arguments: { query: "roadmap" } },
          { allowInputRequired: true },
        ),
      );
      connected = true;
      const done = asCallToolResult(
        await callToolRaw(client, {
          name: "search-notion",
          arguments: { query: "roadmap" },
          requestState: second.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );
      expect(done.isError).not.toBe(true);
      expect(firstText(done)).toContain("Roadmap");
    } finally {
      await client.close();
    }
  });

  it("rejects untrusted external connect URLs and refuses to emit URL elicitation", async () => {
    const run = vi.fn(async () => {
      throw new AgentConnectionRequiredError("Connect external provider", {
        provider: "google_calendar",
        connectUrl: "https://evil.example/phish-oauth",
      });
    });

    const config = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", run),
    });

    const { client } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    try {
      const result = asCallToolResult(
        await callToolRaw(
          client,
          { name: "list-events", arguments: {} },
          { allowInputRequired: true },
        ),
      );

      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain("Connect external provider");
      expect(firstText(result)).not.toContain("https://evil.example");
    } finally {
      await client.close();
    }
  });

  it.each([
    ["decline", "the user declined to connect google_calendar"],
    ["cancel", "connecting google_calendar was cancelled"],
  ] as const)(
    "handles %s response without re-running the action",
    async (replyAction, expectedReason) => {
      const run = vi.fn(async () => {
        throw new AgentConnectionRequiredError("Connect Google Calendar.", {
          provider: "google_calendar",
          connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
        });
      });

      const config = makeCalendarConfig({
        "list-events": makeReadOnlyAction("List calendar events", run),
      });

      const { client } = await createModernMcpClient(config, {
        manualInputRequired: true,
        elicitation: { url: {} },
      });
      try {
        const first = asInputRequired(
          await callToolRaw(
            client,
            { name: "list-events", arguments: {} },
            { allowInputRequired: true },
          ),
        );
        expect(run).toHaveBeenCalledTimes(1);

        const resumed = asCallToolResult(
          await callToolRaw(client, {
            name: "list-events",
            arguments: {},
            requestState: first.requestState,
            inputResponses: {
              [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: replyAction },
            },
          }),
        );

        expect(resumed.isError).toBe(true);
        expect(firstText(resumed)).toContain(expectedReason);
        expect(firstText(resumed)).toContain("Do not retry automatically");
        expect(run).toHaveBeenCalledTimes(1);
      } finally {
        await client.close();
      }
    },
  );

  it("handles missing elicitation reply on resume without re-running the action", async () => {
    const run = vi.fn(async () => {
      throw new AgentConnectionRequiredError("Connect Google Calendar.", {
        provider: "google_calendar",
        connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
      });
    });

    const config = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", run),
    });

    const { client } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    try {
      const first = asInputRequired(
        await callToolRaw(
          client,
          { name: "list-events", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      const resumed = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: {},
          requestState: first.requestState,
          inputResponses: {},
        }),
      );
      expect(resumed.isError).toBe(true);
      expect(firstText(resumed)).toContain(
        "connecting google_calendar was not completed",
      );
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it("rejects mismatched tool, mismatched arguments, cross-principal replay, or expired requestState on resume without running the action", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const run = vi.fn(async () => {
      throw new AgentConnectionRequiredError("Connect Google Calendar.", {
        provider: "google_calendar",
        connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
      });
    });
    const otherRun = vi.fn(async () => ({ ok: true }));

    const config = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", run, {
        range: { type: "string" },
      }),
      "other-tool": makeReadOnlyAction("Other tool", otherRun, {
        range: { type: "string" },
      }),
    });

    const { client } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    const { client: otherUserClient } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
      userEmail: "other@builder.io",
    });
    try {
      const first = asInputRequired(
        await callToolRaw(
          client,
          { name: "list-events", arguments: { range: "today" } },
          { allowInputRequired: true },
        ),
      );
      expect(run).toHaveBeenCalledTimes(1);

      const wrongTool = asCallToolResult(
        await callToolRaw(client, {
          name: "other-tool",
          arguments: { range: "today" },
          requestState: first.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );
      expect(wrongTool.isError).toBe(true);
      expect(firstText(wrongTool)).toContain(
        "invalid, expired, or does not match",
      );
      expect(otherRun).not.toHaveBeenCalled();

      const mismatched = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "next-year" },
          requestState: first.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );
      expect(mismatched.isError).toBe(true);
      expect(firstText(mismatched)).toContain(
        "invalid, expired, or does not match",
      );
      expect(run).toHaveBeenCalledTimes(1);

      await expect(
        callToolRaw(otherUserClient, {
          name: "list-events",
          arguments: { range: "today" },
          requestState: first.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });
      expect(run).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(now + 11 * 60_000);
      const expired = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "today" },
          requestState: first.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );
      expect(expired.isError).toBe(true);
      expect(firstText(expired)).toContain(
        "invalid, expired, or does not match",
      );
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await otherUserClient.close();
    }
  });

  it("falls back cleanly without URL elicitation when auth secret is unavailable or client does not advertise elicitation.url", async () => {
    const config = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", async () => {
        throw new AgentConnectionRequiredError(
          "Connect Google Calendar to view your schedule.",
          {
            provider: "google_calendar",
            connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
          },
        );
      }),
      "list-events-with-inline-url": makeReadOnlyAction(
        "List events with inline URL in error message",
        async () => {
          throw new AgentConnectionRequiredError(
            `Open ${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1 to connect.`,
            {
              provider: "google_calendar",
              connectUrl:
                "/_agent-native/google/auth-url?redirect=1&calendar=1",
            },
          );
        },
      ),
      "search-notion": makeReadOnlyAction("Search Notion pages", async () => ({
        status: "connection_required",
        provider: "notion",
        connectUrl: "/_agent-native/notion/connect",
        message: "Connect Notion to search pages.",
      })),
    });

    authSecretOverride = () => {
      throw new Error("missing AUTH_SECRET");
    };
    const { client: noCodecClient } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    try {
      const noCodecResult = asCallToolResult(
        await callToolRaw(
          noCodecClient,
          { name: "list-events", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(noCodecResult.isError).toBe(true);
      expect(firstText(noCodecResult)).toContain(
        `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
      );
    } finally {
      await noCodecClient.close();
      authSecretOverride = undefined;
    }

    const { client: formOnlyClient } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { form: {} },
    });
    try {
      const thrownFallback = asCallToolResult(
        await callToolRaw(
          formOnlyClient,
          { name: "list-events", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(thrownFallback.isError).toBe(true);
      expect(firstText(thrownFallback)).toContain(
        "Connect Google Calendar to view your schedule.",
      );
      expect(firstText(thrownFallback)).toContain(
        `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
      );

      const inlineUrlFallback = asCallToolResult(
        await callToolRaw(
          formOnlyClient,
          { name: "list-events-with-inline-url", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(inlineUrlFallback.isError).toBe(true);
      expect(
        firstText(inlineUrlFallback).split("Connect google_calendar:").length,
      ).toBe(1);

      const returnedFallback = asCallToolResult(
        await callToolRaw(
          formOnlyClient,
          { name: "search-notion", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(firstText(returnedFallback)).toContain(
        "Connect Notion to search pages.",
      );
    } finally {
      await formOnlyClient.close();
    }

    const legacyRes = await handleMcpFetchRequest(
      new Request(`${APP_ORIGIN}/_agent-native/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list-events", arguments: {} },
        }),
      }),
      config,
      {
        identity: {
          identityAssurance: "user",
          userEmail: "steve@builder.io",
          orgId: "org-builder",
        },
        requestMeta: makeRequestMeta(),
      },
    );
    expect(legacyRes.status).toBe(200);
    const bodyText = await legacyRes.text();
    const dataLine = bodyText
      .split("\n")
      .find((line) => line.startsWith("data: "));
    const legacyJson = JSON.parse(
      dataLine ? dataLine.slice("data: ".length) : bodyText,
    ) as { result: CallToolResult & { resultType?: string } };
    expect(legacyJson.result.isError).toBe(true);
    expect(legacyJson.result.resultType).toBeUndefined();
    expect(firstText(legacyJson.result)).toContain(
      `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
    );
  });
});
