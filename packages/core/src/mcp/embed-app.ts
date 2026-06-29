import type { ActionMcpAppResourceConfig } from "../action.js";
import { MCP_APP_CHAT_BRIDGE_QUERY_PARAM } from "../shared/embed-auth.js";

const MCP_APP_IMPORT =
  "https://esm.sh/@modelcontextprotocol/ext-apps@1.7.2/app-with-deps";

export const MCP_APP_REQUEST_ORIGIN_CSP_SOURCE = "$requestOrigin";
const MCP_APP_WRAPPER_CHROME_HEIGHT = 44;
export const DEFAULT_MCP_APP_SHELL_HEIGHT = 560;
export const DEFAULT_MCP_APP_VIEWPORT_HEIGHT =
  DEFAULT_MCP_APP_SHELL_HEIGHT - MCP_APP_WRAPPER_CHROME_HEIGHT;

export interface EmbedAppOptions {
  title?: string;
  description?: string;
  iframeTitle?: string;
  openLabel?: string;
  embedByDefault?: boolean;
  startToolName?: string;
  connectDomains?: string[];
  resourceDomains?: string[];
  baseUriDomains?: string[];
  frameDomains?: string[];
  height?: number;
}

function attr(value: string | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function embedApp(
  options: EmbedAppOptions = {},
): ActionMcpAppResourceConfig {
  const title = options.title ?? "Open app";
  const iframeTitle = options.iframeTitle ?? "Agent Native app";
  const openLabel = options.openLabel ?? "Open in app";
  const startToolName = options.startToolName ?? "create_embed_session";
  const embedByDefault = options.embedByDefault !== false;
  const height = Math.max(
    320,
    Math.min(900, options.height ?? DEFAULT_MCP_APP_SHELL_HEIGHT),
  );
  const viewportHeight = height - MCP_APP_WRAPPER_CHROME_HEIGHT;
  const frameDomains = [
    MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    ...(options.frameDomains ?? []),
  ];

  return {
    title,
    ...(options.description ? { description: options.description } : {}),
    html: () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; --agent-native-shell-height: ${height}px; --agent-native-viewport-height: ${viewportHeight}px; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .shell { display: grid; gap: 8px; min-height: var(--agent-native-shell-height); padding: 0; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
    .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; color: color-mix(in srgb, CanvasText 72%, Canvas); }
    .actions { display: flex; align-items: center; gap: 6px; }
    button { min-height: 28px; border: 1px solid color-mix(in srgb, CanvasText 14%, Canvas); border-radius: 7px; background: Canvas; color: CanvasText; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; padding: 0 9px; }
    button.primary { min-height: 32px; padding: 0 14px; background: CanvasText; color: Canvas; border-color: CanvasText; }
    button.primary:hover:not(:disabled) { background: color-mix(in srgb, CanvasText 86%, Canvas); }
    button:disabled { opacity: .55; cursor: default; }
    .stage { position: relative; min-height: var(--agent-native-viewport-height); }
    iframe { display: block; width: 100%; height: var(--agent-native-viewport-height); border: 0; background: Canvas; }
    .message { display: grid; place-items: center; min-height: var(--agent-native-viewport-height); padding: 18px; color: color-mix(in srgb, CanvasText 62%, Canvas); font-size: 13px; line-height: 1.45; text-align: center; }
    .fallback { display: grid; align-content: center; justify-items: center; gap: 12px; min-height: var(--agent-native-viewport-height); padding: 24px; background: Canvas; color: CanvasText; text-align: center; }
    .fallback-title { max-width: 440px; font-size: 14px; font-weight: 700; }
    .fallback-copy { max-width: 520px; color: color-mix(in srgb, CanvasText 64%, Canvas); font-size: 13px; line-height: 1.45; }
    .fallback-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; }
    .fallback-url { max-width: min(560px, 100%); overflow-wrap: anywhere; color: color-mix(in srgb, CanvasText 76%, Canvas); font-size: 12px; }
  </style>
</head>
<body
  data-app-title="${attr(title)}"
  data-iframe-title="${attr(iframeTitle)}"
  data-open-label="${attr(openLabel)}"
  data-start-tool="${attr(startToolName)}"
  data-embed-default="${embedByDefault ? "1" : "0"}"
>
  <main class="shell">
    <div class="bar">
      <div class="title" data-title-label>${attr(title)}</div>
      <div class="actions">
        <button type="button" data-display hidden disabled>Fullscreen</button>
        <button type="button" data-open disabled>${attr(openLabel)}</button>
      </div>
    </div>
    <section class="stage" data-stage>
      <div class="message">Preparing app</div>
    </section>
  </main>
  <script>
    (async () => {
    const body = document.body;
    const stage = document.querySelector("[data-stage]");
    const titleEl = document.querySelector("[data-title-label]");
    const openButton = document.querySelector("[data-open]");
    const displayButton = document.querySelector("[data-display]");
    const startTool = body.dataset.startTool || "create_embed_session";
    const embedByDefault = body.dataset.embedDefault !== "0";
    const chatBridgeParam = ${JSON.stringify(MCP_APP_CHAT_BRIDGE_QUERY_PARAM)};
    const defaultIntrinsicHeight = ${height};
    const chromeHeight = ${MCP_APP_WRAPPER_CHROME_HEIGHT};
    const frameReadyMessageDelays = [0, 200, 500, 1500, 3000, 7000, 15000, 30000];
    const frameReadyTimeoutMs = 45000;
    const frameLoadTimeoutMs = 45000;
    const maxEmbedSessionRefreshAttempts = 2;
    const defaultOpenAiBridgeWaitMs = 200;
    const chatGptOpenAiBridgeWaitMs = 5000;
    const openAiBridgePollMs = 50;
    const nativeBridgeInitializeTimeoutMs = 5000;
    const nativeBridgeRequestTimeoutMs = 30000;
    const wrapperRequestTimeoutMs = 5000;
    let app = null;
    let appConnectPromise = null;
    let openAiBridge = null;
    let wrapperRequestId = 0;
    const wrapperRequests = new Map();
    let toolInput = {};
    let toolResultData = {};
    let openUrl = "";
    let openStartUrl = "";
    let startedFor = "";
    let appFrame = null;
    let appFrameReady = false;
    let appFrameReadyTimer = null;
    let appFrameLoadTimer = null;
    let lastFrameSrc = "";
    let embedSessionRefreshAttempts = 0;

    function esc(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function parseJson(value, fallback) {
      if (value && typeof value === "object") return value;
      if (typeof value !== "string" || !value.trim()) return fallback;
      try { return JSON.parse(value); } catch { return fallback; }
    }

    function objectValue(value) {
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    }

    function finiteNumber(value) {
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : null;
    }

    function contextMaxHeight(context) {
      if (!context || typeof context !== "object") return null;
      return finiteNumber(context.maxHeight) ||
        finiteNumber(context.containerDimensions && context.containerDimensions.maxHeight);
    }

    function visibleIntrinsicHeight() {
      const context = hostState().context || {};
      const hostMaxHeight = contextMaxHeight(context);
      if (hostMaxHeight) return Math.floor(hostMaxHeight);
      const viewportHeight = finiteNumber(window.visualViewport && window.visualViewport.height) ||
        finiteNumber(window.innerHeight);
      return Math.floor(viewportHeight || defaultIntrinsicHeight);
    }

    function applyIntrinsicHeight(nextHeight) {
      const boundedHeight = Math.min(
        defaultIntrinsicHeight,
        Math.floor(nextHeight || defaultIntrinsicHeight)
      );
      const height = Math.max(320, boundedHeight);
      const viewportHeight = Math.max(0, height - chromeHeight);
      document.documentElement.style.setProperty("--agent-native-shell-height", height + "px");
      document.documentElement.style.setProperty("--agent-native-viewport-height", viewportHeight + "px");
      if (appFrame) appFrame.style.height = viewportHeight + "px";
      return height;
    }

    function parseToolResult(params) {
      if (!params) return {};
      if (params.result && typeof params.result === "object") {
        return parseToolResult(params.result);
      }
      if (params.toolResult && typeof params.toolResult === "object") {
        return parseToolResult(params.toolResult);
      }
      if (params.structuredContent && typeof params.structuredContent === "object") {
        return params.structuredContent;
      }
      const parts = Array.isArray(params.content) ? params.content : [];
      const textPart = parts.find((part) => part && part.type === "text" && typeof part.text === "string");
      const text = textPart ? textPart.text : "";
      if (params.isError && typeof text === "string" && text.trim()) {
        return { error: text.trim() };
      }
      return parseJson(text, {});
    }

    function metadataRecord(value) {
      const meta = value && typeof value === "object" && !Array.isArray(value)
        ? value._meta
        : null;
      return meta && typeof meta === "object" && !Array.isArray(meta)
        ? meta
        : null;
    }

    function toolResultMeta(params) {
      if (!params || typeof params !== "object") return {};
      const direct = metadataRecord(params);
      if (direct) return direct;
      if (params.result && typeof params.result === "object") {
        return toolResultMeta(params.result);
      }
      if (params.toolResult && typeof params.toolResult === "object") {
        return toolResultMeta(params.toolResult);
      }
      return {};
    }

    function openLinkRecordFrom(value) {
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    }

    function openLinkWebUrlFrom(value) {
      const record = openLinkRecordFrom(value);
      return typeof record.webUrl === "string" ? record.webUrl : "";
    }

    function firstNonEmbedStartUrl(values) {
      for (const value of values) {
        if (typeof value === "string" && value && !isEmbedStartUrl(value)) return value;
      }
      return "";
    }

    function firstEmbedStartUrl(values) {
      for (const value of values) {
        if (typeof value === "string" && value && isEmbedStartUrl(value)) {
          return withChatBridgeParam(value);
        }
      }
      return "";
    }

    function openLinkFrom(params, data) {
      const meta = toolResultMeta(params);
      const openLink = meta["agent-native/openLink"];
      const metaUrl = openLinkWebUrlFrom(openLink);
      const record = data && typeof data === "object" ? data : {};
      const structuredOpenLinkUrl = openLinkWebUrlFrom(record.openLink);
      return firstNonEmbedStartUrl([
        record.embedTargetPath,
        record.deepLinkUrl,
        record.deepLink,
        record.openUrl,
        structuredOpenLinkUrl,
        metaUrl,
        record.url
      ]);
    }

    function embedStartUrlFrom(params, data) {
      const meta = toolResultMeta(params);
      const embedStart = meta["agent-native/embedStart"];
      const embedStartRecord =
        embedStart && typeof embedStart === "object" && !Array.isArray(embedStart)
          ? embedStart
          : {};
      const openLink = meta["agent-native/openLink"];
      const metaUrl = openLinkWebUrlFrom(openLink);
      const record = data && typeof data === "object" ? data : {};
      return firstEmbedStartUrl([
        embedStartRecord.startUrl,
        record.embedStartUrl,
        record.startUrl,
        record.url,
        openLinkWebUrlFrom(record.openLink),
        metaUrl
      ]);
    }

    function hostState() {
      if (openAiBridge) {
        return {
          context: {
            displayMode: openAiBridge.displayMode,
            availableDisplayModes: typeof openAiBridge.requestDisplayMode === "function"
              ? ["inline", "fullscreen", "pip"]
              : [],
            maxHeight: openAiBridge.maxHeight,
            locale: openAiBridge.locale,
            theme: openAiBridge.theme,
            view: openAiBridge.view
          },
          capabilities: { openai: true },
          version: openAiBridge.userAgent
        };
      }
      return {
        context: app && app.getHostContext ? app.getHostContext() : undefined,
        capabilities: app && app.getHostCapabilities ? app.getHostCapabilities() : undefined,
        version: app && app.getHostVersion ? app.getHostVersion() : undefined
      };
    }

    function sendToAppFrame(message) {
      if (!appFrame || !appFrame.contentWindow) return;
      try { appFrame.contentWindow.postMessage(message, "*"); } catch {}
    }

    function notifyOuterMcpAppReady() {
      try {
        window.parent.postMessage({ type: "agentNative.embeddedAppReady" }, "*");
      } catch {}
    }

    function nextWrapperRequestId() {
      wrapperRequestId += 1;
      return "mcp-wrapper-" + Date.now() + "-" + wrapperRequestId;
    }

    function respondToWrapperRequest(requestId, result) {
      if (!requestId) return;
      sendToAppFrame({
        type: "agentNative.mcpHost.response",
        data: {
          requestId,
          ok: !!(result && result.ok),
          result: result || {}
        }
      });
    }

    function wrapperRpcRequest(method, params, timeoutMs) {
      return new Promise((resolve) => {
        const id = nextWrapperRequestId();
        const timer = window.setTimeout(() => {
          wrapperRequests.delete(id);
          resolve({ ok: false, error: "MCP host bridge request timed out." });
        }, timeoutMs || wrapperRequestTimeoutMs);
        wrapperRequests.set(id, { resolve, timer });
        try {
          window.parent.postMessage(
            { jsonrpc: "2.0", id, method, params: params || {} },
            "*"
          );
        } catch (err) {
          wrapperRequests.delete(id);
          clearTimeout(timer);
          resolve({ ok: false, error: err && err.message ? err.message : String(err) });
        }
      });
    }

    function settleWrapperRpcResponse(message) {
      const id = typeof (message && message.id) === "string" ? message.id : "";
      if (!id) return false;
      const pending = wrapperRequests.get(id);
      if (!pending) return false;
      wrapperRequests.delete(id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.resolve({ ok: false, error: message.error });
      } else {
        pending.resolve({ ok: true, result: message.result });
      }
      return true;
    }

    function sendHostContext() {
      sendToAppFrame({ type: "agentNative.mcpHostContext", data: hostState() });
    }

    function sendFrameReadyMessages(frame) {
      const originPayload = { type: "agentNative.frameOrigin", origin: window.location.origin };
      frameReadyMessageDelays.forEach((delay) => {
        setTimeout(() => {
          try { frame.contentWindow && frame.contentWindow.postMessage(originPayload, "*"); } catch {}
          sendHostContext();
        }, delay);
      });
    }

    function withChatBridgeParam(value) {
      if (typeof value !== "string" || !value) return value;
      try {
        const base = "http://agent-native.invalid";
        const url = value.startsWith("/") ? new URL(value, base) : new URL(value);
        url.searchParams.set(chatBridgeParam, "1");
        return value.startsWith("/")
          ? url.pathname + url.search + url.hash
          : url.toString();
      } catch {
        return value;
      }
    }

    function embedSessionArgsFor(value) {
      const chrome = typeof toolInput.chrome === "string" ? toolInput.chrome : "full";
      return typeof value === "string" && value.startsWith("/")
        ? { path: value, chrome }
        : { url: value, chrome };
    }

    function isEmbedStartUrl(value) {
      if (typeof value !== "string" || !value) return false;
      try {
        const url = new URL(value, window.location.href);
        return url.pathname.endsWith("/_agent-native/embed/start");
      } catch {
        return false;
      }
    }

    function localPathFromUrl(url, includeToken) {
      const next = new URL(url.href);
      if (!includeToken) next.searchParams.delete("__an_embed_token");
      return next.pathname + next.search + next.hash;
    }

    function rewriteRootRelativeHtmlUrls(html, appOrigin) {
      return String(html).replace(
        /\\b(src|href|poster|action)\\s*=\\s*(["'])\\/(?!\\/)/gi,
        (_match, name, quote) => String(name) + "=" + quote + appOrigin + "/"
      );
    }

    function removeHtmlCspMeta(html) {
      return String(html).replace(
        /<meta\\s+[^>]*http-equiv\\s*=\\s*(["'])?content-security-policy\\1?[^>]*>/gi,
        ""
      );
    }

    function embedConfigForAppUrl(appUrl) {
      const sanitizedTarget = localPathFromUrl(appUrl, false);
      return {
        origin: appUrl.origin,
        href: appUrl.href,
        baseHref: appUrl.origin + appUrl.pathname,
        target: sanitizedTarget,
        token: appUrl.searchParams.get("__an_embed_token") || "",
        chatBridgeActive: appUrl.searchParams.get(chatBridgeParam) === "1",
        chatBridgeParam,
        embedTokenParam: "__an_embed_token",
        embedTargetHeader: "x-agent-native-embed-target"
      };
    }

    function externalOpenUrlForAppUrl(appUrl) {
      if (openUrl) return openUrl;
      try {
        const url = new URL(appUrl.href);
        url.searchParams.delete("embedded");
        url.searchParams.delete("__an_embed_token");
        url.searchParams.delete(chatBridgeParam);
        return url.toString();
      } catch (_err) {
        return "";
      }
    }

    function installExternalOpenControl(appUrl) {
      const href = externalOpenUrlForAppUrl(appUrl);
      if (!href || !document.body || document.getElementById("agent-native-external-open-control")) {
        return;
      }
      const host = document.createElement("div");
      host.id = "agent-native-external-open-control";
      host.style.position = "fixed";
      host.style.top = "10px";
      host.style.right = "10px";
      host.style.zIndex = "2147483647";
      host.style.pointerEvents = "auto";
      const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      root.innerHTML =
        '<style>' +
          ':host{all:initial;}' +
          'button{box-sizing:border-box;min-height:30px;border:1px solid color-mix(in srgb, CanvasText 18%, Canvas);border-radius:7px;background:Canvas;color:CanvasText;box-shadow:0 6px 22px color-mix(in srgb, CanvasText 14%, transparent);cursor:pointer;font:700 12px ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:0 10px;white-space:nowrap;}' +
          'button:hover{background:color-mix(in srgb, CanvasText 6%, Canvas);}' +
        '</style>' +
        '<button type="button">Open in new tab</button>';
      const button = root.querySelector("button");
      if (button) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          void openHostLink({ url: href });
        });
      }
      document.body.appendChild(host);
    }

    function installReactRefreshPreambleFallback() {
      window.__vite_plugin_react_preamble_installed__ = true;
      if (typeof window.$RefreshReg$ !== "function") {
        window.$RefreshReg$ = function() {};
      }
      if (typeof window.$RefreshSig$ !== "function") {
        window.$RefreshSig$ = function() {
          return function(type) {
            return type;
          };
        };
      }
    }

    function installExternalEmbedRuntime(config) {
      window.__AGENT_NATIVE_EXTERNAL_EMBED = config;
      installReactRefreshPreambleFallback();
      try {
        if (config.target) {
          window.history.replaceState(window.history.state, "", config.target);
        }
      } catch (_err) {}
      try {
        if (config.token) {
          sessionStorage.setItem("agent-native:embed-auth-token", config.token);
        }
        if (config.chatBridgeActive && config.token) {
          sessionStorage.setItem("agent-native:mcp-chat-bridge", config.token);
        }
      } catch (_err) {}
      if (window.__agentNativeExternalEmbedRuntimeInstalled) return;
      window.__agentNativeExternalEmbedRuntimeInstalled = true;
      function appOrigin() {
        try {
          return new URL(config.origin).origin;
        } catch (_err) {
          return "";
        }
      }
      function targetPath() {
        return config.target || location.pathname + location.search;
      }
      function rewrittenUrl(value, appendToken) {
        const origin = appOrigin();
        if (!origin) return null;
        let url;
        try {
          url = new URL(value, location.href);
        } catch (_err) {
          return null;
        }
        if (url.origin !== location.origin && url.origin !== origin) return null;
        if (url.origin !== origin) {
          const app = new URL(origin);
          url.protocol = app.protocol;
          url.host = app.host;
        }
        if (appendToken && config.token && url.pathname === "/_agent-native/events") {
          url.searchParams.set(config.embedTokenParam, config.token);
        }
        return url.toString();
      }
      function authHeaders(input, init) {
        const headers = new Headers(
          init && init.headers ? init.headers : input instanceof Request ? input.headers : undefined
        );
        if (config.token && !headers.has("Authorization")) {
          headers.set("Authorization", "Bearer " + config.token);
        }
        if (!headers.has(config.embedTargetHeader)) {
          headers.set(config.embedTargetHeader, targetPath());
        }
        return headers;
      }
      if (typeof fetch === "function") {
        const originalFetch = fetch.bind(window);
        window.fetch = function(input, init) {
          const raw = input instanceof Request ? input.url : String(input);
          const url = rewrittenUrl(raw, false);
          if (!url) return originalFetch(input, init);
          const nextInit = Object.assign({}, init || {}, {
            headers: authHeaders(input, init),
            credentials: "omit"
          });
          if (input instanceof Request) {
            return originalFetch(new Request(url, input), nextInit);
          }
          return originalFetch(url, nextInit);
        };
      }
      if (typeof XMLHttpRequest !== "undefined") {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
          const rewritten = rewrittenUrl(url, false);
          this.__agentNativeExternalEmbed = !!rewritten;
          return originalOpen.call(
            this,
            method,
            rewritten || url,
            arguments.length > 2 ? arguments[2] : true,
            arguments[3],
            arguments[4]
          );
        };
        XMLHttpRequest.prototype.send = function(body) {
          if (this.__agentNativeExternalEmbed) {
            try {
              if (config.token) this.setRequestHeader("Authorization", "Bearer " + config.token);
              this.setRequestHeader(config.embedTargetHeader, targetPath());
            } catch (_err) {}
          }
          return originalSend.call(this, body);
        };
      }
      if (typeof EventSource !== "undefined") {
        const OriginalEventSource = EventSource;
        window.EventSource = function(url, options) {
          return new OriginalEventSource(rewrittenUrl(url, true) || url, options);
        };
        window.EventSource.prototype = OriginalEventSource.prototype;
      }
    }

    function copyDocumentElementAttributes(source) {
      const target = document.documentElement;
      for (const attr of Array.from(target.attributes)) {
        target.removeAttribute(attr.name);
      }
      for (const attr of Array.from(source.attributes)) {
        target.setAttribute(attr.name, attr.value);
      }
    }

    function importChildren(source, target) {
      target.replaceChildren(
        ...Array.from(source.childNodes).map((node) => document.importNode(node, true))
      );
    }

    function importHeadChildrenWithBase(source, baseHref) {
      const base = document.createElement("base");
      base.href = baseHref;
      const nodes = Array.from(source.childNodes).filter((node) => {
        return !(
          node.nodeType === 1 &&
          String(node.nodeName || "").toLowerCase() === "base"
        );
      });
      document.head.replaceChildren(
        base,
        ...nodes.map((node) => document.importNode(node, true))
      );
    }

    function isModuleScript(script) {
      return (script.getAttribute("type") || "").trim().toLowerCase() === "module";
    }

    function isRunnableClassicScript(script) {
      const type = (script.getAttribute("type") || "").trim().toLowerCase();
      return !type || type === "text/javascript" || type === "application/javascript";
    }

    function runClassicScript(script) {
      const next = document.createElement("script");
      for (const attr of Array.from(script.attributes)) {
        if (attr.name === "type") continue;
        next.setAttribute(attr.name, attr.value);
      }
      if (script.src) {
        next.src = script.src;
      } else {
        next.textContent = script.textContent || "";
      }
      document.body.appendChild(next);
      next.remove();
    }

    function isEmbedRuntimeModulePath(pathname) {
      if (typeof pathname !== "string" || !pathname) return false;
      return /(?:^|\\/)(?:@(?:id|vite|fs|react-refresh)|app|node_modules|packages|src)(?:\\/|$)/.test(pathname) ||
        /(?:^|\\/)__x00__virtual:/.test(pathname) ||
        pathname.includes("virtual:react-router");
    }

    function appendEmbedParamsToAppUrl(url, config) {
      if (isEmbedRuntimeModulePath(url.pathname)) return url;
      if (config.token) url.searchParams.set(config.embedTokenParam, config.token);
      if (config.chatBridgeActive) url.searchParams.set(config.chatBridgeParam, "1");
      return url;
    }

    function rootRelativeSpecifierToAppUrl(specifier, config) {
      if (typeof specifier !== "string" || !specifier.startsWith("/") || specifier.startsWith("//")) {
        return specifier;
      }
      try {
        const url = new URL(specifier, config.origin);
        return appendEmbedParamsToAppUrl(url, config).toString();
      } catch (_err) {
        return specifier;
      }
    }

    function rootRelativeSpecifiersToAbsolute(code, config) {
      return String(code).replace(/(["'])\\/(?!\\/)([^"']*)/g, (_match, quote, rest) => {
        return quote + rootRelativeSpecifierToAppUrl("/" + rest, config);
      });
    }

    function relativeSpecifierToAppUrl(specifier, config, baseUrl) {
      if (typeof specifier !== "string" || !/^\\.\\.?\\//.test(specifier)) {
        return specifier;
      }
      try {
        const url = new URL(specifier, baseUrl || config.baseHref);
        if (url.origin === config.origin) {
          appendEmbedParamsToAppUrl(url, config);
        }
        return url.toString();
      } catch (_err) {
        return specifier;
      }
    }

    function relativeModuleSpecifiersToAbsolute(code, config, baseUrl) {
      return String(code)
        .replace(/(\\bimport\\s+(?:[^"']+?\\s+from\\s+)?)(["'])(\\.\\.?\\/[^"']*)\\2/g, (_match, prefix, quote, specifier) => {
          return prefix + quote + relativeSpecifierToAppUrl(specifier, config, baseUrl) + quote;
        })
        .replace(/(\\bimport\\s*\\(\\s*)(["'])(\\.\\.?\\/[^"']*)\\2/g, (_match, prefix, quote, specifier) => {
          return prefix + quote + relativeSpecifierToAppUrl(specifier, config, baseUrl) + quote;
        })
        .replace(/(\\bexport\\s+[^"']*?\\s+from\\s+)(["'])(\\.\\.?\\/[^"']*)\\2/g, (_match, prefix, quote, specifier) => {
          return prefix + quote + relativeSpecifierToAppUrl(specifier, config, baseUrl) + quote;
        });
    }

    function stripDevOnlyModuleImports(code) {
      return String(code).replace(
        /\\bimport\\s+(?:[^"']+\\s+from\\s+)?["'][^"']*(?:virtual:react-router\\/inject-hmr-runtime|__x00__virtual:react-router\\/inject-hmr-runtime)[^"']*["']\\s*;?/g,
        ""
      );
    }

    function namedImportBindings(specifierList) {
      return String(specifierList)
        .split(",")
        .map((part) => {
          const trimmed = part.trim();
          if (!trimmed) return "";
          return trimmed.replace(
            /^([A-Za-z_$][\\w$]*)\\s+as\\s+([A-Za-z_$][\\w$]*)$/,
            "$1: $2"
          );
        })
        .filter(Boolean)
        .join(", ");
    }

    function moduleCodeToClassicAsync(code, config, baseUrl) {
      return relativeModuleSpecifiersToAbsolute(
        rootRelativeSpecifiersToAbsolute(stripDevOnlyModuleImports(code), config),
        config,
        baseUrl
      )
        .replace(
          /\\bimport\\s+([A-Za-z_$][\\w$]*)\\s*,\\s*\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+(["'][^"']+["'])\\s*;?/g,
          "const $2 = await import($3); const $1 = $2.default;"
        )
        .replace(
          /\\bimport\\s+([A-Za-z_$][\\w$]*)\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*from\\s+(["'][^"']+["'])\\s*;?/g,
          (_match, defaultName, specifiers, source) =>
            "const { default: " +
            defaultName +
            (namedImportBindings(specifiers) ? ", " + namedImportBindings(specifiers) : "") +
            " } = await import(" +
            source +
            ");"
        )
        .replace(
          /\\bimport\\s+\\{([\\s\\S]*?)\\}\\s*from\\s+(["'][^"']+["'])\\s*;?/g,
          (_match, specifiers, source) =>
            "const { " + namedImportBindings(specifiers) + " } = await import(" + source + ");"
        )
        .replace(
          /\\bimport\\s+\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+(["'][^"']+["'])\\s*;?/g,
          "const $1 = await import($2);"
        )
        .replace(
          /\\bimport\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+(["'][^"']+["'])\\s*;?/g,
          "const { default: $1 } = await import($2);"
        )
        .replace(/\\bimport\\s+(["'][^"']+["'])\\s*;?/g, "await import($1);")
        .replace(/\\bimport\\((["'][^"']+["'])\\)\\s*;?/g, "await import($1);");
    }

    function scriptSourceUrl(script, config) {
      const raw = script.getAttribute("src") || "";
      if (!raw) return "";
      try {
        const url = new URL(raw, config.baseHref);
        if (url.origin === config.origin) {
          appendEmbedParamsToAppUrl(url, config);
        }
        return url.toString();
      } catch (_err) {
        return raw;
      }
    }

    async function moduleScriptCode(script, config) {
      const src = scriptSourceUrl(script, config);
      if (!src) return script.textContent || "";
      const response = await fetch(src, {
        credentials: "omit",
        headers: { Accept: "text/javascript, application/javascript, */*" }
      });
      if (!response.ok) {
        throw new Error("Module script returned HTTP " + response.status + ".");
      }
      return await response.text();
    }

    async function runModuleScriptAsClassic(script, config) {
      const sourceUrl = scriptSourceUrl(script, config) || config.baseHref;
      const code = moduleCodeToClassicAsync(
        await moduleScriptCode(script, config),
        config,
        sourceUrl
      );
      const runner = document.createElement("script");
      runner.textContent =
        "(async()=>{" +
        code +
        "})().catch((err)=>{console.error('[agent-native] transplanted app module failed',err);document.body.setAttribute('data-agent-native-hydration-error',String(err&&err.message||err));});";
      document.body.appendChild(runner);
      runner.remove();
    }

    async function mountTransplantedHtml(html, appUrl) {
      const config = embedConfigForAppUrl(appUrl);
      installExternalEmbedRuntime(config);
      const parsed = new DOMParser().parseFromString(
        rewriteRootRelativeHtmlUrls(removeHtmlCspMeta(html), appUrl.origin),
        "text/html"
      );
      const scripts = Array.from(parsed.querySelectorAll("script"));
      copyDocumentElementAttributes(parsed.documentElement);
      importHeadChildrenWithBase(parsed.head, config.baseHref);
      importChildren(parsed.body, document.body);
      installExternalOpenControl(appUrl);
      for (const script of scripts) {
        if (isRunnableClassicScript(script)) runClassicScript(script);
      }
      for (const script of scripts) {
        if (isModuleScript(script)) await runModuleScriptAsClassic(script, config);
      }
    }

    function absoluteUrl(value, base) {
      try {
        return new URL(value, base).toString();
      } catch {
        return "";
      }
    }

    async function resolveTransplantAppDocumentSource(src) {
      if (!isEmbedStartUrl(src)) {
        return { url: new URL(src), response: null };
      }
      const response = await fetch(src, {
        credentials: "omit",
        redirect: "follow",
        headers: {
          Accept: "application/json",
          "X-Agent-Native-Embed-Transplant": "1"
        }
      });
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && /\\bapplication\\/json\\b/i.test(contentType)) {
        const data = await response.json();
        const location = typeof data.location === "string" ? data.location : "";
        const url = absoluteUrl(location, src);
        if (url) return { url: new URL(withChatBridgeParam(url)), response: null };
        throw new Error("Embedded app did not return a launch URL.");
      }
      return {
        url: new URL(response.url || src),
        response
      };
    }

    async function transplantAppDocument(src) {
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      appFrame = null;
      lastFrameSrc = src;
      setMessage("Loading app");
      const source = await resolveTransplantAppDocumentSource(src);
      const response = source.response || await fetch(source.url.href, {
        credentials: "omit",
        redirect: "follow",
        headers: { Accept: "text/html" }
      });
      if (!response.ok) {
        if (response.status === 401 && isEmbedStartUrl(src)) {
          reportEmbedError(
            "transplant-auth",
            "Embedded app session expired (HTTP 401).",
            "Opaque-origin sandbox could not authenticate the embed.",
            401
          );
          refreshExpiredEmbedSession();
          return;
        }
        reportEmbedError(
          "transplant-http",
          "Embedded app returned HTTP " + response.status + ".",
          undefined,
          response.status
        );
        throw new Error("Embedded app returned HTTP " + response.status + ".");
      }
      const html = await response.text();
      // Use the FINAL URL the fetch landed on after following redirects, NOT
      // the pre-redirect embed-start location. The embed ticket's targetPath is
      // /_agent-native/open?...&to=/plans/<id>, which 302-redirects to the real
      // app route; we render that route's HTML. If we replaceState to the
      // pre-redirect /_agent-native/open (a server-only framework route), the
      // hydrated React Router has no matching client route and throws a 404
      // ("No route matches URL /_agent-native/open"). response.url is the
      // resolved app route (/plans/<id>) the router can actually match.
      const appUrl = new URL(
        response.url || (source.url ? source.url.href : src),
      );
      try {
        window.history.replaceState(window.history.state, "", localPathFromUrl(appUrl, false));
      } catch {}
      await mountTransplantedHtml(html, appUrl);
      embedSessionRefreshAttempts = 0;
      notifyHostHeightRepeatedly();
    }

    function wantsEmbed() {
      if (toolInput.embed === false || toolInput.embed === "false") return false;
      if (embedByDefault) return true;
      return toolInput.embed === true || toolInput.embed === "true";
    }

    function renderModeSource() {
      const input = objectValue(toolInput);
      const result = objectValue(toolResultData);
      return {
        mode: typeof input.embedMode === "string"
          ? input.embedMode
          : typeof input.renderMode === "string"
            ? input.renderMode
            : typeof result.embedMode === "string"
              ? result.embedMode
              : typeof result.renderMode === "string"
                ? result.renderMode
                : "",
        frame: typeof input.frame === "string"
          ? input.frame
          : typeof result.frame === "string"
            ? result.frame
            : "",
        nested: input.nested === true || result.nested === true
      };
    }

    function supportedDisplayMode(mode) {
      if (openAiBridge && typeof openAiBridge.requestDisplayMode === "function") {
        return mode === "inline" || mode === "fullscreen" || mode === "pip";
      }
      const modes = hostState().context && hostState().context.availableDisplayModes;
      return Array.isArray(modes) && modes.includes(mode);
    }

    async function requestHostDisplayMode(mode) {
      let result;
      if (openAiBridge && typeof openAiBridge.requestDisplayMode === "function") {
        result = await openAiBridge.requestDisplayMode({ mode });
      } else {
        if (!app || typeof app.requestDisplayMode !== "function") {
          throw new Error("Display mode changes are not available in this host.");
        }
        result = await app.requestDisplayMode({ mode });
      }
      updateDisplayButton();
      sendHostContext();
      return result;
    }

    function updateDisplayButton() {
      const context = hostState().context || {};
      const nextMode = context.displayMode === "fullscreen" ? "inline" : "fullscreen";
      const supported = supportedDisplayMode(nextMode);
      displayButton.hidden = !supported;
      displayButton.disabled = !supported;
      displayButton.textContent = nextMode === "fullscreen" ? "Fullscreen" : "Inline";
      displayButton.onclick = () => {
        if (!supportedDisplayMode(nextMode)) return;
        void requestHostDisplayMode(nextMode).catch((err) => {
          console.warn("[agent-native] MCP host rejected display mode request", err);
        });
      };
    }

    function setMessage(message) {
      stage.innerHTML = '<div class="message">' + esc(message) + '</div>';
    }

    function clearFrameReadyTimer() {
      if (!appFrameReadyTimer) return;
      clearTimeout(appFrameReadyTimer);
      appFrameReadyTimer = null;
    }

    function clearFrameLoadTimer() {
      if (!appFrameLoadTimer) return;
      clearTimeout(appFrameLoadTimer);
      appFrameLoadTimer = null;
    }

    function startFrameReadyTimer(frame) {
      clearFrameReadyTimer();
      appFrameReadyTimer = setTimeout(() => {
        if (!appFrameReady && appFrame === frame) renderFrameFallback();
      }, frameReadyTimeoutMs);
    }

    // Best-effort telemetry sink so inline-embed failures are visible in
    // Sentry (handshake timeout, transplant fetch status/CORS, auth, CSP).
    // The shell is a sandboxed opaque-origin iframe, so it POSTs to the app
    // origin's CORS-open /_agent-native/mcp/embed-error route, derived from the
    // known app URLs. Deduped per stage+message so a retry loop can't spam.
    const reportedEmbedErrorKeys = new Set();
    let embedErrorReportCount = 0;
    function embedReportOrigin() {
      for (const value of [openStartUrl, openUrl, lastFrameSrc]) {
        if (typeof value === "string" && value) {
          try { return new URL(value, window.location.href).origin; } catch {}
        }
      }
      return "";
    }
    function reportEmbedError(stage, message, detail, status) {
      try {
        const key = String(stage) + "|" + String(message || "");
        if (reportedEmbedErrorKeys.has(key) || embedErrorReportCount >= 8) return;
        reportedEmbedErrorKeys.add(key);
        embedErrorReportCount += 1;
        const origin = embedReportOrigin();
        if (!origin) return;
        let renderMode = "";
        try { renderMode = renderModeSource().mode || ""; } catch {}
        const body = JSON.stringify({
          stage: String(stage || ""),
          message: String(message || "").slice(0, 500),
          detail: detail ? String(detail).slice(0, 1200) : undefined,
          url: openStartUrl || openUrl || lastFrameSrc || "",
          status: typeof status === "number" ? status : undefined,
          host: window.location.hostname || "",
          renderMode: renderMode,
          bridge: openAiBridge ? "openai" : app ? "native" : "none",
          userAgent: navigator.userAgent || ""
        });
        fetch(origin + "/_agent-native/mcp/embed-error", {
          method: "POST",
          credentials: "omit",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: body
        }).catch(() => {});
      } catch {}
    }

    function renderFrameFallback() {
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      appFrame = null;
      const fallbackCopy = openUrl
        ? "This chat host did not allow the embedded app frame to load inline. You can still open the same app route through the host or use the URL below."
        : "This chat host did not allow the embedded app frame to load inline.";
      reportEmbedError("frame-fallback", fallbackCopy);
      stage.innerHTML =
        '<div class="fallback">' +
          '<div class="fallback-title">Open this app in its own tab</div>' +
          '<div class="fallback-copy">' + esc(fallbackCopy) + '</div>' +
          '<div class="fallback-actions">' +
            '<button type="button" class="primary" data-fallback-open>Open in new tab</button>' +
            '<button type="button" data-fallback-retry>Try inline again</button>' +
          '</div>' +
          (openUrl ? '<a class="fallback-url" href="' + esc(openUrl) + '" target="_blank" rel="noreferrer">' + esc(openUrl) + '</a>' : '') +
        '</div>';
      const fallbackOpen = stage.querySelector("[data-fallback-open]");
      const fallbackRetry = stage.querySelector("[data-fallback-retry]");
      if (fallbackOpen) {
        fallbackOpen.disabled = !openUrl;
        fallbackOpen.onclick = () => {
          if (openUrl) void openFallbackExternal();
        };
      }
      if (fallbackRetry) {
        fallbackRetry.disabled = !lastFrameSrc;
        fallbackRetry.onclick = () => {
          if (lastFrameSrc) renderFrame(lastFrameSrc);
        };
      }
    }

    function renderAppLaunchError(message) {
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      appFrame = null;
      const fallbackCopy = openUrl
        ? "The inline MCP app could not load in this chat host. You can open the same app route in a new tab or retry the inline load."
        : "The inline MCP app could not load in this chat host.";
      reportEmbedError("app-launch-error", message || fallbackCopy, message);
      const copyHtml = message
        ? '<div>' + esc(message) + '</div><div>' + esc(fallbackCopy) + '</div>'
        : esc(fallbackCopy);
      stage.innerHTML =
        '<div class="fallback">' +
          '<div class="fallback-title">App did not load</div>' +
          '<div class="fallback-copy">' + copyHtml + '</div>' +
          '<div class="fallback-actions">' +
            '<button type="button" class="primary" data-fallback-open>Open in new tab</button>' +
            '<button type="button" data-fallback-retry>Retry</button>' +
          '</div>' +
          (openUrl ? '<a class="fallback-url" href="' + esc(openUrl) + '" target="_blank" rel="noreferrer">' + esc(openUrl) + '</a>' : '') +
        '</div>';
      const fallbackOpen = stage.querySelector("[data-fallback-open]");
      const fallbackRetry = stage.querySelector("[data-fallback-retry]");
      if (fallbackOpen) {
        fallbackOpen.disabled = !openUrl;
        fallbackOpen.onclick = () => {
          if (openUrl) void openHostLink({ url: openUrl });
        };
      }
      if (fallbackRetry) {
        fallbackRetry.onclick = () => {
          startedFor = "";
          void launchEmbed();
        };
      }
    }

    async function openFallbackExternal() {
      if (!openUrl) return;
      let url = withChatBridgeParam(openUrl);
      try {
        if (url) {
          const result = await callEmbedSessionTool(embedSessionArgsFor(url));
          const data = parseToolResult(result);
          if (typeof data.startUrl === "string" && data.startUrl) {
            url = withChatBridgeParam(data.startUrl);
          }
        }
      } catch (err) {
        console.warn("[agent-native] MCP fallback could not mint a fresh app session", err);
      }
      await openHostLink({ url });
    }

    function renderFrame(src) {
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      const frame = document.createElement("iframe");
      frame.title = body.dataset.iframeTitle || "Agent Native app";
      frame.src = src;
      frame.allow = "clipboard-read; clipboard-write";
      appFrame = frame;
      appFrameReady = false;
      lastFrameSrc = src;
      frame.addEventListener("load", () => {
        if (appFrame !== frame) return;
        clearFrameLoadTimer();
        notifyOuterMcpAppReady();
        sendFrameReadyMessages(frame);
        startFrameReadyTimer(frame);
      });
      stage.replaceChildren(frame);
      notifyHostHeight();
      appFrameLoadTimer = setTimeout(() => {
        if (!appFrameReady && appFrame === frame) renderFrameFallback();
      }, frameLoadTimeoutMs);
    }

    function refreshExpiredEmbedSession() {
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      appFrameReady = false;
      if (!openUrl) {
        renderFrameFallback();
        return;
      }
      if (embedSessionRefreshAttempts >= maxEmbedSessionRefreshAttempts) {
        renderAppLaunchError(
          "Embedded app session expired. Reopen the app to mint a fresh session."
        );
        return;
      }
      embedSessionRefreshAttempts += 1;
      openStartUrl = "";
      startedFor = "";
      lastFrameSrc = "";
      setMessage("Refreshing app session");
      void launchEmbed();
    }

    function shouldSelfNavigateToApp() {
      const render = renderModeSource();
      const mode = render.mode;
      if (isClaudeMcpContentHost()) return true;
      if (mode === "iframe" || mode === "nested") return false;
      if (render.nested || render.frame === "iframe") return false;
      return true;
    }

    function shouldTransplantAppDocument() {
      const render = renderModeSource();
      const mode = render.mode;
      if (mode === "iframe" || mode === "nested" || render.frame === "iframe" || render.nested) {
        return false;
      }
      // ChatGPT is excluded so it uses the controlled nested frame instead:
      // transplant would cross-origin import() app chunks in its opaque-origin
      // sandbox, which it blocks (blank embed). embedMode "transplant" still forces it.
      return (
        isClaudeMcpContentHost() ||
        mode === "transplant" ||
        render.frame === "transplant"
      );
    }

    function isClaudeMcpContentHost() {
      try {
        return /(^|\\.)claudemcpcontent\\.com$/i.test(window.location.hostname || "");
      } catch {
        return false;
      }
    }

    function isChatGptSandboxHost() {
      try {
        const host = window.location.hostname || "";
        const appParam = new URL(window.location.href).searchParams.get("app");
        return /^(?:[^.]+\\.)?web-sandbox\\.oaiusercontent\\.com$/i.test(host) || appParam === "chatgpt";
      } catch {
        return false;
      }
    }

    function shouldRenderControlledAppFrame() {
      return !!openAiBridge || !!app || isChatGptSandboxHost();
    }

    function shouldDirectRenderKnownAppRoute(src) {
      return !!app && !openAiBridge && !isEmbedStartUrl(src) && !shouldTransplantAppDocument();
    }

    function isCurrentFrameUrl(src) {
      try {
        return new URL(src, window.location.href).href === window.location.href;
      } catch {
        return false;
      }
    }

    function navigateToAppFrame(src) {
      if (isCurrentFrameUrl(src)) {
        clearFrameReadyTimer();
        clearFrameLoadTimer();
        setMessage("App opened");
        notifyHostHeightRepeatedly();
        return;
      }
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      appFrame = null;
      lastFrameSrc = src;
      setMessage("Opening app");
      try {
        window.location.replace(src);
      } catch (err) {
        console.warn("[agent-native] MCP app self-navigation failed", err);
        renderFrameFallback();
      }
    }

    async function ensureHostAppConnected() {
      if (!app || typeof app.connect !== "function") return;
      if (!appConnectPromise) {
        appConnectPromise = Promise.resolve(app.connect())
          .then(async (value) => {
            // Let the host process ui/notifications/initialized before follow-up calls.
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            return value;
          })
          .catch((err) => {
            appConnectPromise = null;
            throw err;
          });
      }
      await appConnectPromise;
    }

    async function updateHostModelContext(data) {
      const params = {};
      if (Array.isArray(data && data.content)) params.content = data.content;
      if (data && data.structuredContent && typeof data.structuredContent === "object") {
        params.structuredContent = data.structuredContent;
      }
      if (openAiBridge && typeof openAiBridge.setWidgetState === "function") {
        openAiBridge.setWidgetState({
          ...objectValue(openAiBridge.widgetState),
          agentNativeModelContext: params
        });
        return { ok: true };
      }
      if (!app || typeof app.updateModelContext !== "function") return { ok: false };
      await ensureHostAppConnected();
      await app.updateModelContext(params);
      return { ok: true };
    }

    async function openHostLink(data) {
      const url = typeof (data && data.url) === "string" ? data.url : "";
      if (!url) return { isError: true };
      if (openAiBridge && typeof openAiBridge.openExternal === "function") {
        return await openAiBridge.openExternal({ href: url, redirectUrl: false });
      }
      if (app && typeof app.openLink === "function") {
        return await app.openLink({ url });
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true };
    }

    function notifyHostHeight() {
      const height = applyIntrinsicHeight(visibleIntrinsicHeight());
      if (!openAiBridge || typeof openAiBridge.notifyIntrinsicHeight !== "function") {
        if (app && typeof app.sendSizeChanged === "function") {
          try {
            app.sendSizeChanged({ height });
          } catch (err) {
            console.warn("[agent-native] MCP host rejected size update", err);
          }
        }
        return;
      }
      try {
        openAiBridge.notifyIntrinsicHeight({ height });
      } catch (err) {
        console.warn("[agent-native] ChatGPT rejected intrinsic height update", err);
      }
    }

    function respondToAppFrame(requestId, work) {
      if (!requestId) return;
      Promise.resolve(work)
        .then((result) => {
          sendToAppFrame({
            type: "agentNative.mcpHost.response",
            data: { requestId, ok: true, result }
          });
        })
        .catch((err) => {
          sendToAppFrame({
            type: "agentNative.mcpHost.response",
            data: {
              requestId,
              ok: false,
              error: err && err.message ? err.message : String(err)
            }
          });
        });
    }

    async function sendHostChat(chat) {
      const requestId = typeof (chat && chat.requestId) === "string" ? chat.requestId : "";
      if (!chat || chat.submit === false) return;
      const message = typeof chat.message === "string" ? chat.message : "";
      if (!message.trim()) return;
      const context = typeof chat.context === "string" ? chat.context.trim() : "";
      const content = Array.isArray(chat.content) && chat.content.length
        ? chat.content
        : [{ type: "text", text: message }];
      const structuredContent =
        chat && chat.structuredContent !== undefined
          ? chat.structuredContent
          : undefined;
      try {
        const contextContent = context
          ? [{ type: "text", text: context }, ...content.filter((part) => part && part.type !== "text")]
          : content.filter((part) => part && part.type !== "text");
        const modelContext = {
          content: contextContent,
          ...(structuredContent !== undefined ? { structuredContent } : {})
        };
        if (openAiBridge && typeof openAiBridge.setWidgetState === "function") {
          openAiBridge.setWidgetState({
            ...objectValue(openAiBridge.widgetState),
            agentNativeChatContext: context || null,
            agentNativeModelContext: modelContext
          });
        } else if (app && typeof app.updateModelContext === "function") {
          await ensureHostAppConnected();
          await app.updateModelContext(modelContext);
        }
      } catch (err) {
        console.warn("[agent-native] MCP host rejected model context update", err);
      }
      try {
        if (openAiBridge && typeof openAiBridge.sendFollowUpMessage === "function") {
          await openAiBridge.sendFollowUpMessage({
            prompt: message,
            scrollToBottom: true
          });
          respondToWrapperRequest(requestId, { ok: true });
          return;
        }
        let result = null;
        if (app && typeof app.sendMessage === "function") {
          await ensureHostAppConnected();
          result = await app.sendMessage({
            role: "user",
            content
          });
        } else {
          result = await wrapperRpcRequest("ui/message", {
            role: "user",
            content
          });
        }
        if (result && result.isError) {
          console.warn("[agent-native] MCP host rejected chat message", result);
          respondToWrapperRequest(requestId, { ok: false, result });
          return;
        }
        if (result && result.ok === false) {
          console.warn("[agent-native] MCP host chat bridge failed", result);
          respondToWrapperRequest(requestId, { ok: false, result });
          return;
        }
        respondToWrapperRequest(requestId, { ok: true, result });
      } catch (err) {
        console.warn("[agent-native] MCP host chat bridge failed", err);
        respondToWrapperRequest(requestId, { ok: false, error: err && err.message ? err.message : String(err) });
      }
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      settleWrapperRpcResponse(message);
    });

    window.addEventListener("message", (event) => {
      if (!appFrame || event.source !== appFrame.contentWindow) return;
      if (!event.data) return;
      const data = event.data.data || {};
      if (event.data.type === "agentNative.embeddedAppReady") {
        appFrameReady = true;
        embedSessionRefreshAttempts = 0;
        clearFrameLoadTimer();
        clearFrameReadyTimer();
        notifyOuterMcpAppReady();
        return;
      }
      if (event.data.type === "agentNative.embedSessionExpired") {
        refreshExpiredEmbedSession();
        return;
      }
      if (event.data.type === "agentNative.submitChat") {
        void sendHostChat(data);
        return;
      }
      if (event.data.type === "agentNative.mcpHost.updateModelContext") {
        respondToAppFrame(data.requestId, updateHostModelContext(data));
        return;
      }
      if (event.data.type === "agentNative.mcpHost.openLink") {
        respondToAppFrame(data.requestId, openHostLink(data));
        return;
      }
      if (event.data.type === "agentNative.mcpHost.requestDisplayMode") {
        respondToAppFrame(data.requestId, requestHostDisplayMode(data.mode));
      }
    });

    function notifyHostHeightSoon() {
      requestAnimationFrame(() => notifyHostHeight());
    }

    function notifyHostHeightRepeatedly() {
      notifyHostHeight();
      [0, 250, 1000, 2500].forEach((delay) => {
        setTimeout(() => notifyHostHeight(), delay);
      });
    }

    window.addEventListener("resize", notifyHostHeightSoon, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", notifyHostHeightSoon, { passive: true });
    }

    async function launchEmbed() {
      let launchUrl = openStartUrl || openUrl;
      if (!launchUrl) {
        renderAppLaunchError("Open link was not available.");
        return;
      }
      if (!wantsEmbed()) {
        setMessage("Ready to open.");
        return;
      }
      setMessage("Loading app");
      try {
        const selfNavigate = shouldSelfNavigateToApp();
        if (startedFor === launchUrl) return;
        startedFor = launchUrl;
        const embedUrl = withChatBridgeParam(launchUrl);
        if (selfNavigate && isEmbedStartUrl(embedUrl)) {
          if (shouldTransplantAppDocument()) {
            await transplantAppDocument(embedUrl);
          } else if (shouldRenderControlledAppFrame()) {
            renderFrame(embedUrl);
          } else {
            navigateToAppFrame(embedUrl);
          }
          return;
        }
        if (!selfNavigate && isEmbedStartUrl(embedUrl)) {
          renderFrame(embedUrl);
          return;
        }
        if (shouldDirectRenderKnownAppRoute(embedUrl)) {
          renderFrame(embedUrl);
          return;
        }
        const result = await callEmbedSessionTool(embedSessionArgsFor(embedUrl));
        const data = parseToolResult(result);
        if (typeof data.startUrl !== "string" || !data.startUrl) {
          startedFor = "";
          renderAppLaunchError(data.error || "This app can be opened, but not embedded from this MCP server.");
          return;
        }
        const startUrl = withChatBridgeParam(data.startUrl);
        if (selfNavigate) {
          if (shouldTransplantAppDocument()) {
            await transplantAppDocument(startUrl);
          } else if (shouldRenderControlledAppFrame()) {
            renderFrame(startUrl);
          } else {
            navigateToAppFrame(startUrl);
          }
        } else {
          renderFrame(startUrl);
        }
      } catch (err) {
        startedFor = "";
        renderAppLaunchError(err && err.message ? err.message : "Could not launch embedded app.");
      }
    }

    async function callEmbedSessionTool(args) {
      if (openAiBridge && typeof openAiBridge.callTool === "function") {
        return await openAiBridge.callTool(startTool, args);
      }
      if (!app || typeof app.callServerTool !== "function") {
        throw new Error("Host tool calls are not available.");
      }
      return await app.callServerTool({ name: startTool, arguments: args });
    }

    function updateHostOpenInAppUrl() {
      if (!openAiBridge || !openUrl || typeof openAiBridge.setOpenInAppUrl !== "function") {
        return;
      }
      try {
        openAiBridge.setOpenInAppUrl({ href: openUrl });
      } catch (err) {
        console.warn("[agent-native] ChatGPT rejected open-in-app URL", err);
      }
    }

    function updateOpenButton() {
      const buttonUrl = openUrl;
      openButton.disabled = !buttonUrl;
      openButton.onclick = () => {
        if (buttonUrl) void openHostLink({ url: buttonUrl });
      };
      updateHostOpenInAppUrl();
    }

    function updateTitle(data) {
      const record = objectValue(data);
      const label = record.label || record.app || record.view || body.dataset.appTitle || "App";
      titleEl.textContent = String(label);
    }

    function readOpenAiBridge() {
      return window.openai && typeof window.openai === "object"
        ? window.openai
        : null;
    }

    function isChatGptHostHint() {
      try {
        if (new URLSearchParams(window.location.search).get("app") === "chatgpt") return true;
      } catch (_err) {}
      try {
        if (/^(?:[^.]+\\.)?web-sandbox\\.oaiusercontent\\.com$/i.test(window.location.hostname || "")) return true;
      } catch (_err) {}
      try {
        return /chatgpt/i.test(String(navigator.userAgent || ""));
      } catch (_err) {
        return false;
      }
    }

    function openAiToolResultParams(bridge) {
      const params = {};
      if (bridge && bridge.toolOutput !== undefined) {
        if (bridge.toolOutput && typeof bridge.toolOutput === "object") {
          params.structuredContent = bridge.toolOutput;
        } else {
          params.content = [{ type: "text", text: String(bridge.toolOutput) }];
        }
      }
      if (bridge && bridge.toolResponseMetadata && typeof bridge.toolResponseMetadata === "object") {
        params._meta = bridge.toolResponseMetadata;
      }
      return params;
    }

    function syncOpenAiBridge(bridge) {
      if (!bridge) return false;
      openAiBridge = bridge;
      toolInput = objectValue(bridge.toolInput);
      const params = openAiToolResultParams(bridge);
      const data = parseToolResult(params);
      toolResultData = objectValue(data);
      openUrl = openLinkFrom(params, data);
      openStartUrl = embedStartUrlFrom(params, data);
      updateTitle(data);
      updateOpenButton();
      updateDisplayButton();
      notifyHostHeight();
      sendHostContext();
      if (openUrl || openStartUrl) {
        void launchEmbed();
      } else if (!appFrame) {
        setMessage("Waiting for app result");
      }
      return true;
    }

    function waitForOpenAiBridge() {
      const existing = readOpenAiBridge();
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        let settled = false;
        let pollTimer = 0;
        const finish = (bridge) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("openai:set_globals", onGlobals);
          clearTimeout(timer);
          clearTimeout(pollTimer);
          resolve(bridge || readOpenAiBridge());
        };
        const poll = () => {
          const bridge = readOpenAiBridge();
          if (bridge) {
            finish(bridge);
            return;
          }
          pollTimer = window.setTimeout(poll, openAiBridgePollMs);
        };
        const onGlobals = () => finish(readOpenAiBridge());
        const timer = window.setTimeout(
          () => finish(null),
          isChatGptHostHint() ? chatGptOpenAiBridgeWaitMs : defaultOpenAiBridgeWaitMs
        );
        window.addEventListener("openai:set_globals", onGlobals, { passive: true });
        pollTimer = window.setTimeout(poll, openAiBridgePollMs);
      });
    }

    window.addEventListener("openai:set_globals", () => {
      const bridge = readOpenAiBridge();
      if (bridge && (!appFrame || openAiBridge)) syncOpenAiBridge(bridge);
    }, { passive: true });

    function createNativeMcpAppsBridge() {
      let rpcId = 0;
      let connectPromise = null;
      let hostContext = {};
      const pendingRequests = new Map();

      function rpcNotify(method, params) {
        window.parent.postMessage({ jsonrpc: "2.0", method, params: params || {} }, "*");
      }

      function rpcRequest(method, params, timeoutMs) {
        return new Promise((resolve, reject) => {
          const id = ++rpcId;
          const timer = window.setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error("MCP Apps bridge request timed out: " + method));
          }, timeoutMs || nativeBridgeRequestTimeoutMs);
          pendingRequests.set(id, { resolve, reject, timer });
          window.parent.postMessage(
            { jsonrpc: "2.0", id, method, params: params || {} },
            "*"
          );
        });
      }

      function settleRpcResponse(message) {
        const pending = pendingRequests.get(message.id);
        if (!pending) return true;
        pendingRequests.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(message.error.message || "MCP Apps bridge request failed.");
          error.data = message.error.data;
          pending.reject(error);
          return true;
        }
        pending.resolve(message.result);
        return true;
      }

      function notificationParams(message) {
        return message && typeof message.params === "object" && message.params
          ? message.params
          : {};
      }

      function toolInputNotificationParams(params) {
        if (params && typeof params.arguments === "object" && params.arguments) {
          return params;
        }
        if (params && typeof params.input === "object" && params.input) {
          return { arguments: params.input };
        }
        return { arguments: objectValue(params) };
      }

      const nativeApp = {
        ontoolinput: null,
        ontoolresult: null,
        onhostcontextchanged: null,
        getHostContext() {
          return hostContext.context || hostContext;
        },
        getHostCapabilities() {
          return hostContext.capabilities || { tools: true, messaging: true };
        },
        getHostVersion() {
          return hostContext.protocolVersion || "mcp-apps-postmessage";
        },
        async connect() {
          if (connectPromise) return await connectPromise;
          connectPromise = (async () => {
            window.addEventListener("message", onMessage, { passive: true });
            const result = await rpcRequest(
              "ui/initialize",
              {
                appInfo: { name: "Agent Native Embed", version: "1.0.0" },
                appCapabilities: {},
                protocolVersion: "2026-01-26"
              },
              nativeBridgeInitializeTimeoutMs
            );
            hostContext = objectValue(result);
            rpcNotify("ui/notifications/initialized", {});
            if (typeof nativeApp.onhostcontextchanged === "function") {
              nativeApp.onhostcontextchanged(hostContext);
            }
            return hostContext;
          })().catch((err) => {
            connectPromise = null;
            throw err;
          });
          return await connectPromise;
        },
        async callServerTool(request) {
          await nativeApp.connect();
          const record = objectValue(request);
          return await rpcRequest("tools/call", {
            name: record.name,
            arguments: objectValue(record.arguments)
          });
        },
        async updateModelContext(params) {
          await nativeApp.connect();
          return await rpcRequest("ui/update-model-context", objectValue(params));
        },
        async openLink(params) {
          const url = typeof (params && params.url) === "string" ? params.url : "";
          if (!url) return { isError: true };
          try {
            return await rpcRequest("ui/open-link", { url }, wrapperRequestTimeoutMs);
          } catch (err) {
            console.warn("[agent-native] MCP host open-link request failed", err);
          }
          const opened = window.open(url, "_blank", "noopener,noreferrer");
          return opened ? { ok: true } : { isError: true };
        },
        async requestDisplayMode(params) {
          await nativeApp.connect();
          return await rpcRequest("ui/request-display-mode", objectValue(params));
        },
        sendSizeChanged(params) {
          rpcNotify("ui/notifications/size-changed", objectValue(params));
        },
        async sendMessage(params) {
          await nativeApp.connect();
          return await rpcRequest("ui/message", objectValue(params));
        }
      };

      function onMessage(event) {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (typeof message.id === "number" || typeof message.id === "string") {
          settleRpcResponse(message);
          return;
        }
        if (typeof message.method !== "string") return;
        const params = notificationParams(message);
        if (message.method === "ui/notifications/tool-input") {
          if (typeof nativeApp.ontoolinput === "function") {
            nativeApp.ontoolinput(toolInputNotificationParams(params));
          }
          return;
        }
        if (message.method === "ui/notifications/tool-result") {
          if (typeof nativeApp.ontoolresult === "function") {
            nativeApp.ontoolresult(params);
          }
          return;
        }
        if (
          message.method === "ui/notifications/host-context-changed" ||
          message.method === "ui/notifications/host-context" ||
          message.method === "ui/notifications/context"
        ) {
          hostContext = objectValue(params);
          if (typeof nativeApp.onhostcontextchanged === "function") {
            nativeApp.onhostcontextchanged(hostContext);
          }
        }
      }

      return nativeApp;
    }

    async function startNativeMcpAppsBridge() {
      app = createNativeMcpAppsBridge();
      appConnectPromise = null;
      app.ontoolinput = (params) => {
        toolInput = params.arguments || {};
      };
      app.ontoolresult = (params) => {
        const data = parseToolResult(params);
        toolResultData = objectValue(data);
        openUrl = openLinkFrom(params, data);
        openStartUrl = embedStartUrlFrom(params, data);
        updateTitle(data);
        updateOpenButton();
        void launchEmbed();
      };
      app.onhostcontextchanged = () => {
        updateDisplayButton();
        notifyHostHeight();
        sendHostContext();
      };
      await ensureHostAppConnected();
      notifyOuterMcpAppReady();
      updateDisplayButton();
      notifyHostHeight();
      sendHostContext();
    }

    async function startMcpAppsBridge() {
      const { App } = await import("${MCP_APP_IMPORT}");
      app = new App(
        { name: "Agent Native Embed", version: "1.0.0" },
        {},
        { autoResize: false }
      );
      appConnectPromise = null;
      app.ontoolinput = (params) => {
        toolInput = params.arguments || {};
      };
      app.ontoolresult = (params) => {
        const data = parseToolResult(params);
        toolResultData = objectValue(data);
        openUrl = openLinkFrom(params, data);
        openStartUrl = embedStartUrlFrom(params, data);
        updateTitle(data);
        updateOpenButton();
        void launchEmbed();
      };
      app.onhostcontextchanged = () => {
        updateDisplayButton();
        notifyHostHeight();
        sendHostContext();
      };
      await ensureHostAppConnected();
      notifyOuterMcpAppReady();
      updateDisplayButton();
      notifyHostHeight();
      sendHostContext();
    }

    try {
      const initialOpenAiBridge = await waitForOpenAiBridge();
      if (!syncOpenAiBridge(initialOpenAiBridge)) {
        try {
          await startNativeMcpAppsBridge();
        } catch (nativeErr) {
          console.warn("[agent-native] native MCP Apps bridge failed", nativeErr);
          await startMcpAppsBridge();
        }
      }
    } catch (err) {
      console.error("[agent-native] MCP app shell failed", err);
      reportEmbedError(
        "bridge-init",
        err && err.message ? err.message : "Could not initialize app.",
        err && err.stack ? String(err.stack) : undefined
      );
      setMessage(err && err.message ? err.message : "Could not initialize app.");
    }

    window.addEventListener("error", (event) => {
      const err = event && event.error;
      reportEmbedError(
        "window-error",
        (err && err.message) || (event && event.message) || "Uncaught error in MCP app embed.",
        err && err.stack ? String(err.stack) : undefined
      );
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event && event.reason;
      reportEmbedError(
        "unhandled-rejection",
        (reason && reason.message) || String(reason || "Unhandled promise rejection in MCP app embed."),
        reason && reason.stack ? String(reason.stack) : undefined
      );
    });
    })();
  </script>
</body>
</html>`,
    csp: {
      connectDomains: [
        "https://esm.sh",
        MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
        ...(options.connectDomains ?? []),
        ...(options.frameDomains ?? []),
      ],
      resourceDomains: [
        "https://esm.sh",
        MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
        ...(options.resourceDomains ?? []),
        ...(options.frameDomains ?? []),
      ],
      baseUriDomains: [
        MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
        ...(options.baseUriDomains ?? []),
      ],
      frameDomains,
    },
    prefersBorder: false,
  };
}
