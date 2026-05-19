const MCP_APP_IMPORT =
  "https://esm.sh/@modelcontextprotocol/ext-apps@1.7.2/app-with-deps";
const DESIGN_ORIGIN = "https://design.agent-native.com";

export const designMcpAppResourceMeta = {
  csp: {
    connectDomains: [DESIGN_ORIGIN, "https://esm.sh"],
    resourceDomains: [DESIGN_ORIGIN, "https://esm.sh"],
  },
  prefersBorder: true,
};

function attr(value: string | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function designPreviewMcpAppHtml({
  requestOrigin,
}: {
  requestOrigin?: string;
}): string {
  const origin = requestOrigin || DESIGN_ORIGIN;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    body { margin: 0; }
    .shell { display: grid; gap: 12px; padding: 14px; }
    .top { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 15px; line-height: 1.25; font-weight: 750; }
    .muted { color: color-mix(in srgb, CanvasText 58%, Canvas); font-size: 12px; line-height: 1.45; }
    .tabs, .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .actions { justify-content: flex-end; }
    button { border: 1px solid color-mix(in srgb, CanvasText 14%, Canvas); border-radius: 7px; background: Canvas; color: CanvasText; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; min-height: 32px; padding: 0 10px; }
    button[aria-pressed="true"] { border-color: #2563eb; background: #2563eb; color: white; }
    .preview { min-height: 280px; border: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); border-radius: 8px; overflow: auto; background: white; color: #111827; }
    .empty { border: 1px dashed color-mix(in srgb, CanvasText 22%, Canvas); border-radius: 8px; padding: 16px; }
    @media (max-width: 560px) { .top, .actions { align-items: stretch; flex-direction: column; } button { width: 100%; } }
  </style>
</head>
<body data-origin="${attr(origin)}">
  <main id="app" class="shell">
    <div class="empty muted">Loading design</div>
  </main>
  <script type="module">
    import { App } from "${MCP_APP_IMPORT}";

    const root = document.getElementById("app");
    const origin = document.body.dataset.origin || "${DESIGN_ORIGIN}";
    const app = new App({ name: "Agent Native Design Preview", version: "1.0.0" }, {});
    let toolInput = {};
    let toolResult = {};
    let files = [];
    let selected = 0;
    let openUrl = "";

    function esc(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function parseJson(value, fallback) {
      if (Array.isArray(value) || (value && typeof value === "object")) return value;
      if (typeof value !== "string" || !value.trim()) return fallback;
      try { return JSON.parse(value); } catch { return fallback; }
    }

    function parseResult(params) {
      if (!params) return {};
      if (params.structuredContent && typeof params.structuredContent === "object") return params.structuredContent;
      const parts = Array.isArray(params.content) ? params.content : [];
      const textPart = parts.find((part) => part && part.type === "text" && typeof part.text === "string");
      return parseJson(textPart ? textPart.text : "", {});
    }

    function absolutize(url) {
      if (!url) return "";
      try { return new URL(url, origin).toString(); } catch { return ""; }
    }

    function openLinkFrom(params, data) {
      const metaUrl = params && params._meta && params._meta["agent-native/openLink"]
        ? params._meta["agent-native/openLink"].webUrl
        : "";
      return absolutize(metaUrl || data.deepLink || "");
    }

    function collectFiles() {
      const fromInput = parseJson(toolInput.files, []);
      const fromResult = Array.isArray(toolResult.files) ? toolResult.files : [];
      files = (fromResult.some((f) => f && f.content) ? fromResult : fromInput)
        .filter((f) => f && typeof f.content === "string");
      if (selected >= files.length) selected = 0;
    }

    function safePreviewHtml(raw) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(String(raw || ""), "text/html");
      doc.querySelectorAll("script").forEach((node) => node.remove());
      doc.querySelectorAll("*").forEach((node) => {
        for (const attr of [...node.attributes]) {
          if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        }
      });
      const styles = [...doc.querySelectorAll("style")].map((style) => style.textContent || "").join("\\n");
      const body = doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
      return '<style>:host{display:block;min-height:280px;background:white;color:#111827;font-family:ui-sans-serif,system-ui;}*,*:before,*:after{box-sizing:border-box;} ' + styles + '</style>' + body;
    }

    function mountPreview() {
      const host = root.querySelector("[data-preview]");
      if (!host || !files.length) return;
      const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
      shadow.innerHTML = safePreviewHtml(files[selected].content);
    }

    function render() {
      collectFiles();
      if (!files.length) {
        root.innerHTML = '<div class="empty muted">Design files were not available.</div>';
        return;
      }
      const title = toolInput.prompt || toolResult.title || toolResult.designId || "Generated design";
      root.innerHTML =
        '<section class="top"><div><h1>' + esc(title) + '</h1><div class="muted">' + files.length + ' file' + (files.length === 1 ? '' : 's') + '</div></div>' +
        '<div class="actions">' + (openUrl ? '<button type="button" data-open>Open in Design</button>' : '') + '</div></section>' +
        '<nav class="tabs">' + files.map((file, index) => '<button type="button" data-tab="' + index + '" aria-pressed="' + (index === selected ? 'true' : 'false') + '">' + esc(file.filename || "file") + '</button>').join("") + '</nav>' +
        '<section class="preview" data-preview></section>';
      root.querySelectorAll("[data-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          selected = Number(button.dataset.tab) || 0;
          render();
        });
      });
      root.querySelector("[data-open]")?.addEventListener("click", () => {
        if (openUrl) void app.openLink({ url: openUrl });
      });
      mountPreview();
    }

    app.ontoolinput = (params) => {
      toolInput = params.arguments || {};
      render();
    };
    app.ontoolresult = (params) => {
      toolResult = parseResult(params);
      openUrl = openLinkFrom(params, toolResult);
      render();
    };
    await app.connect();
  </script>
</body>
</html>`;
}
