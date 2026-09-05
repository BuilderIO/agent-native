/**
 * MCP analytics coverage.
 *
 * Drives the real `createMCPServerForRequest` over an in-memory transport
 * pair, so the assertions are about what an actual `tools/list` /
 * `tools/call` exchange emits — not about the helpers in isolation. A
 * property name here is a contract with every dashboard built on PostHog's
 * MCP vocabulary, so the tests pin the exact keys.
 */

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/store.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import { detectVendorClient, readClientInfoFromRequest } from "./analytics.js";
import { createMCPServerForRequest, type MCPConfig } from "./build-server.js";

const ORIGINAL_ENV = { ...process.env };
let events: TrackingEvent[] = [];
let capturedMcpActionContext: Record<string, unknown> | undefined;

function config(): MCPConfig {
  return {
    name: "Mail",
    appId: "mail",
    description: "Test app",
    version: "2.3.4",
    actions: {
      "list-messages": {
        tool: { description: "List messages", parameters: undefined },
        readOnly: true,
        run: async () => [{ id: "m1" }],
      } as any,
      "send-message": {
        tool: { description: "Send a message", parameters: undefined },
        run: async (_args: unknown, ctx: Record<string, unknown>) => {
          capturedMcpActionContext = ctx;
          throw new Error("smtp unavailable");
        },
      } as any,
    },
  };
}

async function connectedClient(meta?: Record<string, unknown>) {
  const server = await createMCPServerForRequest(config(), undefined, {
    origin: "http://localhost:8100",
    transport: "http",
    clientName: "claude-code/1.2.3",
    fullCatalog: true,
    ...meta,
  } as any);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "9.9.9" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function eventNamed(name: string): TrackingEvent | undefined {
  return events.find((event) => event.name === name);
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_ANALYTICS;
  delete process.env.MCP_ANALYTICS_PARAMETERS;
  resetAppConfigForTests();
  events = [];
  capturedMcpActionContext = undefined;
  registerTrackingProvider({
    name: "spec-collector",
    track(event) {
      events.push(event);
    },
  });
});

afterEach(() => {
  unregisterTrackingProvider("spec-collector");
  process.env = ORIGINAL_ENV;
  resetAppConfigForTests();
});

describe("MCP analytics events", () => {
  it("emits $mcp_tools_list with the listed tool names and server context", async () => {
    const client = await connectedClient();
    await client.listTools();

    const event = eventNamed("$mcp_tools_list");
    expect(event).toBeDefined();
    const props = event!.properties!;
    expect(props.$mcp_listed_tool_names).toContain("list-messages");
    expect(props.$mcp_source).toBe("http");
    expect(props.$mcp_server_name).toBe("Mail");
    expect(props.$mcp_server_version).toBe("2.3.4");
    expect(props.$mcp_app_id).toBe("mail");
    expect(typeof props.$mcp_duration_ms).toBe("number");
  });

  it("emits $mcp_tool_call for a successful call without the arguments", async () => {
    const client = await connectedClient();
    await client.callTool({
      name: "list-messages",
      arguments: { folder: "inbox" },
    });

    const event = eventNamed("$mcp_tool_call");
    expect(event).toBeDefined();
    const props = event!.properties!;
    expect(props.$mcp_tool_name).toBe("list-messages");
    expect(props.$mcp_tool_description).toBe("List messages");
    expect(props.$mcp_tool_category).toBe("read");
    expect(props.$mcp_is_error).toBe(false);
    expect(props.$mcp_parameters).toBeUndefined();
    expect(props.$mcp_error_type).toBeUndefined();
  });

  it("includes redacted $mcp_parameters only when opted in", async () => {
    process.env.MCP_ANALYTICS_PARAMETERS = "true";
    resetAppConfigForTests();
    const client = await connectedClient();
    await client.callTool({
      name: "list-messages",
      arguments: { folder: "inbox", apiKey: "sk-live-should-not-ship" },
    });

    const props = eventNamed("$mcp_tool_call")!.properties!;
    expect(props.$mcp_parameters).toEqual({
      folder: "inbox",
      apiKey: "<redacted>",
    });
  });

  it("reports a failed tool call as an error with its type and message", async () => {
    const client = await connectedClient();
    await client.callTool({ name: "send-message", arguments: {} });

    const props = eventNamed("$mcp_tool_call")!.properties!;
    expect(props.$mcp_tool_name).toBe("send-message");
    expect(props.$mcp_tool_category).toBe("write");
    expect(props.$mcp_is_error).toBe(true);
    expect(props.$mcp_error_type).toBe("Error");
    expect(props.$mcp_error_message).toContain("smtp unavailable");
  });

  it("passes the configured app id into the action context", async () => {
    const client = await connectedClient();
    await client.callTool({ name: "send-message", arguments: {} });

    expect(capturedMcpActionContext).toMatchObject({
      appId: "mail",
      caller: "mcp",
      actionName: "send-message",
    });
  });

  it("distinguishes an unknown tool from a tool that threw", async () => {
    const client = await connectedClient({ fullCatalog: false });
    await client.callTool({ name: "no-such-tool", arguments: {} });

    const props = eventNamed("$mcp_tool_call")!.properties!;
    expect(props.$mcp_is_error).toBe(true);
    expect(props.$mcp_error_type).toBe("unknown_tool");
  });

  it("emits nothing when MCP analytics is turned off", async () => {
    process.env.MCP_ANALYTICS = "false";
    resetAppConfigForTests();
    const client = await connectedClient();
    await client.listTools();

    expect(events).toEqual([]);
  });
});

describe("client identification", () => {
  it("buckets the calling host by vendor from name or user agent", () => {
    expect(detectVendorClient("Claude Code", undefined)).toBe("claude-code");
    expect(detectVendorClient(undefined, "cursor-mcp/0.4")).toBe("cursor");
    expect(detectVendorClient("some-unknown-host")).toBeUndefined();
    expect(detectVendorClient(undefined, undefined)).toBeUndefined();
  });

  it("reads the client's own name and version from per-request _meta", () => {
    expect(
      readClientInfoFromRequest({
        params: {
          _meta: {
            "io.modelcontextprotocol/clientInfo": {
              name: "cursor",
              version: "0.4.1",
            },
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          },
        },
      }),
    ).toEqual({
      clientName: "cursor",
      clientVersion: "0.4.1",
      protocolVersion: "2026-07-28",
    });
    expect(readClientInfoFromRequest(undefined)).toEqual({});
  });
});
