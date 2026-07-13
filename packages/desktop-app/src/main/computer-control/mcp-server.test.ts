import { McpClientManager } from "@agent-native/core/mcp-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserControlLoopbackBridge } from "../browser-control/bridge";
import type { BrowserHostBridgeRegistration } from "../browser-control/protocol";
import { ComputerControlBroker } from "./broker";
import type { DesktopHelper } from "./helper-client";
import {
  DesktopComputerMcpBridge,
  type DesktopComputerPermissionMode,
} from "./mcp-server";
import { EphemeralScreenObserver } from "./screen-observer";
import type { MutationOperation, SemanticSnapshot } from "./types";

const snapshot: SemanticSnapshot = {
  snapshotId: "snapshot-1",
  bundleId: "com.example.Editor",
  origin: "https://example.com/private/path",
  capturedAt: "2026-07-10T00:00:00.000Z",
  nodes: [{ id: "button-1", role: "AXButton", title: "Continue" }],
};

interface Harness {
  bridge: DesktopComputerMcpBridge;
  client: Client;
  registration: { url: string; bearerToken: string };
  mutations: MutationOperation[];
  releaseAll: ReturnType<typeof vi.fn>;
  browserHost?: BrowserHostBridgeRegistration;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0)) {
    await harness.client.close().catch(() => undefined);
    await harness.bridge.close().catch(() => undefined);
  }
});

