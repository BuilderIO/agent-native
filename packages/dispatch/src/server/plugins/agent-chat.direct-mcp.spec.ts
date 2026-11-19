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

async function listTools(enabled: boolean) {
  resetAppConfigForTests();
  defineAppConfig({ dispatch: { directAppActions: enabled } });
  await import("./agent-chat.js");
  const options = captured.options;
  if (!options) throw new Error("Dispatch plugin was not registered");
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
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
  return JSON.parse(json).result.tools.map(
    (tool: { name: string }) => tool.name,
  );
}

describe("Dispatch direct app action MCP catalog", () => {
  afterEach(() => resetAppConfigForTests());
  it("advertises the opted-in tools over HTTP and omits them when disabled", async () => {
    const names = ["list_app_actions", "call_app_action", "read_view"];
    const disabled = await listTools(false);
    for (const name of names) expect(disabled).not.toContain(name);
    expect(await listTools(true)).toEqual(expect.arrayContaining(names));
  });
});
