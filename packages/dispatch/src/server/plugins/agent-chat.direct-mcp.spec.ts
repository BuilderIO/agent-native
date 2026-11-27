import type { ActionEntry } from "@agent-native/core/agent";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "@agent-native/core/app-config";
import { handleMcpFetchRequest } from "@agent-native/core/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";

type Options = {
  actions: () => Record<string, ActionEntry>;
  mcp: { connectorCatalog: string[]; externalAgents?: never };
};
const captured = vi.hoisted(() => ({
  options: undefined as Options | undefined,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAgentChatPlugin: (options: Options) => {
    captured.options = options;
    return () => {};
  },
}));

vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserSetting: vi.fn(async () => ({
    mode: "selected-apps",
    selectedAppIds: [],
  })),
}));

vi.mock("../lib/mcp-app-discovery.js", () => ({
  discoverDispatchMcpApps: vi.fn(async () => ({
    agents: [
      {
        id: "slides",
        name: "Slides",
        description: "Presentations",
        url: "https://slides.example.test",
        color: "#000000",
      },
    ],
    mountedApps: [],
    degradedSources: [],
  })),
}));

async function requestMcp(
  enabled: boolean,
  method: string,
  params: Record<string, unknown>,
) {
  resetAppConfigForTests();
  defineAppConfig({ dispatch: { directAppActions: enabled } });
  await import("./agent-chat.js");
  const options = captured.options;
  if (!options) throw new Error("Dispatch plugin was not registered");
  const rpc = { jsonrpc: "2.0", id: 1, method, params };
  const response = await handleMcpFetchRequest(
    new Request("https://dispatch.example.test/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(rpc),
    }),
    {
      name: "dispatch",
      actions: options.actions(),
      connectorCatalog: options.mcp.connectorCatalog,
      externalAgents: options.mcp.externalAgents,
    },
    {
      identity: {
        userEmail: "test@example.com",
        orgId: null,
        oauthScopes: ["mcp:read", "mcp:write"],
      },
      requestMeta: { transport: "http", inlineMcpApps: false },
      parsedBody: rpc,
    },
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  const data = body.split("\n").find((line) => line.startsWith("data:"));
  if (body.startsWith("event:") && !data)
    throw new Error("Missing MCP response data");
  const json = data ? data.slice(5) : body;
  return JSON.parse(json);
}

async function listTools(enabled: boolean) {
  const response = await requestMcp(enabled, "tools/list", {});
  return response.result.tools.map((tool: { name: string }) => tool.name);
}

describe("Dispatch direct app action MCP catalog", () => {
  afterEach(() => resetAppConfigForTests());
  it("advertises the opted-in tools over HTTP and omits them when disabled", async () => {
    const names = ["list_app_actions", "call_app_action", "read_view"];
    const disabled = await listTools(false);
    for (const name of names) expect(disabled).not.toContain(name);
    expect(await listTools(true)).toEqual(expect.arrayContaining(names));
  });

  it("advertises neutral capability descriptions without prescriptive cross-tool instructions", async () => {
    const forbidden =
      /\b(?:call\s+\w+\s+(?:first|before)|call\s+it\s+(?:before|after)|prefer\s+this\s+to|prefer\s+list_app_actions|do\s+not\s+require|do\s+not\s+ask\s+the\s+user|do\s+not\s+scaffold|never\s+resubmit|after\s+calling,\s+surface)\b/i;
    for (const enabled of [false, true]) {
      const response = await requestMcp(enabled, "tools/list", {});
      const tools = response.result.tools as Array<{
        name: string;
        description?: string;
      }>;
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(
          tool.description ?? "",
          `${tool.name} (directAppActions=${enabled})`,
        ).not.toMatch(forbidden);
      }
    }
  });

  it.each([
    { name: "list_app_actions", arguments: { app: "slides" } },
    {
      name: "call_app_action",
      arguments: { app: "slides", action: "list-decks", args: {} },
    },
    { name: "read_view", arguments: { app: "slides" } },
  ])(
    "enforces opt-in and app access on HTTP calls to $name",
    async (params) => {
      const disabled = await requestMcp(false, "tools/call", params);
      expect(disabled.result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${params.name}` }],
      });

      const ungranted = await requestMcp(true, "tools/call", params);
      expect(ungranted.result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: expect.stringContaining('access to "slides" is not granted'),
          },
        ],
      });
    },
  );
});
