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

import { AgentConnectionRequiredError } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  MCP_ACTION_CONNECTION_INPUT_KEY,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";
import { handleMcpFetchRequest } from "./framework-fetch-handler.js";

const APP_ORIGIN = "https://calendar.agent-native.com";
const TEST_AUTH_SECRET = "test-direct-connection-secret-0123456789abcdef";

vi.mock("../server/better-auth-instance.js", () => ({
  getAuthSecret: () => TEST_AUTH_SECRET,
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
      requestMeta: makeRequestMeta(),
    });
  };
  const transport = new StreamableHTTPClientTransport(
    new URL(`${APP_ORIGIN}/_agent-native/mcp`),
    { fetch: fetchImpl },
  );
  const client = new Client(
    { name: "test-direct-client", version: "1.0.0" },
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

describe("direct-action-call typed connection_required URL elicitation", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", APP_ORIGIN);
    vi.stubEnv("AUTH_SECRET", TEST_AUTH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("re-runs on accept for thrown errors and returned results, and fails non-retrying if credential remains missing", async () => {
    let calendarConnected = false;
    let notionConnected = false;
    const calendarRun = vi.fn(async (args: Record<string, unknown>) => {
      if (!calendarConnected) {
        throw new AgentConnectionRequiredError(
          "Connect Google Calendar to view your schedule.",
          {
            provider: "google_calendar",
            connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
          },
        );
      }
      return { events: [{ id: "evt-1", range: args.range }] };
    });
    const notionRun = vi.fn(async () => {
      if (!notionConnected) {
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
      "list-events": makeReadOnlyAction("List calendar events", calendarRun, {
        range: { type: "string" },
      }),
      "search-notion": makeReadOnlyAction("Search Notion pages", notionRun),
    });

    const { client } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { url: {} },
    });
    try {
      const calPrompt = asInputRequired(
        await callToolRaw(
          client,
          { name: "list-events", arguments: { range: "this-week" } },
          { allowInputRequired: true },
        ),
      );
      expect(calPrompt).toMatchObject({
        resultType: "input_required",
        inputRequests: {
          [MCP_ACTION_CONNECTION_INPUT_KEY]: {
            method: "elicitation/create",
            params: {
              mode: "url",
              url: `${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
            },
          },
        },
      });

      const calStillMissing = asCallToolResult(
        await callToolRaw(
          client,
          {
            name: "list-events",
            arguments: { range: "this-week" },
            requestState: calPrompt.requestState,
            inputResponses: {
              [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
            },
          },
          { allowInputRequired: true },
        ),
      );
      expect(calStillMissing.isError).toBe(true);
      expect(firstText(calStillMissing)).toContain(
        "google_calendar is still not connected",
      );
      expect(firstText(calStillMissing)).toContain(
        "Complete setup at https://calendar.agent-native.com/_agent-native/google/auth-url?redirect=1&calendar=1",
      );
      expect(firstText(calStillMissing)).toContain(
        "Do not retry automatically",
      );

      calendarConnected = true;
      const calSuccess = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "this-week" },
          requestState: calPrompt.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );
      expect(calSuccess.isError).not.toBe(true);
      expect(firstText(calSuccess)).toContain("evt-1");

      const notionPrompt = asInputRequired(
        await callToolRaw(
          client,
          { name: "search-notion", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      const notionStillMissing = asCallToolResult(
        await callToolRaw(
          client,
          {
            name: "search-notion",
            arguments: {},
            requestState: notionPrompt.requestState,
            inputResponses: {
              [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
            },
          },
          { allowInputRequired: true },
        ),
      );
      expect(notionStillMissing.isError).toBe(true);
      expect(firstText(notionStillMissing)).toContain(
        "notion is still not connected",
      );

      notionConnected = true;
      const notionSuccess = asCallToolResult(
        await callToolRaw(client, {
          name: "search-notion",
          arguments: {},
          requestState: notionPrompt.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );
      expect(notionSuccess.isError).not.toBe(true);
      expect(firstText(notionSuccess)).toContain("Roadmap");
    } finally {
      await client.close();
    }
  });

  it("handles decline, cancel, missing reply, mismatched tool/args, and expired state without re-running", async () => {
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
    try {
      const prompt = asInputRequired(
        await callToolRaw(
          client,
          { name: "list-events", arguments: { range: "today" } },
          { allowInputRequired: true },
        ),
      );
      expect(run).toHaveBeenCalledTimes(1);

      const declined = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "today" },
          requestState: prompt.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "decline" },
          },
        }),
      );
      expect(declined.isError).toBe(true);
      expect(firstText(declined)).toContain(
        "the user declined to connect google_calendar",
      );

      const cancelled = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "today" },
          requestState: prompt.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "cancel" },
          },
        }),
      );
      expect(cancelled.isError).toBe(true);
      expect(firstText(cancelled)).toContain(
        "connecting google_calendar was cancelled",
      );

      const missing = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "today" },
          requestState: prompt.requestState,
          inputResponses: {},
        }),
      );
      expect(missing.isError).toBe(true);
      expect(firstText(missing)).toContain(
        "connecting google_calendar was not completed",
      );

      const wrongTool = asCallToolResult(
        await callToolRaw(client, {
          name: "other-tool",
          arguments: { range: "today" },
          requestState: prompt.requestState,
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

      const wrongArgs = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "tomorrow" },
          requestState: prompt.requestState,
          inputResponses: {
            [MCP_ACTION_CONNECTION_INPUT_KEY]: { action: "accept" },
          },
        }),
      );
      expect(wrongArgs.isError).toBe(true);
      expect(firstText(wrongArgs)).toContain(
        "invalid, expired, or does not match",
      );

      clock.mockReturnValue(now + 11 * 60_000);
      const expired = asCallToolResult(
        await callToolRaw(client, {
          name: "list-events",
          arguments: { range: "today" },
          requestState: prompt.requestState,
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
    }
  });

  it("falls back to text with trusted URL (without duplicating an inline URL or promoting an untrusted URL)", async () => {
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
      "list-events-inline": makeReadOnlyAction(
        "List events with inline URL",
        async () => {
          throw new AgentConnectionRequiredError(
            "Open /_agent-native/google/auth-url?redirect=1&calendar=1 to connect.",
            {
              provider: "google_calendar",
              connectUrl:
                "/_agent-native/google/auth-url?redirect=1&calendar=1",
            },
          );
        },
      ),
      "list-events-untrusted": makeReadOnlyAction(
        "List events untrusted",
        async () => {
          throw new AgentConnectionRequiredError("Connect external provider", {
            provider: "google_calendar",
            connectUrl: "https://evil.example/oauth",
          });
        },
      ),
      "search-notion": makeReadOnlyAction("Search Notion pages", async () => ({
        status: "connection_required",
        provider: "notion",
        connectUrl: "/_agent-native/notion/connect",
        message: "Connect Notion to search pages.",
      })),
    });

    const { client: formOnlyClient } = await createModernMcpClient(config, {
      manualInputRequired: true,
      elicitation: { form: {} },
    });
    try {
      const fallback = asCallToolResult(
        await callToolRaw(
          formOnlyClient,
          { name: "list-events", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(fallback.isError).toBe(true);
      expect(firstText(fallback)).toContain(
        `Connect google_calendar: ${APP_ORIGIN}/_agent-native/google/auth-url?redirect=1&calendar=1`,
      );

      const inline = asCallToolResult(
        await callToolRaw(
          formOnlyClient,
          { name: "list-events-inline", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(inline.isError).toBe(true);
      expect(firstText(inline)).not.toContain("Connect google_calendar:");

      const untrusted = asCallToolResult(
        await callToolRaw(
          formOnlyClient,
          { name: "list-events-untrusted", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(untrusted.isError).toBe(true);
      expect(firstText(untrusted)).not.toContain("https://evil.example");

      const returned = asCallToolResult(
        await callToolRaw(
          formOnlyClient,
          { name: "search-notion", arguments: {} },
          { allowInputRequired: true },
        ),
      );
      expect(firstText(returned)).toContain("Connect Notion to search pages.");
    } finally {
      await formOnlyClient.close();
    }
  });
});