async function createHarness(
  permissionMode: DesktopComputerPermissionMode,
  withBrowser = false,
): Promise<Harness> {
  const mutations: MutationOperation[] = [];
  const releaseAll = vi.fn(async () => undefined);
  const helper: DesktopHelper = {
    snapshot: vi.fn(async () => snapshot),
    mutate: vi.fn(async (operation) => {
      mutations.push(operation);
    }),
    releaseAll,
    close: vi.fn(),
  };
  const permissionStatus = () => ({
    screenRecording: "granted" as const,
    accessibility: true,
  });
  const broker = new ComputerControlBroker({ helper, permissionStatus });
  const screenObserver = new EphemeralScreenObserver({
    desktopCapturer: {
      getSources: vi.fn(async () => [
        {
          id: "screen:1:0",
          name: "Private window title",
          thumbnail: {
            isEmpty: () => false,
            getSize: () => ({ width: 800, height: 600 }),
            toPNG: () => Buffer.from("bounded-png"),
          },
        },
      ]),
    },
    permissionStatus,
  });
  const browserBridge = withBrowser
    ? new BrowserControlLoopbackBridge()
    : undefined;
  const browserHost = await browserBridge?.start();
  const bridge = new DesktopComputerMcpBridge({
    broker,
    permissionStatus,
    screenObserver,
    browserBridge,
  });
  const url = await bridge.start();
  const registration = bridge.registerRun("run-server-owned", permissionMode);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${registration.bearerToken}` },
      },
    }),
  );
  const harness = {
    bridge,
    client,
    registration,
    mutations,
    releaseAll,
    browserHost,
  };
  active.push(harness);
  return harness;
}

describe("DesktopComputerMcpBridge", () => {
  it("requires its per-run bearer and exposes observation without model-supplied identity", async () => {
    const harness = await createHarness("full-auto");
    const unauthorized = await fetch(harness.registration.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);

    const tools = await harness.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).not.toContain(
      "computer_takeover",
    );
    expect(
      tools.tools.find((tool) => tool.name === "computer_click")?.inputSchema,
    ).not.toHaveProperty("properties.taskId");

    const observed = await harness.client.callTool({
      name: "computer_observe",
      arguments: {},
    });
    expect(observed.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "image",
          mimeType: "image/png",
          data: Buffer.from("bounded-png").toString("base64"),
        }),
      ]),
    );
    expect(JSON.stringify(observed)).not.toContain("Private window title");
  });

  it("allows one fresh mutation only in full Auto mode and derives the task and target", async () => {
    const harness = await createHarness("full-auto");
    await harness.client.callTool({
      name: "computer_observe",
      arguments: {},
    });
    const clicked = await harness.client.callTool({
      name: "computer_click",
      arguments: { nodeId: "button-1", taskId: "model-forged" },
    });
    expect(clicked.isError).not.toBe(true);
    expect(harness.mutations).toHaveLength(1);
    expect(harness.mutations[0]).toMatchObject({
      kind: "input.click",
      taskId: "run-server-owned",
      target: {
        snapshotId: "snapshot-1",
        nodeId: "button-1",
        bundleId: "com.example.Editor",
        origin: "https://example.com",
        expectedRole: "AXButton",
      },
    });

    const stale = await harness.client.callTool({
      name: "computer_click",
      arguments: { nodeId: "button-1" },
    });
    expect(stale.isError).toBe(true);
    expect(harness.mutations).toHaveLength(1);
  });

  it("keeps mutations blocked in Plan mode and revokes credentials on stop", async () => {
    const harness = await createHarness("read-only");
    const observation = await harness.client.callTool({
      name: "computer_observe",
      arguments: {},
    });
    expect(observation.isError).toBe(true);
    const blocked = await harness.client.callTool({
      name: "computer_click",
      arguments: { nodeId: "button-1" },
    });
    expect(blocked.isError).toBe(true);
    expect(harness.mutations).toHaveLength(0);

    await harness.bridge.revokeRun("run-server-owned");
    const revoked = await fetch(harness.registration.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${harness.registration.bearerToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(revoked.status).toBe(401);
    expect(harness.releaseAll).toHaveBeenCalled();
  });

  it("is invokable through the same core MCP manager used by Agent runs", async () => {
    const harness = await createHarness("full-auto");
    const manager = new McpClientManager({
      servers: {
        "agent-native-desktop-computer": {
          type: "http",
          url: harness.registration.url,
          headers: {
            Authorization: `Bearer ${harness.registration.bearerToken}`,
          },
        },
      },
    });
    await manager.start();
    expect(manager.hasServer("agent-native-desktop-computer")).toBe(true);
    const result = await manager.callTool(
      "mcp__agent-native-desktop-computer__computer_observe",
      {},
    );
    expect(result).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
      ]),
    });
    await manager.stop();
  });

  it("routes browser tools through the native-host bridge with server-owned identity and observations", async () => {
    const harness = await createHarness("full-auto", true);
    const host = harness.browserHost!;
    const poll = async () => {
      const response = await fetch(`${host.baseUrl}/v1/commands`, {
        headers: { authorization: `Bearer ${host.bearerToken}` },
      });
      return response.json() as Promise<any>;
    };
    const respond = (id: string, result?: unknown) =>
      fetch(`${host.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${host.bearerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id, ok: true, result }),
      });

    const attaching = harness.client.callTool({
      name: "browser_attach",
      arguments: {
        tabId: 9,
        origin: "https://example.com",
        taskId: "model-forged",
      },
    });
    const attach = await poll();
    expect(attach).toMatchObject({
      taskId: "run-server-owned",
      command: {
        type: "attach",
        tabId: 9,
        allowedOrigins: ["https://example.com"],
      },
    });
    await respond(attach.id, { tabId: 9, origin: "https://example.com" });
    expect((await attaching).isError).not.toBe(true);

    const observing = harness.client.callTool({
      name: "browser_observe",
      arguments: {},
    });
    const observe = await poll();
    await respond(observe.id, {
      tabId: 9,
      observationId: "observation-server-result",
      nodes: [{ backendNodeId: 17, role: "button" }],
      screenshot: {
        mediaType: "image/jpeg",
        data: Buffer.from("chrome-frame").toString("base64"),
        width: 800,
        height: 600,
      },
    });
    expect((await observing).content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({ type: "image", mimeType: "image/jpeg" }),
      ]),
    );

    const clicking = harness.client.callTool({
      name: "browser_click",
      arguments: { backendNodeId: 17, observationId: "model-forged" },
    });
    const click = await poll();
    expect(click.command).toMatchObject({
      type: "click",
      target: {
        observationId: "observation-server-result",
        backendNodeId: 17,
      },
    });
    await respond(click.id, { x: 10, y: 20 });
    expect((await clicking).isError).not.toBe(true);
  });
});
