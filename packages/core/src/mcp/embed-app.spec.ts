import { describe, expect, it } from "vitest";
import type { ActionMcpAppResourceConfig } from "../action.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { embedApp, MCP_APP_REQUEST_ORIGIN_CSP_SOURCE } from "./embed-app.js";

describe("embedApp", () => {
  it("returns an MCP App resource that calls the embed session helper", () => {
    const resource = embedApp({
      title: "Dashboard",
      openLabel: "Open dashboard",
    });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "open_app", appId: "analytics" })
        : resource.html;

    expect(html).toContain("create_embed_session");
    expect(html).toContain("app.callServerTool");
    expect(html).toContain("app.updateModelContext");
    expect(html).toContain("app.sendMessage");
    expect(html).toContain('document.createElement("iframe")');
    expect(html).toContain('"agentNative.submitChat"');
    expect(html).toContain('"agentNative.frameOrigin"');
    expect(html).toContain('"agentNative.mcpHostContext"');
    expect(html).toContain('"agentNative.mcpHost.updateModelContext"');
    expect(html).toContain('"agentNative.mcpHost.openLink"');
    expect(html).toContain('"agentNative.mcpHost.requestDisplayMode"');
    expect(html).toContain('"agentNative.mcpHost.response"');
    expect(html).toContain("app.requestDisplayMode");
    expect(html).toContain("__an_mcp_chat_bridge");
    expect(html).toContain('data-app-title="Dashboard"');
    expect(html).toContain("data-title-label>Dashboard");
    expect(html).toContain('document.querySelector("[data-title-label]")');
    expect(html).not.toContain('document.querySelector("[data-title]")');
    expect(html).toContain(
      'toolInput.embed === false || toolInput.embed === "false"',
    );
    expect(html).toContain("min-height: 900px");
    expect(resource.csp?.frameDomains).toContain(
      MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    );
    expect(resource.csp?.resourceDomains).toContain("https://esm.sh");
  });

  it("allows full-app embeds to request a 900px canvas", () => {
    const resource = embedApp({ height: 900 });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "open_app", appId: "analytics" })
        : resource.html;

    expect(html).toContain("min-height: 900px");
    expect(html).toContain("height: 856px");
  });

  it("provides a local MCP App payload fixture for renderer tests", () => {
    const fixture = createLocalMcpAppEmbedHarness({
      actionName: "open_app",
      appId: "analytics",
      openUrl: "http://localhost:5173/dashboard",
      title: "Analytics",
    });

    expect(fixture.payload).toMatchObject({
      serverId: "local-fixture",
      toolName: "open_app",
      originalToolName: "open_app",
      resourceUri: "ui://local-fixture/open_app",
      toolInput: { embed: true },
      resource: {
        uri: "ui://local-fixture/open_app",
        text: fixture.html,
        _meta: {
          ui: {
            prefersBorder: false,
            csp: {
              frameDomains: [MCP_APP_REQUEST_ORIGIN_CSP_SOURCE],
            },
          },
        },
      },
    });
    expect(fixture.payload.toolResult).toMatchObject({
      structuredContent: { url: "http://localhost:5173/dashboard" },
      _meta: {
        "agent-native/openLink": {
          webUrl: "http://localhost:5173/dashboard",
        },
      },
    });
    expect(fixture.messages.frameOrigin).toEqual({
      type: "agentNative.frameOrigin",
      origin: "http://localhost:5173",
    });
    expect(fixture.messages.submitChat).toEqual({
      type: "agentNative.submitChat",
      data: {
        context: "Selected dashboard: Analytics",
        message: "Summarize this dashboard",
        submit: true,
      },
    });
  });

  it("keeps the local fixture aligned with the wrapper bridge contract", () => {
    const fixture = createLocalMcpAppEmbedHarness();

    expect(fixture.html).toContain("app.connect()");
    expect(fixture.html).toContain("app.callServerTool");
    expect(fixture.html).toContain("app.openLink");
    expect(fixture.html).toContain("app.updateModelContext");
    expect(fixture.html).toContain("app.requestDisplayMode");
    expect(fixture.html).toContain("app.sendMessage");
    expect(fixture.html).toContain('"agentNative.frameOrigin"');
    expect(fixture.html).toContain('"agentNative.submitChat"');
    expect(fixture.html).toContain('"agentNative.mcpHostContext"');
    expect(fixture.html).toContain('"agentNative.mcpHost.updateModelContext"');
    expect(fixture.html).toContain('"agentNative.mcpHost.openLink"');
    expect(fixture.html).toContain('"agentNative.mcpHost.requestDisplayMode"');
    expect(fixture.html).toContain('"agentNative.mcpHost.response"');
    expect(fixture.html).toContain("event.source !== appFrame.contentWindow");
    expect(fixture.html).toContain(
      'url.searchParams.set(chatBridgeParam, "1")',
    );
    expect(fixture.html).toContain("name: startTool");
    expect(fixture.html).toContain("arguments: {");
  });
});

interface LocalMcpAppEmbedHarnessOptions {
  actionName?: string;
  appId?: string;
  openUrl?: string;
  title?: string;
}

function createLocalMcpAppEmbedHarness({
  actionName = "open_app",
  appId = "demo",
  openUrl = "http://localhost:5173/app",
  title = "Demo app",
}: LocalMcpAppEmbedHarnessOptions = {}) {
  const resource = embedApp({ title });
  const html = renderMcpAppResourceHtml(resource, { actionName, appId });

  const payload: AgentMcpAppPayload = {
    serverId: "local-fixture",
    toolName: actionName,
    originalToolName: actionName,
    resourceUri: `ui://local-fixture/${actionName}`,
    toolInput: { embed: true },
    toolResult: {
      structuredContent: { url: openUrl, label: title },
      _meta: { "agent-native/openLink": { webUrl: openUrl } },
    },
    tool: {
      name: actionName,
      title,
      description: "Local MCP App embed fixture",
      inputSchema: { type: "object", properties: {} },
    },
    resource: {
      uri: `ui://local-fixture/${actionName}`,
      mimeType: "text/html+skybridge",
      text: html,
      _meta: {
        ui: {
          csp: resource.csp,
          prefersBorder: resource.prefersBorder,
        },
      },
    },
  };

  return {
    html,
    payload,
    messages: {
      frameOrigin: {
        type: "agentNative.frameOrigin",
        origin: new URL(openUrl).origin,
      },
      submitChat: {
        type: "agentNative.submitChat",
        data: {
          context: `Selected dashboard: ${title}`,
          message: "Summarize this dashboard",
          submit: true,
        },
      },
    },
  };
}

function renderMcpAppResourceHtml(
  resource: ActionMcpAppResourceConfig,
  context: { actionName: string; appId: string },
): string {
  return typeof resource.html === "function"
    ? resource.html(context)
    : resource.html;
}
