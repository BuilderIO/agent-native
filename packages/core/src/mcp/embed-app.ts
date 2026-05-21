import type { ActionMcpAppResourceConfig } from "../action.js";
import { MCP_APP_CHAT_BRIDGE_QUERY_PARAM } from "../shared/embed-auth.js";

const MCP_APP_IMPORT =
  "https://esm.sh/@modelcontextprotocol/ext-apps@1.7.2/app-with-deps";

export const MCP_APP_REQUEST_ORIGIN_CSP_SOURCE = "$requestOrigin";

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
  const height = Math.max(320, Math.min(900, options.height ?? 900));

  return {
    title,
    ...(options.description ? { description: options.description } : {}),
    html: () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .shell { display: grid; gap: 8px; min-height: ${height}px; padding: 0; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
    .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; color: color-mix(in srgb, CanvasText 72%, Canvas); }
    .actions { display: flex; align-items: center; gap: 6px; }
    button { min-height: 28px; border: 1px solid color-mix(in srgb, CanvasText 14%, Canvas); border-radius: 7px; background: Canvas; color: CanvasText; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; padding: 0 9px; }
    button:disabled { opacity: .55; cursor: default; }
    .stage { position: relative; min-height: ${height - 44}px; }
    iframe { display: block; width: 100%; height: ${height - 44}px; border: 0; background: Canvas; }
    .message { display: grid; place-items: center; min-height: ${height - 44}px; padding: 18px; color: color-mix(in srgb, CanvasText 62%, Canvas); font-size: 13px; line-height: 1.45; text-align: center; }
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
    import { App } from "${MCP_APP_IMPORT}";

    const app = new App({ name: "Agent Native Embed", version: "1.0.0" }, {});
    const body = document.body;
    const stage = document.querySelector("[data-stage]");
    const titleEl = document.querySelector("[data-title-label]");
    const openButton = document.querySelector("[data-open]");
    const displayButton = document.querySelector("[data-display]");
    const startTool = body.dataset.startTool || "create_embed_session";
    const embedByDefault = body.dataset.embedDefault !== "0";
    const chatBridgeParam = ${JSON.stringify(MCP_APP_CHAT_BRIDGE_QUERY_PARAM)};
    let toolInput = {};
    let openUrl = "";
    let startedFor = "";
    let appFrame = null;

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

    function parseToolResult(params) {
      if (!params) return {};
      if (params.structuredContent && typeof params.structuredContent === "object") {
        return params.structuredContent;
      }
      const parts = Array.isArray(params.content) ? params.content : [];
      const textPart = parts.find((part) => part && part.type === "text" && typeof part.text === "string");
      return parseJson(textPart ? textPart.text : "", {});
    }

    function openLinkFrom(params, data) {
      const metaUrl = params && params._meta && params._meta["agent-native/openLink"]
        ? params._meta["agent-native/openLink"].webUrl
        : "";
      return metaUrl || data.url || data.deepLink || data.openUrl || "";
    }

    function hostState() {
      return {
        context: app.getHostContext ? app.getHostContext() : undefined,
        capabilities: app.getHostCapabilities ? app.getHostCapabilities() : undefined,
        version: app.getHostVersion ? app.getHostVersion() : undefined
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
      [0, 200, 500, 1500].forEach((delay) => {
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

    function wantsEmbed() {
      if (toolInput.embed === false || toolInput.embed === "false") return false;
      if (embedByDefault) return true;
      return toolInput.embed === true || toolInput.embed === "true";
    }

    function supportedDisplayMode(mode) {
      const modes = hostState().context && hostState().context.availableDisplayModes;
      return Array.isArray(modes) && modes.includes(mode);
    }

    async function requestHostDisplayMode(mode) {
      const result = await app.requestDisplayMode({ mode });
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

    function renderFrame(src) {
      const frame = document.createElement("iframe");
      frame.title = body.dataset.iframeTitle || "Agent Native app";
      frame.src = src;
      frame.allow = "clipboard-read; clipboard-write";
      appFrame = frame;
      frame.addEventListener("load", () => sendFrameReadyMessages(frame));
      stage.replaceChildren(frame);
    }

    async function updateHostModelContext(data) {
      const params = {};
      if (Array.isArray(data && data.content)) params.content = data.content;
      if (data && data.structuredContent && typeof data.structuredContent === "object") {
        params.structuredContent = data.structuredContent;
      }
      await app.updateModelContext(params);
    }

    async function openHostLink(data) {
      const url = typeof (data && data.url) === "string" ? data.url : "";
      if (!url) return { isError: true };
      return await app.openLink({ url });
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
          await app.updateModelContext({
            content: [{ type: "text", text: context }]
          });
        } catch (err) {
          console.warn("[agent-native] MCP host rejected model context update", err);
        }
      }
      try {
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

    async function launchEmbed() {
      if (!openUrl) {
        setMessage("Open link was not available.");
        return;
      }
      if (!wantsEmbed()) {
        setMessage("Ready to open.");
        return;
      }
      if (startedFor === openUrl) return;
      startedFor = openUrl;
      setMessage("Loading app");
      try {
        const embedUrl = withChatBridgeParam(openUrl);
        const result = await app.callServerTool({
          name: startTool,
          arguments: {
            url: embedUrl,
            chrome: typeof toolInput.chrome === "string" ? toolInput.chrome : "full"
          }
        });
        const data = parseToolResult(result);
        if (!data.startUrl) {
          startedFor = "";
          setMessage(data.error || "This app can be opened, but not embedded from this MCP server.");
          return;
        }
        renderFrame(data.startUrl);
      } catch (err) {
        startedFor = "";
        setMessage(err && err.message ? err.message : "Could not launch embedded app.");
      }
    }

    function updateOpenButton() {
      openButton.disabled = !openUrl;
      openButton.onclick = () => {
        if (openUrl) void app.openLink({ url: openUrl });
      };
    }

    function updateTitle(data) {
      const label = data.label || data.app || data.view || body.dataset.appTitle || "App";
      titleEl.textContent = String(label);
    }

    app.ontoolinput = (params) => {
      toolInput = params.arguments || {};
    };
    app.ontoolresult = (params) => {
      const data = parseToolResult(params);
      openUrl = openLinkFrom(params, data);
      updateTitle(data);
      updateOpenButton();
      void launchEmbed();
    };
    app.onhostcontextchanged = () => {
      updateDisplayButton();
      sendHostContext();
    };
    await app.connect();
    updateDisplayButton();
    sendHostContext();
  </script>
</body>
</html>`,
    csp: {
      connectDomains: ["https://esm.sh"],
      resourceDomains: ["https://esm.sh"],
      frameDomains: [
        MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
        ...(options.frameDomains ?? []),
      ],
    },
    prefersBorder: false,
  };
}
