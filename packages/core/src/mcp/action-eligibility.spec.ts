import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { createToolSearchEntry } from "../agent/tool-search.js";
import { withCatalogClient } from "./advertised-catalog.harness.js";
import type { MCPConfig } from "./build-server.js";
import { frameworkMcpTools } from "./framework-tools.js";

afterEach(() => vi.unstubAllEnvs());

describe("MCP input and framework eligibility", () => {
  it.each([
    "compact",
    "connector",
    "app",
    "directory",
    "full token",
    "full env",
  ])(
    "enforces raw-input opt-in and factory opt-out in %s mode",
    async (mode) => {
      vi.stubEnv(
        "AGENT_NATIVE_MCP_FULL_CATALOG",
        mode === "full env" ? "1" : "0",
      );
      const blocked = vi.fn(() => ({ unexpected: true }));
      const query = vi.fn(() => ({ items: [] }));
      const read: ActionEntry = {
        tool: {
          description: "List items",
          parameters: { type: "object", properties: {} },
        },
        mcpTool: true,
        readOnly: true,
        mcpAnnotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        run: async () => ({ items: [] }),
      };
      const sqlTool = {
        description: "Opaque SQL probe",
        parameters: {
          type: "object",
          properties: { sql: { type: "string" } },
          required: ["sql"],
        },
      };
      const actions: Record<string, ActionEntry> = {
        "list-items": read,
        "query-items": {
          ...read,
          tool: sqlTool,
          publicAgent: { allowRawQueryInput: true },
          run: query,
        },
        "unsafe-query-items": { ...read, tool: sqlTool, run: blocked },
        ...frameworkMcpTools({
          "docs-search": { ...read, run: blocked },
          "new-runtime": {
            ...read,
            tool: { description: "Opaque runtime probe" },
            run: blocked,
          },
        }),
      };
      actions["tool-search"] = createToolSearchEntry(() => actions);
      const config: MCPConfig = {
        name: "input-contract",
        actions,
        builtinCrossAppTools: false,
        ...(mode === "app" || mode === "directory"
          ? { catalogMode: mode }
          : {}),
        ...(mode === "directory"
          ? {
              widgetDomain: "https://catalog-contract.example.com",
              connectorCatalog: [
                "list-items",
                "query-items",
                "unsafe-query-items",
              ],
            }
          : mode === "connector"
            ? { connectorCatalog: Object.keys(actions) }
            : {}),
      };
      await withCatalogClient(
        config,
        { fullCatalog: mode === "full token", fullSurface: false },
        async (client) => {
          const names = (await client.listTools()).tools
            .map((tool) => tool.name)
            .sort();
          expect(names).toEqual(
            mode === "compact" || mode === "connector"
              ? ["list-items", "query-items", "tool-search"]
              : ["list-items", "query-items"],
          );
          for (const name of [
            "unsafe-query-items",
            "new-runtime",
            "docs-search",
          ]) {
            const result = await client.callTool({
              name,
              arguments: { sql: "SELECT 1" },
            });
            expect(result.isError).toBe(true);
            expect(result.content).toEqual([
              { type: "text", text: `Unknown tool: ${name}` },
            ]);
          }
          if (names.includes("tool-search")) {
            const result = await client.callTool({
              name: "tool-search",
              arguments: { query: "opaque probe", includeSchemas: true },
            });
            const text = (result.content as { type: string; text?: string }[])
              .map((item) => item.text ?? "")
              .join("\n");
            expect(text).not.toMatch(
              /"name"\s*:\s*"(?:new-runtime|unsafe-query-items|docs-search)"/,
            );
          }
          expect(
            (
              await client.callTool({
                name: "query-items",
                arguments: { sql: "SELECT 1" },
              })
            ).isError,
          ).not.toBe(true);
        },
      );
      expect(blocked).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledOnce();
    },
  );
});
