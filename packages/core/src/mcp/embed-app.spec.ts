import { describe, expect, it } from "vitest";
import type { ActionMcpAppResourceConfig } from "../action.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { embedApp, MCP_APP_REQUEST_ORIGIN_CSP_SOURCE } from "./embed-app.js";

describe("embedApp", () => {
  it("renders a controlled app frame for ChatGPT and direct/transplant paths for Claude", () => {
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
    expect(html).toContain("window.openai");
    expect(html).toContain('"openai:set_globals"');
    expect(html).toContain("bridge.toolInput");
    expect(html).toContain("bridge.toolOutput");
    expect(html).toContain("bridge.toolResponseMetadata");
    expect(html).toContain("openAiBridge.callTool(startTool, args)");
    expect(html).toContain("openAiBridge.openExternal");
    expect(html).toContain("openAiBridge.setOpenInAppUrl");
    expect(html).toContain("openAiBridge.sendFollowUpMessage");
    expect(html).toContain(
      'const record = data && typeof data === "object" ? data : {}',
    );
    expect(html).toContain("shouldSelfNavigateToApp");
    expect(html).toContain("isChatGptSandboxHost");
    expect(html).toContain("oaiusercontent");
    expect(html).toContain('appParam === "chatgpt"');
    expect(html).toContain("shouldRenderControlledAppFrame");
    expect(html).toContain("} else if (shouldRenderControlledAppFrame())");
    expect(html).toContain("window.location.replace(src)");
    expect(html).toContain("return !!openAiBridge || isChatGptSandboxHost();");
    expect(html).toContain("shouldTransplantAppDocument");
    expect(html).toContain("isClaudeMcpContentHost");
    expect(html).toContain("transplantAppDocument");
    expect(html).toContain("__agentNativeExternalEmbedRuntimeInstalled");
    expect(html).not.toContain("/_agent-native/embed/runtime.js");
    expect(html).toContain("__AGENT_NATIVE_EXTERNAL_EMBED");
    expect(html).toContain("window.history.replaceState");
    expect(html).toContain("mountTransplantedHtml");
    expect(html).toContain("moduleCodeToClassicAsync");
    expect(html).toContain("await import($1)");
    expect(html).toContain("claudemcpcontent");
    expect(html).toContain('mode === "transplant"');
    expect(html).toContain('toolInput.frame === "transplant"');
    expect(html).toContain("isClaudeMcpContentHost()");
    expect(html).toContain("const embedUrl = withChatBridgeParam(openUrl)");
    expect(html).toContain("!selfNavigate && isEmbedStartUrl(embedUrl)");
    expect(html).toContain('typeof data.startUrl !== "string"');
    expect(html).toContain("if (selfNavigate)");
    expect(html).toContain('"agentNative.submitChat"');
    expect(html).toContain('"agentNative.mcpHostContext"');
    expect(html).toContain('"agentNative.mcpHost.updateModelContext"');
    expect(html).toContain('"agentNative.mcpHost.openLink"');
    expect(html).toContain('"agentNative.mcpHost.requestDisplayMode"');
    expect(html).toContain('"agentNative.mcpHost.response"');
    expect(html).toContain("app.requestDisplayMode");
    expect(html).toContain('typeof openLink === "object"');
    expect(html).not.toContain("shouldDirectRenderEmbed");
    expect(html).toContain("claudemcpcontent\\.com");
    expect(html).toContain("isClaudeMcpContentHost()");
    expect(html).not.toContain("window.location.href = data.startUrl");
    expect(html).toContain("__an_mcp_chat_bridge");
    expect(html).toContain('data-app-title="Dashboard"');
    expect(html).toContain("data-title-label>Dashboard");
    expect(html).toContain('document.querySelector("[data-title-label]")');
    expect(html).not.toContain('document.querySelector("[data-title]")');
    expect(html).toContain(
      'toolInput.embed === false || toolInput.embed === "false"',
    );
    expect(html).toContain("--agent-native-shell-height: 560px");
    expect(html).toContain("--agent-native-viewport-height: 516px");
    expect(html).toContain("min-height: var(--agent-native-viewport-height)");
    expect(html).toContain("Math.min(");
    expect(html).toContain("defaultIntrinsicHeight");
    expect(html).toContain("Math.floor(nextHeight || defaultIntrinsicHeight)");
    expect(html).toContain("notifyHostHeightRepeatedly");
    expect(html).toContain("{ autoResize: false }");
    expect(html).toContain("openAiBridge.notifyIntrinsicHeight({ height })");
    expect(html).toContain("app.sendSizeChanged({ height })");
    expect(resource.csp?.frameDomains).toEqual([
      MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    ]);
    expect(resource.csp?.resourceDomains).toContain(
      MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    );
    expect(resource.csp?.resourceDomains).toContain("https://esm.sh");
    expect(resource.csp?.connectDomains).toContain(
      MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    );
    expect(resource.csp?.baseUriDomains).toEqual([
      MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    ]);
  });

  it("retains nested iframe mode as an explicit diagnostic fallback", () => {
    const resource = embedApp({
      title: "Dashboard",
      frameDomains: ["https://analytics.example.com"],
    });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "open_app", appId: "analytics" })
        : resource.html;

    expect(html).toContain('document.createElement("iframe")');
    expect(html).toContain("renderFrameFallback");
    expect(html).toContain("openFallbackExternal");
    expect(html).toContain("let url = withChatBridgeParam(openUrl)");
    expect(html).toContain("appFrameLoadTimer");
    expect(html).toContain("startFrameReadyTimer(frame)");
    expect(html).toContain("function embedSessionArgsFor(value)");
    expect(html).toContain("? { path: value, chrome }");
    expect(html).toContain(
      "callEmbedSessionTool(embedSessionArgsFor(embedUrl))",
    );
    expect(html).toContain("callEmbedSessionTool(embedSessionArgsFor(url))");
    expect(html).toContain("frameReadyMessageDelays");
    expect(html).toContain("[0, 200, 500, 1500, 3000, 7000, 15000, 30000]");
    expect(html).toContain("const frameReadyTimeoutMs = 45000");
    expect(html).toContain("const frameLoadTimeoutMs = 45000");
    expect(html).toContain("}, frameReadyTimeoutMs)");
    expect(html).toContain("}, frameLoadTimeoutMs)");
    expect(html).toContain('mode === "iframe" || mode === "nested"');
    expect(html).toContain('toolInput.frame === "iframe"');
    expect(html).toContain('"agentNative.frameOrigin"');
    expect(html).toContain('"agentNative.embeddedAppReady"');
    expect(resource.csp?.frameDomains).toEqual([
      MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
      "https://analytics.example.com",
    ]);
  });

  it("checks for ChatGPT's window.openai bridge before loading the standard bridge module", () => {
    const resource = embedApp({ title: "Mail" });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "manage-draft", appId: "mail" })
        : resource.html;

    const openAiIndex = html.indexOf("window.openai");
    const dynamicImportIndex = html.indexOf(
      'await import("https://esm.sh/@modelcontextprotocol',
    );

    expect(openAiIndex).toBeGreaterThanOrEqual(0);
    expect(dynamicImportIndex).toBeGreaterThan(openAiIndex);
    expect(html).not.toContain('import { App } from "https://esm.sh');
  });

  it("allows full-app embeds to request a 900px canvas", () => {
    const resource = embedApp({ height: 900 });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "open_app", appId: "analytics" })
        : resource.html;

    expect(html).toContain("--agent-native-shell-height: 900px");
    expect(html).toContain("--agent-native-viewport-height: 856px");
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
              resourceDomains: [
                "https://esm.sh",
                MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
              ],
              connectDomains: [
                "https://esm.sh",
                MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
              ],
              baseUriDomains: [MCP_APP_REQUEST_ORIGIN_CSP_SOURCE],
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
    expect(fixture.html).toContain("window.openai");
    expect(fixture.html).toContain('"openai:set_globals"');
    expect(fixture.html).toContain("openAiBridge.callTool(startTool, args)");
    expect(fixture.html).toContain("openAiBridge.openExternal");
    expect(fixture.html).toContain("openAiBridge.setOpenInAppUrl");
    expect(fixture.html).toContain("openAiBridge.sendFollowUpMessage");
    expect(fixture.html).toContain('"agentNative.frameOrigin"');
    expect(fixture.html).toContain('"agentNative.embeddedAppReady"');
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
    expect(fixture.html).toContain("Open this app in its own tab");
    expect(fixture.html).toContain("use the URL below");
    expect(fixture.html).toContain("name: startTool");
    expect(fixture.html).toContain("arguments: args");
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
