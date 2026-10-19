import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { describe, expect, it } from "vitest";

import listPlanComponents from "./list-plan-components.js";

// The MCP SDK is a dependency of core, not of this template.
const requireFromCore = createRequire(
  createRequire(import.meta.url).resolve("@agent-native/core"),
);
const { createMcpHandler } = await import(
  pathToFileURL(requireFromCore.resolve("@modelcontextprotocol/server")).href
);

async function rpc(method: string, params: Record<string, unknown>) {
  const handler = createMcpHandler(
    () =>
      createMCPServerForRequest(
        {
          name: "Plan",
          appId: "plan",
          description: "Plan app",
          builtinCrossAppTools: false,
          actions: { "list-plan-components": listPlanComponents },
        } as Parameters<typeof createMCPServerForRequest>[0],
        {
          userEmail: "contract@example.com",
          orgDomain: undefined,
          orgId: null,
          oauthScopes: ["mcp:read"],
        },
        { fullCatalog: true },
      ),
    { legacy: "stateless", responseMode: "auto" },
  );
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const res = await handler.fetch(
    new Request("https://plan.example.test/_agent-native/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(body),
    }),
    { parsedBody: body },
  );
  const text = await res.text();
  const payload = text.includes("data:")
    ? text
        .split("\n")
        .find((line: string) => line.startsWith("data:"))!
        .slice(5)
    : text;
  return JSON.parse(payload).result;
}

describe("list-plan-components output contract", () => {
  it("advertises its audited output contract over MCP", async () => {
    const { tools } = await rpc("tools/list", {});
    const tool = tools.find(
      (entry: { name: string }) => entry.name === "list-plan-components",
    );
    expect(tool.outputSchema).toMatchObject({
      type: "object",
      properties: { widget: { const: "data-insights" } },
    });
  });

  it.each([{}, { query: "api", includeExamples: true }])(
    "returns structuredContent that meets the contract for %j",
    async (args) => {
      const result = await rpc("tools/call", {
        name: "list-plan-components",
        arguments: args,
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        widget: "data-insights",
        table: { columns: expect.any(Array) },
      });
    },
  );
});
