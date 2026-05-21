import type { ActionMcpAppResourceConfig } from "../action.js";

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
  data-title="${attr(title)}"
  data-iframe-title="${attr(iframeTitle)}"
  data-open-label="${attr(openLabel)}"
  data-start-tool="${attr(startToolName)}"
  data-embed-default="${embedByDefault ? "1" : "0"}"
>
  <main class="shell">
    <div class="bar">
      <div class="title" data-title>${attr(title)}</div>
      <div class="actions">
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
    const titleEl = document.querySelector("[data-title]");
    const openButton = document.querySelector("[data-open]");
    const startTool = body.dataset.startTool || "create_embed_session";
    const embedByDefault = body.dataset.embedDefault !== "0";
    let toolInput = {};
    let openUrl = "";
    let startedFor = "";

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

    function wantsEmbed() {
      if (toolInput.embed === false || toolInput.embed === "false") return false;
      if (embedByDefault) return true;
      return toolInput.embed === true || toolInput.embed === "true";
    }

    function setMessage(message) {
      stage.innerHTML = '<div class="message">' + esc(message) + '</div>';
    }

    function renderFrame(src) {
      const frame = document.createElement("iframe");
      frame.title = body.dataset.iframeTitle || "Agent Native app";
      frame.src = src;
      frame.allow = "clipboard-read; clipboard-write";
      stage.replaceChildren(frame);
    }

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
        const result = await app.callServerTool({
          name: startTool,
          arguments: {
            url: openUrl,
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
      const label = data.label || data.app || data.view || body.dataset.title || "App";
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
    await app.connect();
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
