import { describe, expect, it } from "vitest";

import type { ActionMcpAppResourceConfig } from "../action.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { embedApp, MCP_APP_REQUEST_ORIGIN_CSP_SOURCE } from "./embed-app.js";

describe("embedApp", () => {
  it("transplants app documents in ChatGPT and Claude MCP sandboxes", () => {
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
    expect(html).toContain('return await rpcRequest("ui/message"');
    expect(html).not.toContain('rpcNotify("ui/message"');
    expect(html).toContain("window.openai");
    expect(html).toContain('"openai:set_globals"');
    expect(html).toContain("bridge.toolInput");
    expect(html).toContain("bridge.toolOutput");
    expect(html).toContain("bridge.toolResponseMetadata");
    expect(html).toContain("openAiBridge.callTool(startTool, args)");
    expect(html).toContain("openAiBridge.openExternal");
    expect(html).toContain("openAiBridge.setOpenInAppUrl");
    expect(html).toContain("openAiBridge.sendFollowUpMessage");
    expect(html).toContain("prompt: message");
    expect(html).toContain("const modelContext = {");
    expect(html).toContain("agentNativeModelContext: modelContext");
    expect(html).not.toContain('context.trim() + "\\\\n\\\\n" + message');
    expect(html).toContain(
      'const record = data && typeof data === "object" ? data : {}',
    );
    expect(html).toContain("function embedStartUrlFrom(params, data)");
    expect(html).toContain("function toolResultMeta(params)");
    expect(html).toContain("return toolResultMeta(params.result)");
    expect(html).toContain("return toolResultMeta(params.toolResult)");
    expect(html).toContain('"agent-native/embedStart"');
    expect(html).toContain("const meta = toolResultMeta(params)");
    expect(html).toContain("embedStartRecord.startUrl");
    expect(html).toContain("openStartUrl = embedStartUrlFrom(params, data)");
    expect(html).toContain(
      'if (params.isError && typeof text === "string" && text.trim())',
    );
    expect(html).toContain("return { error: text.trim() };");
    expect(html).toContain("record.embedTargetPath");
    expect(html).toContain("record.deepLinkUrl");
    expect(html.indexOf("structuredOpenLinkUrl")).toBeLessThan(
      html.indexOf("record.url"),
    );
    expect(html).toContain("let launchUrl = openStartUrl || openUrl");
    expect(html).not.toContain("launchUrl = openUrl;");
    expect(html).toContain("if (openUrl || openStartUrl)");
    expect(html).toContain("shouldSelfNavigateToApp");
    expect(html).toContain("function renderModeSource()");
    expect(html).toContain('typeof result.embedMode === "string"');
    expect(html).toContain('typeof result.frame === "string"');
    expect(html).toContain("isChatGptSandboxHost");
    expect(html).toContain("oaiusercontent");
    expect(html).toContain("(?:[^.]+\\.)?web-sandbox");
    expect(html).toContain('appParam === "chatgpt"');
    expect(html).toContain("shouldRenderControlledAppFrame");
    expect(html).toContain("} else if (shouldRenderControlledAppFrame())");
    expect(html).toContain("function isCurrentFrameUrl(src)");
    expect(html).toContain("if (isCurrentFrameUrl(src))");
    expect(html).toContain("window.location.replace(src)");
    expect(html).toContain(
      "return !!openAiBridge || !!app || isChatGptSandboxHost();",
    );
    expect(html).toContain("shouldTransplantAppDocument");
    expect(html).toContain("isClaudeMcpContentHost");
    expect(html).toContain("transplantAppDocument");
    expect(html).toContain("__agentNativeExternalEmbedRuntimeInstalled");
    expect(html).not.toContain("/_agent-native/embed/runtime.js");
    expect(html).toContain("__AGENT_NATIVE_EXTERNAL_EMBED");
    expect(html).toContain("window.history.replaceState");
    expect(html).toContain("mountTransplantedHtml");
    expect(html).toContain(
      "function importHeadChildrenWithBase(source, baseHref)",
    );
    expect(html).toContain('document.createElement("base")');
    expect(html).toContain(
      'String(node.nodeName || "").toLowerCase() === "base"',
    );
    expect(html).toContain("document.head.replaceChildren(");
    expect(html).toContain(
      "importHeadChildrenWithBase(parsed.head, config.baseHref)",
    );
    expect(html).not.toContain("document.head.prepend(base)");
    expect(html).toContain("resolveTransplantAppDocumentSource");
    expect(html).toContain('"X-Agent-Native-Embed-Transplant": "1"');
    expect(html).toContain('Accept: "application/json"');
    expect(html).toContain("const data = await response.json()");
    expect(html).toContain('typeof data.location === "string"');
    expect(html).toContain("moduleCodeToClassicAsync");
    expect(html).toContain("scriptSourceUrl");
    expect(html).toContain("moduleScriptCode");
    expect(html).toContain("relativeModuleSpecifiersToAbsolute");
    expect(html).toContain(
      String.raw`.replace(/(\bimport\s+(?:[^"']+?\s+from\s+)?)(["'])(\.\.?\/[^"']*)\2/g`,
    );
    expect(html).toContain(String.raw`/\bapplication\/json\b/i`);
    expect(html).toContain("namedImportBindings");
    expect(html).toContain("const { default:");
    expect(html).toContain("await runModuleScriptAsClassic(script, config)");
    expect(html).toContain("stripDevOnlyModuleImports");
    expect(html).toContain("__x00__virtual:react-router");
    expect(html).toContain("__vite_plugin_react_preamble_installed__");
    expect(html).toContain("$RefreshReg$");
    expect(html).toContain("$RefreshSig$");
    expect(html).toContain("rootRelativeSpecifierToAppUrl");
    expect(html).toContain("url.searchParams.set(config.embedTokenParam");
    expect(html).toContain("await import($1)");
    expect(html).toContain("claudemcpcontent");
    expect(html).toContain('mode === "transplant"');
    expect(html).toContain('render.frame === "transplant"');
    expect(html).toContain("isClaudeMcpContentHost()");
    expect(html).toContain("if (isClaudeMcpContentHost()) return true;");
    // ChatGPT is excluded from the transplant set — it uses the controlled
    // nested frame, not cross-origin import() inside its sandbox.
    expect(html).toContain(
      'isClaudeMcpContentHost() ||\n        mode === "transplant"',
    );
    expect(html).not.toContain(
      "isClaudeMcpContentHost() ||\n        isChatGptSandboxHost()",
    );
    // Standards-track MCP Apps hosts (Codex, Cursor, the SDK App fallback, and
    // our own renderer) keep the host bridge alive by rendering the real app in
    // a controlled child iframe. Transplant remains a fallback for strict
    // Claude-style hosts and explicit render-mode requests.
    expect(html).not.toContain("function isNativeMcpAppsBridgeHost()");
    expect(html).not.toContain("isNativeMcpAppsBridgeHost() ||");
    expect(html).toContain(
      'message.method === "ui/notifications/host-context-changed"',
    );
    expect(html).toContain("if (shouldTransplantAppDocument())");
    expect(html).toContain("const embedUrl = withChatBridgeParam(launchUrl)");
    expect(html).toContain("!selfNavigate && isEmbedStartUrl(embedUrl)");
    expect(html).toContain('typeof data.startUrl !== "string"');
    expect(html).toContain(
      "const startUrl = withChatBridgeParam(data.startUrl)",
    );
    expect(html).toContain("if (selfNavigate)");
    expect(html).toContain('"agentNative.submitChat"');
    expect(html).toContain('"agentNative.mcpHostContext"');
    expect(html).toContain('"agentNative.mcpHost.updateModelContext"');
    expect(html).toContain('"agentNative.mcpHost.openLink"');
    expect(html).toContain('"agentNative.mcpHost.requestDisplayMode"');
    expect(html).toContain('"agentNative.mcpHost.response"');
    expect(html).toContain('"agentNative.embedSessionExpired"');
    expect(html).toContain("refreshExpiredEmbedSession");
    expect(html).toContain("const maxEmbedSessionRefreshAttempts = 2");
    expect(html).toContain("let embedSessionRefreshAttempts = 0");
    expect(html).toContain(
      "if (embedSessionRefreshAttempts >= maxEmbedSessionRefreshAttempts)",
    );
    expect(html).toContain("embedSessionRefreshAttempts += 1");
    expect(html).toContain("embedSessionRefreshAttempts = 0");
    expect(html).toContain("let connectPromise = null;");
    expect(html).toContain("if (connectPromise) return await connectPromise;");
    expect(html).toContain("await nativeApp.connect();");
    expect(html).toContain(
      "if (response.status === 401 && isEmbedStartUrl(src))",
    );
    expect(html).toContain("await mountTransplantedHtml(html, appUrl)");
    expect(html).toContain("installExternalOpenControl(appUrl)");
    expect(html).toContain("externalOpenUrlForAppUrl");
    expect(html).toContain("agent-native-external-open-control");
    expect(html).toContain("Open in new tab");
    expect(html).toContain('openStartUrl = "";');
    expect(html).toContain("app.requestDisplayMode");
    expect(html).toContain('rpcRequest("ui/open-link"');
    expect(html).toContain("function openLinkRecordFrom(value)");
    expect(html).toContain("return withChatBridgeParam(value)");
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

  it("leaves dev runtime module URLs untokenized in transplanted app documents", () => {
    const resource = embedApp({ title: "Assets" });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "open-asset-picker", appId: "assets" })
        : resource.html;

    expect(html).toContain("function isEmbedRuntimeModulePath(pathname)");
    expect(html).toContain(
      "@(?:id|vite|fs|react-refresh)|app|node_modules|packages|src",
    );
    expect(html).toContain("function appendEmbedParamsToAppUrl(url, config)");
    expect(html).toContain(
      "if (isEmbedRuntimeModulePath(url.pathname)) return url;",
    );
    expect(html).toContain(
      "return appendEmbedParamsToAppUrl(url, config).toString();",
    );
    expect(html).toContain("appendEmbedParamsToAppUrl(url, config);");
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
    expect(html).toContain("const buttonUrl = openUrl");
    expect(html).toContain("fallbackOpen.disabled = !openUrl");
    expect(html).toContain(
      '(openUrl ? \'<a class="fallback-url" href="\' + esc(openUrl)',
    );
    expect(html).not.toContain(
      "if (!url) url = withChatBridgeParam(openStartUrl)",
    );
    expect(html).not.toContain("const buttonUrl = openUrl || openStartUrl");
    expect(html).toContain("appFrameLoadTimer");
    expect(html).toContain("startFrameReadyTimer(frame)");
    expect(html).toContain("function embedSessionArgsFor(value)");
    expect(html).toContain("? { path: value, chrome }");
    expect(html).toContain(
      "callEmbedSessionTool(embedSessionArgsFor(embedUrl))",
    );
    expect(html).toContain("function shouldDirectRenderKnownAppRoute(src)");
    expect(html).toContain("if (shouldDirectRenderKnownAppRoute(embedUrl))");
    expect(html).toContain("const embedUrl = withChatBridgeParam(launchUrl)");
    expect(html).toContain(
      'url.pathname.endsWith("/_agent-native/embed/start")',
    );
    expect(html).toContain("callEmbedSessionTool(embedSessionArgsFor(url))");
    expect(html).toContain("frameReadyMessageDelays");
    expect(html).toContain("[0, 200, 500, 1500, 3000, 7000, 15000, 30000]");
    expect(html).toContain("const frameReadyTimeoutMs = 45000");
    expect(html).toContain("const frameLoadTimeoutMs = 45000");
    expect(html).toContain("}, frameReadyTimeoutMs)");
    expect(html).toContain("}, frameLoadTimeoutMs)");
    expect(html).toContain("function notifyOuterMcpAppReady()");
    expect(html).toContain(
      'window.parent.postMessage({ type: "agentNative.embeddedAppReady" }, "*")',
    );
    expect(html).toContain('mode === "iframe" || mode === "nested"');
    expect(html).toContain('render.frame === "iframe"');
    expect(html).toContain('"agentNative.frameOrigin"');
    expect(html).toContain('"agentNative.embeddedAppReady"');
    expect(resource.csp?.connectDomains).toContain(
      "https://analytics.example.com",
    );
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

  it("waits longer for ChatGPT's bridge before falling back to the generic MCP Apps module", () => {
    const resource = embedApp({ title: "Mail" });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "manage-draft", appId: "mail" })
        : resource.html;

    expect(html).toContain("chatGptOpenAiBridgeWaitMs = 5000");
    expect(html).toContain(
      'new URLSearchParams(window.location.search).get("app") === "chatgpt"',
    );
    expect(html).toContain("web-sandbox\\.oaiusercontent\\.com");
    expect(html).toContain("openAiBridgePollMs = 50");
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
    expect(fixture.html).toContain('rpcRequest("ui/open-link"');
    expect(fixture.html).toContain("app.updateModelContext");
    expect(fixture.html).toContain("app.requestDisplayMode");
    expect(fixture.html).toContain("app.sendMessage");
    expect(fixture.html).toContain("window.openai");
    expect(fixture.html).toContain('"openai:set_globals"');
    expect(fixture.html).toContain("openAiBridge.callTool(startTool, args)");
    expect(fixture.html).toContain("openAiBridge.openExternal");
    expect(fixture.html).toContain("openAiBridge.setOpenInAppUrl");
    expect(fixture.html).toContain("openAiBridge.sendFollowUpMessage");
    expect(fixture.html).toContain("prompt: message");
    expect(fixture.html).not.toContain(
      'context.trim() + "\\\\n\\\\n" + message',
    );
    expect(fixture.html).toContain('"agentNative.frameOrigin"');
    expect(fixture.html).toContain('"agentNative.embeddedAppReady"');
    expect(fixture.html).toContain("notifyOuterMcpAppReady()");
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
    expect(fixture.html).toContain("App did not load");
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
