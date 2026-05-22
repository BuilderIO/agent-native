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
  <script type="module">
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
    let app = null;
    let openAiBridge = null;
    let toolInput = {};
    let openUrl = "";
    let openStartUrl = "";
    let startedFor = "";
    let appFrame = null;
    let appFrameReady = false;
    let appFrameReadyTimer = null;
    let appFrameLoadTimer = null;
    let lastFrameSrc = "";

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
      const openLink = params && params._meta && params._meta["agent-native/openLink"];
      const metaUrl = openLinkWebUrlFrom(openLink);
      const record = data && typeof data === "object" ? data : {};
      const structuredOpenLinkUrl = openLinkWebUrlFrom(record.openLink);
      return firstNonEmbedStartUrl([
        record.embedTargetPath,
        record.deepLinkUrl,
        record.deepLink,
        record.openUrl,
        record.url,
        structuredOpenLinkUrl,
        metaUrl
      ]);
    }

    function embedStartUrlFrom(params, data) {
      const openLink = params && params._meta && params._meta["agent-native/openLink"];
      const metaUrl = openLinkWebUrlFrom(openLink);
      const record = data && typeof data === "object" ? data : {};
      return firstEmbedStartUrl([
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

    function installExternalEmbedRuntime(config) {
      window.__AGENT_NATIVE_EXTERNAL_EMBED = config;
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

    function rootRelativeSpecifiersToAbsolute(code, appOrigin) {
      return String(code).replace(/(["'])\\/(?!\\/)/g, "$1" + appOrigin + "/");
    }

    function moduleCodeToClassicAsync(code, appOrigin) {
      return rootRelativeSpecifiersToAbsolute(code, appOrigin)
        .replace(
          /\\bimport\\s+\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+(["'][^"']+["'])\\s*;?/g,
          "const $1 = await import($2);"
        )
        .replace(/\\bimport\\s+(["'][^"']+["'])\\s*;?/g, "await import($1);")
        .replace(/\\bimport\\((["'][^"']+["'])\\)\\s*;?/g, "await import($1);");
    }

    function runModuleScriptAsClassic(script, appOrigin) {
      const code = moduleCodeToClassicAsync(script.textContent || "", appOrigin);
      const runner = document.createElement("script");
      runner.textContent =
        "(async()=>{" +
        code +
        "})().catch((err)=>{console.error('[agent-native] transplanted app module failed',err);document.body.setAttribute('data-agent-native-hydration-error',String(err&&err.message||err));});";
      document.body.appendChild(runner);
      runner.remove();
    }

    function mountTransplantedHtml(html, appUrl) {
      const config = embedConfigForAppUrl(appUrl);
      installExternalEmbedRuntime(config);
      const parsed = new DOMParser().parseFromString(
        rewriteRootRelativeHtmlUrls(removeHtmlCspMeta(html), appUrl.origin),
        "text/html"
      );
      const scripts = Array.from(parsed.querySelectorAll("script"));
      copyDocumentElementAttributes(parsed.documentElement);
      importChildren(parsed.head, document.head);
      const base = document.createElement("base");
      base.href = config.baseHref;
      document.head.prepend(base);
      importChildren(parsed.body, document.body);
      for (const script of scripts) {
        if (isRunnableClassicScript(script)) runClassicScript(script);
      }
      for (const script of scripts) {
        if (isModuleScript(script)) runModuleScriptAsClassic(script, appUrl.origin);
      }
    }

    async function transplantAppDocument(src) {
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      appFrame = null;
      lastFrameSrc = src;
      setMessage("Loading app");
      const response = await fetch(src, {
        credentials: "omit",
        redirect: "follow",
        headers: { Accept: "text/html" }
      });
      if (!response.ok) {
        throw new Error("Embedded app returned HTTP " + response.status + ".");
      }
      const html = await response.text();
      const appUrl = new URL(response.url || src);
      try {
        window.history.replaceState(window.history.state, "", localPathFromUrl(appUrl, false));
      } catch {}
      mountTransplantedHtml(html, appUrl);
      notifyHostHeightRepeatedly();
    }

    function wantsEmbed() {
      if (toolInput.embed === false || toolInput.embed === "false") return false;
      if (embedByDefault) return true;
      return toolInput.embed === true || toolInput.embed === "true";
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

    function renderFrameFallback() {
      clearFrameReadyTimer();
      clearFrameLoadTimer();
      appFrame = null;
      stage.innerHTML =
        '<div class="fallback">' +
          '<div class="fallback-title">Open this app in its own tab</div>' +
          '<div class="fallback-copy">This chat host did not allow the embedded app frame to load inline. You can still open the same app route through the host or use the URL below.</div>' +
          '<div class="fallback-actions">' +
            '<button type="button" data-fallback-open>Open app</button>' +
            '<button type="button" data-fallback-retry>Try inline again</button>' +
          '</div>' +
          (openUrl || openStartUrl ? '<a class="fallback-url" href="' + esc(openUrl || openStartUrl) + '" target="_blank" rel="noreferrer">' + esc(openUrl || openStartUrl) + '</a>' : '') +
        '</div>';
      const fallbackOpen = stage.querySelector("[data-fallback-open]");
      const fallbackRetry = stage.querySelector("[data-fallback-retry]");
      if (fallbackOpen) {
        fallbackOpen.disabled = !(openUrl || openStartUrl);
        fallbackOpen.onclick = () => {
          if (openUrl || openStartUrl) void openFallbackExternal();
        };
      }
      if (fallbackRetry) {
        fallbackRetry.disabled = !lastFrameSrc;
        fallbackRetry.onclick = () => {
          if (lastFrameSrc) renderFrame(lastFrameSrc);
        };
      }
    }

    async function openFallbackExternal() {
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
      if (!url) url = withChatBridgeParam(openStartUrl);
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
        sendFrameReadyMessages(frame);
        startFrameReadyTimer(frame);
      });
      stage.replaceChildren(frame);
      notifyHostHeight();
      appFrameLoadTimer = setTimeout(() => {
        if (!appFrameReady && appFrame === frame) renderFrameFallback();
      }, frameLoadTimeoutMs);
    }

    function shouldSelfNavigateToApp() {
      const mode = typeof toolInput.embedMode === "string"
        ? toolInput.embedMode
        : typeof toolInput.renderMode === "string"
          ? toolInput.renderMode
          : "";
      if (mode === "iframe" || mode === "nested") return false;
      if (toolInput.nested === true || toolInput.frame === "iframe") return false;
      return true;
    }

    function shouldTransplantAppDocument() {
      const mode = typeof toolInput.embedMode === "string"
        ? toolInput.embedMode
        : typeof toolInput.renderMode === "string"
          ? toolInput.renderMode
          : "";
      return (
        mode === "transplant" ||
        toolInput.frame === "transplant" ||
        isClaudeMcpContentHost()
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
        return /(^|\\.)oaiusercontent\\.com$/i.test(host) || appParam === "chatgpt";
      } catch {
        return false;
      }
    }

    function shouldRenderControlledAppFrame() {
      return !!openAiBridge || isChatGptSandboxHost();
    }

    function navigateToAppFrame(src) {
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
      if (!chat || chat.submit === false) return;
      const message = typeof chat.message === "string" ? chat.message : "";
      if (!message.trim()) return;
      const context = typeof chat.context === "string" ? chat.context : "";
      if (context.trim()) {
        try {
          if (openAiBridge && typeof openAiBridge.setWidgetState === "function") {
            openAiBridge.setWidgetState({
              ...objectValue(openAiBridge.widgetState),
              agentNativeChatContext: context
            });
          } else if (app && typeof app.updateModelContext === "function") {
            await app.updateModelContext({
              content: [{ type: "text", text: context }]
            });
          }
        } catch (err) {
          console.warn("[agent-native] MCP host rejected model context update", err);
        }
      }
      try {
        if (openAiBridge && typeof openAiBridge.sendFollowUpMessage === "function") {
          await openAiBridge.sendFollowUpMessage({
            prompt: context.trim() ? context.trim() + "\\n\\n" + message : message,
            scrollToBottom: true
          });
          return;
        }
        if (!app || typeof app.sendMessage !== "function") return;
        const result = await app.sendMessage({
          role: "user",
          content: [{ type: "text", text: message }]
        });
        if (result && result.isError) {
          console.warn("[agent-native] MCP host rejected chat message", result);
        }
      } catch (err) {
        console.warn("[agent-native] MCP host chat bridge failed", err);
      }
    }

    window.addEventListener("message", (event) => {
      if (!appFrame || event.source !== appFrame.contentWindow) return;
      if (!event.data) return;
      const data = event.data.data || {};
      if (event.data.type === "agentNative.embeddedAppReady") {
        appFrameReady = true;
        clearFrameLoadTimer();
        clearFrameReadyTimer();
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
      const launchUrl = openStartUrl || openUrl;
      if (!launchUrl) {
        setMessage("Open link was not available.");
        return;
      }
      if (!wantsEmbed()) {
        setMessage("Ready to open.");
        return;
      }
      if (startedFor === launchUrl) return;
      startedFor = launchUrl;
      setMessage("Loading app");
      try {
        const selfNavigate = shouldSelfNavigateToApp();
        const embedUrl = withChatBridgeParam(launchUrl);
        if (selfNavigate && isEmbedStartUrl(embedUrl)) {
          if (isClaudeMcpContentHost() && shouldTransplantAppDocument()) {
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
        const result = await callEmbedSessionTool(embedSessionArgsFor(embedUrl));
        const data = parseToolResult(result);
        if (typeof data.startUrl !== "string" || !data.startUrl) {
          startedFor = "";
          setMessage(data.error || "This app can be opened, but not embedded from this MCP server.");
          return;
        }
        const startUrl = withChatBridgeParam(data.startUrl);
        if (selfNavigate) {
          if (isClaudeMcpContentHost() && shouldTransplantAppDocument()) {
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
        setMessage(err && err.message ? err.message : "Could not launch embedded app.");
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
      const buttonUrl = openUrl || openStartUrl;
      openButton.disabled = !buttonUrl;
      openButton.onclick = () => {
        if (buttonUrl) void openHostLink({ url: buttonUrl });
      };
      updateHostOpenInAppUrl();
    }

    function updateTitle(data) {
      const label = data.label || data.app || data.view || body.dataset.appTitle || "App";
      titleEl.textContent = String(label);
    }

    function readOpenAiBridge() {
      return window.openai && typeof window.openai === "object"
        ? window.openai
        : null;
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
        const finish = (bridge) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("openai:set_globals", onGlobals);
          clearTimeout(timer);
          resolve(bridge || readOpenAiBridge());
        };
        const onGlobals = () => finish(readOpenAiBridge());
        const timer = setTimeout(() => finish(null), 200);
        window.addEventListener("openai:set_globals", onGlobals, { passive: true });
      });
    }

    window.addEventListener("openai:set_globals", () => {
      const bridge = readOpenAiBridge();
      if (bridge && (!appFrame || openAiBridge)) syncOpenAiBridge(bridge);
    }, { passive: true });

    async function startMcpAppsBridge() {
      const { App } = await import("${MCP_APP_IMPORT}");
      app = new App(
        { name: "Agent Native Embed", version: "1.0.0" },
        {},
        { autoResize: false }
      );
      app.ontoolinput = (params) => {
        toolInput = params.arguments || {};
      };
      app.ontoolresult = (params) => {
        const data = parseToolResult(params);
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
      await app.connect();
      updateDisplayButton();
      notifyHostHeight();
      sendHostContext();
    }

    const initialOpenAiBridge = await waitForOpenAiBridge();
    if (!syncOpenAiBridge(initialOpenAiBridge)) {
      await startMcpAppsBridge();
    }
  </script>
</body>
</html>`,
    csp: {
      connectDomains: [
        "https://esm.sh",
        MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
        ...(options.frameDomains ?? []),
      ],
      resourceDomains: [
        "https://esm.sh",
        MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
        ...(options.frameDomains ?? []),
      ],
      baseUriDomains: [MCP_APP_REQUEST_ORIGIN_CSP_SOURCE],
      frameDomains,
    },
    prefersBorder: false,
  };
}
