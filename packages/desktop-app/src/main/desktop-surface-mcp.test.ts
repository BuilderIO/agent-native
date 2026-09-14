import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptureActiveDesktopBrowserScreenshot } from "./desktop-browser-screenshot";
import { DesktopSurfaceMcpBridge } from "./desktop-surface-mcp";

const active: Array<{ bridge: DesktopSurfaceMcpBridge; client: Client }> = [];

afterEach(async () => {
  for (const { bridge, client } of active.splice(0)) {
    await client.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
  vi.restoreAllMocks();
});

async function createHarness(
  captureActiveBrowserScreenshot?: CaptureActiveDesktopBrowserScreenshot,
) {
  const openApp = vi.fn();
  const bridge = new DesktopSurfaceMcpBridge({
    listApps: () => [
      { id: "mail", name: "Mail" },
      { id: "calendar", name: "Calendar" },
    ],
    openApp,
    getActiveAppContext: () => ({
      appId: "mail",
      appName: "Mail",
      path: "/inbox",
    }),
    captureActiveBrowserScreenshot,
  });
  const url = await bridge.start();
  const registration = bridge.register();
  const client = new Client(
    { name: "desktop-surface-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${registration.bearerToken}` },
      },
    }),
  );
  active.push({ bridge, client });
  return { bridge, client, openApp, registration };
}

describe("DesktopSurfaceMcpBridge", () => {
  it("exposes the sidebar app tool behind a loopback bearer", async () => {
    const harness = await createHarness();
    const unauthorized = await fetch(harness.registration.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);

    const tools = await harness.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_apps",
        "open_app",
        "get_active_app_context",
      ]),
    );

    const context = await harness.client.callTool({
      name: "get_active_app_context",
      arguments: {},
    });
    const contextText = context.content?.find((item) => item.type === "text");
    expect(
      contextText?.type === "text" ? JSON.parse(contextText.text) : null,
    ).toEqual(
      expect.objectContaining({
        activeApp: expect.objectContaining({
          appId: "mail",
          appName: "Mail",
          path: "/inbox",
        }),
      }),
    );

    const apps = await harness.client.callTool({
      name: "list_apps",
      arguments: {},
    });
    const appsText = apps.content?.find((item) => item.type === "text");
    expect(
      appsText?.type === "text" ? JSON.parse(appsText.text) : null,
    ).toEqual(
      expect.objectContaining({
        apps: expect.arrayContaining([{ id: "mail", name: "Mail" }]),
      }),
    );

    const opened = await harness.client.callTool({
      name: "open_app",
      arguments: { app: "mail", path: "/inbox", view: "inbox" },
    });
    expect(opened.isError).not.toBe(true);
    expect(harness.openApp).toHaveBeenCalledWith({
      app: "mail",
      path: "/inbox",
      view: "inbox",
    });
  });

  it("rejects unknown apps and unsafe paths without opening anything", async () => {
    const harness = await createHarness();
    const unknown = await harness.client.callTool({
      name: "open_app",
      arguments: { app: "notes" },
    });
    expect(unknown.isError).toBe(true);

    const unsafe = await harness.client.callTool({
      name: "open_app",
      arguments: { app: "mail", path: "https://example.com" },
    });
    expect(unsafe.isError).toBe(true);
    expect(harness.openApp).not.toHaveBeenCalled();
  });

  it("returns pixels from the active inline browser surface", async () => {
    const screenshot = {
      data: Buffer.from("inline-browser").toString("base64"),
      mediaType: "image/jpeg" as const,
      width: 1_200,
      height: 800,
    };
    const harness = await createHarness(async () => screenshot);
    const tool = (await harness.client.listTools()).tools.find(
      (candidate) => candidate.name === "browser_screenshot",
    );
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });

    const result = await harness.client.callTool({
      name: "browser_screenshot",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          captured: true,
          source: "active-inline-browser",
          width: 1_200,
          height: 800,
        }),
      },
      { type: "image", data: screenshot.data, mimeType: "image/jpeg" },
    ]);
  });
});
