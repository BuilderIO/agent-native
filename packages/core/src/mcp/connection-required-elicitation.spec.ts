import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActionContractError,
  AgentConnectionRequiredError,
} from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { MCPConfig, MCPRequestMeta } from "./build-server.js";
import {
  extractMcpConnectionRequiredFromError,
  extractMcpConnectionRequiredFromResult,
  resolveTrustedMcpConnectUrl,
} from "./execute-action-call.js";
import { handleMcpFetchRequest } from "./framework-fetch-handler.js";

const APP_ORIGIN = "https://calendar.agent-native.com";
const TEST_AUTH_SECRET = "test-connection-elicitation-secret-0123456789abcdef";

vi.mock("../server/better-auth-instance.js", () => ({
  getAuthSecret: () => TEST_AUTH_SECRET,
  findBetterAuthUserIdForEmail: async () => "user-steve-1",
}));

function makeReadOnlyAction(
  description: string,
  run: (args: any) => Promise<unknown>,
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
    run,
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
    elicitation?: { form?: object; url?: object };
    manualInputRequired?: boolean;
    onElicit?: (params: any) => Promise<any>;
    requestMeta?: MCPRequestMeta;
  } = {},
) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    return handleMcpFetchRequest(req, config, {
      identity: {
        identityAssurance: "user",
        userEmail: "steve@builder.io",
        orgId: "org-builder",
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
    client.registerCapabilities({ elicitation: options.elicitation } as any);
  }
  if (options.onElicit) {
    client.setRequestHandler("elicitation/create", async (req) =>
      options.onElicit!(req.params),
    );
  }
  await client.connect(transport);
  return { client };
}

describe("connection_required URL validation and extraction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts relative app paths and trusted app origins, and rejects untrusted external URLs", () => {
    vi.stubEnv("APP_URL", APP_ORIGIN);
    vi.stubEnv("WORKSPACE_OAUTH_ORIGIN", "https://oauth.agent-native.com");

    // Accepted trusted URLs
    expect(
      resolveTrustedMcpConnectUrl(
        "/_agent-native/google/auth-url?redirect=1&calendar=1",
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

    // Rejected untrusted / dangerous URLs
    const rejected = [
      "https://evil.example/oauth",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=123",
      "https://calendar.agent-native.com.evil.com/connect",
      "//evil.example/oauth",
      "/\\evil.example/oauth",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "evil.example/oauth",
      `https://user:pass@calendar.agent-native.com/connect`,
      "http://calendar.agent-native.com/_agent-native/google/auth-url",
      "http://localhost:8080/_agent-native/google/auth-url",
      "/_agent-native/embed/start?ticket=secret-ticket-value-1234567890",
      "   ",
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

    // Untrusted public Host header with no configured APP_URL must fail closed
    expect(
      resolveTrustedMcpConnectUrl("/_agent-native/google/auth-url?redirect=1", {
        origin: "https://spoofed.example.com",
      }),
    ).toBeUndefined();
  });

  it("extracts typed connection_required metadata from errors and results without matching ordinary results or committed post-run signals", () => {
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

    // Post-run signal with committed write effect must NOT be elicited/re-run
    const committedErr = Object.assign(
      new AgentConnectionRequiredError("Committed write", {
        provider: "google_calendar",
        connectUrl: "/_agent-native/google/auth-url",
      }),
      { effect: "committed" as const },
    );
    expect(extractMcpConnectionRequiredFromError(committedErr)).toBeUndefined();

    // ActionContractError with errorCode: "connection_required"
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

    // Typed returned result
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

    // Ordinary connect-link result (without connection_required discriminator) must NOT match
    expect(
      extractMcpConnectionRequiredFromResult({
        provider: "google_calendar",
        url: "/_agent-native/google/auth-url?redirect=1&calendar=1",
        label: "Connect Google Calendar",
        message: "Open this link to connect.",
      }),
    ).toBeUndefined();
  });
});

describe("MCP direct action call typed connection_required URL elicitation", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", APP_ORIGIN);
    vi.stubEnv("AUTH_SECRET", TEST_AUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emits URL elicitation for thrown AgentConnectionRequiredError, re-runs on accept, and succeeds once real credential exists", async () => {
    let connected = false;
    const run = vi.fn(async (args: { range: string }) => {
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
      const first = (await client.callTool(
        { name: "list-events", arguments: { range: "this-week" } },
        { allowInputRequired: true } as any,
      )) as any;

      expect(first).toMatchObject({
        resultType: "input_required",
        inputRequests: {
          connectionRequired: {
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

      // Simulate user completing real OAuth in browser before resuming
      connected = true;
      const resumed = (await client.callTool({
        name: "list-events",
        arguments: { range: "this-week" },
        requestState: first.requestState,
        inputResponses: {
          connectionRequired: { action: "accept" },
        },
      } as any)) as any;

      expect(resumed.isError).not.toBe(true);
      expect(resumed.content[0].text).toContain("Board Sync");
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
    }
  });

  it("completes automatically through the 2026-07-28 SDK auto-fulfillment driver once the user connects", async () => {
    let connected = false;
    const seenPrompts: Array<{
      mode?: string;
      url?: string;
      message?: string;
    }> = [];
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
      const result = (await client.callTool({
        name: "list-events",
        arguments: {},
      })) as any;

      expect(seenPrompts).toEqual([
        expect.objectContaining({
          mode: "url",
          url: `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
          message: "Connect Google Calendar to view your schedule.",
        }),
      ]);
      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain("Design Review");
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
      const first = (await client.callTool(
        { name: "list-events", arguments: {} },
        { allowInputRequired: true } as any,
      )) as any;
      expect(first.resultType).toBe("input_required");
      expect(run).toHaveBeenCalledTimes(1);

      // Client reports accept even though the user never finished OAuth
      const resumed = (await client.callTool(
        {
          name: "list-events",
          arguments: {},
          requestState: first.requestState,
          inputResponses: {
            connectionRequired: { action: "accept" },
          },
        } as any,
        { allowInputRequired: true } as any,
      )) as any;

      // Must NOT emit another input_required loop — must fail cleanly
      expect(resumed.resultType).not.toBe("input_required");
      expect(resumed.isError).toBe(true);
      expect(resumed.content[0].text).toContain(
        "google_calendar is still not connected",
      );
      expect(resumed.content[0].text).toContain("Do not retry automatically");
      expect(resumed.content[0].text).toContain(
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
      const first = (await client.callTool(
        { name: "search-notion", arguments: { query: "roadmap" } },
        { allowInputRequired: true } as any,
      )) as any;
      expect(first).toMatchObject({
        resultType: "input_required",
        inputRequests: {
          connectionRequired: {
            method: "elicitation/create",
            params: {
              mode: "url",
              message: "Connect Notion to search your workspace.",
              url: `${APP_ORIGIN}/_agent-native/notion/connect`,
            },
          },
        },
      });

      // Resume while still unconnected -> clear non-retrying error
      const stillMissing = (await client.callTool(
        {
          name: "search-notion",
          arguments: { query: "roadmap" },
          requestState: first.requestState,
          inputResponses: { connectionRequired: { action: "accept" } },
        } as any,
        { allowInputRequired: true } as any,
      )) as any;
      expect(stillMissing.isError).toBe(true);
      expect(stillMissing.content[0].text).toContain(
        "notion is still not connected",
      );

      // Connect real credential, start fresh call -> auto-succeeds after resume
      const second = (await client.callTool(
        { name: "search-notion", arguments: { query: "roadmap" } },
        { allowInputRequired: true } as any,
      )) as any;
      connected = true;
      const done = (await client.callTool({
        name: "search-notion",
        arguments: { query: "roadmap" },
        requestState: second.requestState,
        inputResponses: { connectionRequired: { action: "accept" } },
      } as any)) as any;
      expect(done.isError).not.toBe(true);
      expect(done.content[0].text).toContain("Roadmap");
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
      const result = (await client.callTool(
        { name: "list-events", arguments: {} },
        { allowInputRequired: true } as any,
      )) as any;

      expect(result.resultType).not.toBe("input_required");
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Connect external provider");
      expect(result.content[0].text).not.toContain("https://evil.example");
    } finally {
      await client.close();
    }
  });

  it.each(["decline", "cancel"] as const)(
    "handles %s response without re-running the action",
    async (replyAction) => {
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
        const first = (await client.callTool(
          { name: "list-events", arguments: {} },
          { allowInputRequired: true } as any,
        )) as any;
        expect(first.resultType).toBe("input_required");
        expect(run).toHaveBeenCalledTimes(1);

        const resumed = (await client.callTool({
          name: "list-events",
          arguments: {},
          requestState: first.requestState,
          inputResponses: {
            connectionRequired: { action: replyAction },
          },
        } as any)) as any;

        expect(resumed.isError).toBe(true);
        expect(resumed.content[0].text).toContain("google_calendar");
        expect(resumed.content[0].text).toContain("Do not retry automatically");
        // Action must NOT be re-run on decline/cancel!
        expect(run).toHaveBeenCalledTimes(1);
      } finally {
        await client.close();
      }
    },
  );

  it("rejects mismatched arguments or expired requestState on resume without running the action", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const run = vi.fn(async () => {
      throw new AgentConnectionRequiredError("Connect Google Calendar.", {
        provider: "google_calendar",
        connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
      });
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
      const first = (await client.callTool(
        { name: "list-events", arguments: { range: "today" } },
        { allowInputRequired: true } as any,
      )) as any;
      expect(run).toHaveBeenCalledTimes(1);

      // Mismatched arguments
      const mismatched = (await client.callTool({
        name: "list-events",
        arguments: { range: "next-year" },
        requestState: first.requestState,
        inputResponses: { connectionRequired: { action: "accept" } },
      } as any)) as any;
      expect(mismatched.isError).toBe(true);
      expect(mismatched.content[0].text).toContain(
        "invalid, expired, or does not match",
      );
      expect(run).toHaveBeenCalledTimes(1);

      // Expired state
      clock.mockReturnValue(now + 11 * 60_000);
      const expired = (await client.callTool({
        name: "list-events",
        arguments: { range: "today" },
        requestState: first.requestState,
        inputResponses: { connectionRequired: { action: "accept" } },
      } as any)) as any;
      expect(expired.isError).toBe(true);
      expect(expired.content[0].text).toContain(
        "invalid, expired, or does not match",
      );
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it("falls back cleanly to text + trusted URL for clients that do NOT advertise elicitation.url (including form-only and legacy 2025 clients)", async () => {
    const thrownConfig = makeCalendarConfig({
      "list-events": makeReadOnlyAction("List calendar events", async () => {
        throw new AgentConnectionRequiredError(
          "Connect Google Calendar to view your schedule.",
          {
            provider: "google_calendar",
            connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
          },
        );
      }),
      "search-notion": makeReadOnlyAction("Search Notion pages", async () => ({
        status: "connection_required",
        provider: "notion",
        connectUrl: "/_agent-native/notion/connect",
        message: "Connect Notion to search pages.",
      })),
    });

    // 1. Modern 2026-07-28 client with NO elicitation.url (form-only, e.g. ChatGPT)
    const { client: formOnlyClient } = await createModernMcpClient(
      thrownConfig,
      {
        manualInputRequired: true,
        elicitation: { form: {} },
      },
    );
    try {
      const thrownFallback = (await formOnlyClient.callTool(
        { name: "list-events", arguments: {} },
        { allowInputRequired: true } as any,
      )) as any;
      expect(thrownFallback.resultType).not.toBe("input_required");
      expect(thrownFallback.isError).toBe(true);
      expect(thrownFallback.content[0].text).toContain(
        "Connect Google Calendar to view your schedule.",
      );
      expect(thrownFallback.content[0].text).toContain(
        `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
      );

      const returnedFallback = (await formOnlyClient.callTool(
        { name: "search-notion", arguments: {} },
        { allowInputRequired: true } as any,
      )) as any;
      expect(returnedFallback.resultType).not.toBe("input_required");
      expect(returnedFallback.content[0].text).toContain(
        "Connect Notion to search pages.",
      );
    } finally {
      await formOnlyClient.close();
    }

    // 2. Legacy 2025-06-18 stateless HTTP client
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
      thrownConfig,
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
    );
    expect(legacyJson.result.isError).toBe(true);
    expect(legacyJson.result.resultType).toBeUndefined();
    expect(legacyJson.result.content[0].text).toContain(
      `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
    );
  });
});
