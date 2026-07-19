import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivateVaultContentMcpBridge } from "./content-mcp-server.js";

const active: Array<{
  bridge: PrivateVaultContentMcpBridge;
  client?: Client;
}> = [];

afterEach(async () => {
  for (const item of active.splice(0)) {
    await item.client?.close().catch(() => undefined);
    await item.bridge.close().catch(() => undefined);
  }
});

describe("Private Vault Content MCP bridge", () => {
  it("exposes familiar actions with server-owned agent identity", async () => {
    const runAction = vi.fn(async () => ({ documents: [] }));
    const bridge = new PrivateVaultContentMcpBridge({ runAction });
    active.push({ bridge });
    const url = await bridge.start();
    const subjectAgentId = "aa".repeat(16);
    const registration = bridge.registerRun("run-1", subjectAgentId);
    const client = new Client({ name: "test", version: "1.0.0" });
    active[0]!.client = client;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: { Authorization: `Bearer ${registration.bearerToken}` },
        },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("search-documents");
    expect(tools.tools.map((tool) => tool.name)).toContain("view-screen");
    expect(
      tools.tools.find((tool) => tool.name === "view-screen")?.annotations,
    ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(
      tools.tools.find((tool) => tool.name === "search-documents")?.inputSchema,
    ).not.toHaveProperty("properties.subjectAgentId");
    await expect(
      client.callTool({
        name: "search-documents",
        arguments: {
          args: { query: "private", subjectAgentId: "ff".repeat(16) },
        },
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: '{"documents":[]}' }],
    });
    expect(runAction).toHaveBeenCalledWith({
      actionName: "search-documents",
      args: { query: "private", subjectAgentId: "ff".repeat(16) },
      subjectAgentId,
    });
  });

  it("revokes per-run credentials and rejects malformed registrations", async () => {
    const bridge = new PrivateVaultContentMcpBridge({
      runAction: vi.fn(async () => null),
      token: () => "x".repeat(43),
    });
    active.push({ bridge });
    await bridge.start();
    expect(() => bridge.registerRun("run", "not-an-id")).toThrow();
    const registration = bridge.registerRun("run", "aa".repeat(16));
    bridge.revokeRun("run");
    const response = await fetch(registration.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${registration.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(401);
  });
});
