const MCP_APP_IMPORT =
  "https://esm.sh/@modelcontextprotocol/ext-apps@1.7.2/app-with-deps";
const SLIDES_ORIGIN = "https://slides.agent-native.com";

export const slidesMcpAppResourceMeta = {
  csp: {
    connectDomains: [SLIDES_ORIGIN, "https://esm.sh"],
    resourceDomains: [SLIDES_ORIGIN, "https://esm.sh"],
  },
  prefersBorder: true,
};

function attr(value: string | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function slidesDeckMcpAppHtml({
  requestOrigin,
}: {
  requestOrigin?: string;
}): string {
  const origin = requestOrigin || SLIDES_ORIGIN;
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
    .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    button { border: 1px solid color-mix(in srgb, CanvasText 14%, Canvas); border-radius: 7px; background: Canvas; color: CanvasText; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; min-height: 32px; padding: 0 10px; }
    button:disabled { opacity: .5; cursor: default; }
    .stage { aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); border-radius: 8px; background: white; color: #111827; }
    .empty { border: 1px dashed color-mix(in srgb, CanvasText 22%, Canvas); border-radius: 8px; padding: 16px; }
    @media (max-width: 560px) { .top, .actions { align-items: stretch; flex-direction: column; } button { width: 100%; } }
  </style>
</head>
<body data-origin="${attr(origin)}">
  <main id="app" class="shell">
    <div class="empty muted">Loading deck</div>
  </main>
  <script type="module">
    import { App } from "${MCP_APP_IMPORT}";

    const root = document.getElementById("app");
    const origin = document.body.dataset.origin || "${SLIDES_ORIGIN}";
    const app = new App({ name: "Agent Native Slides Deck", version: "1.0.0" }, {});
    let toolInput = {};
    let toolResult = {};
    let slides = [];
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
      return absolutize(metaUrl || data.deepLink || data.url || "");
    }

    function collectSlides() {
      const fromResult = Array.isArray(toolResult.slides) ? toolResult.slides : [];
      const fromInput = parseJson(toolInput.slides, []);
      slides = (fromResult.length ? fromResult : fromInput)
        .filter((slide) => slide && typeof slide.content === "string");
      if (selected >= slides.length) selected = 0;
    }

    const ALLOWED_TAGS = new Set([
      "a", "article", "aside", "b", "blockquote", "br", "caption", "code", "col", "colgroup",
      "dd", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4",
      "h5", "h6", "header", "hr", "i", "img", "li", "main", "ol", "p", "pre", "section", "small",
      "span", "strong", "style", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
      "tr", "u", "ul",
    ]);
    const DROP_TAGS = new Set([
      "base", "button", "embed", "form", "iframe", "input", "link", "math", "meta", "object",
      "script", "select", "svg", "textarea",
    ]);
    const ALLOWED_ATTRS = new Set([
      "align", "alt", "aria-label", "aria-hidden", "border", "cellpadding", "cellspacing", "class",
      "colspan", "height", "href", "id", "role", "rowspan", "src", "style", "target", "title",
      "valign", "width",
    ]);
    const URL_ATTRS = new Set(["href", "src", "poster", "xlink:href"]);

    function decodeEntities(value) {
      const textarea = document.createElement("textarea");
      let decoded = String(value || "");
      for (let i = 0; i < 3; i++) {
        textarea.innerHTML = decoded;
        const next = textarea.value;
        if (next === decoded) break;
        decoded = next;
      }
      return decoded;
    }

    function sanitizeUrl(rawUrl, kind = "link") {
      const value = String(rawUrl || "").trim();
      if (!value) return "";
      const decoded = decodeEntities(value);
      const lower = decoded.replace(/[\\s\\u0000-\\u001f\\u007f]+/g, "").toLowerCase();
      if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("file:") || lower.startsWith("//")) return "";
      if (lower.startsWith("data:")) {
        return kind === "image" && /^data:image\\/(?:gif|png|jpe?g|webp|avif);base64,/i.test(decoded) ? value : "";
      }
      if (value.startsWith("/") || value.startsWith("#") || value.startsWith("./") || value.startsWith("../")) return value;
      try {
        const url = new URL(decoded, origin);
        return kind === "image"
          ? (url.protocol === "http:" || url.protocol === "https:" ? value : "")
          : (["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? value : "");
      } catch {
        return /^[a-z][a-z\\d+.-]*:/i.test(lower) ? "" : value;
      }
    }

    function sanitizeCssValue(value) {
      const decoded = decodeEntities(value);
      if (/(?:^|[^\\w-])expression\\s*\\(/i.test(decoded) || /(?:java|vb)script\\s*:/i.test(decoded) || /(?:^|[^\\w-])url\\s*\\(/i.test(decoded) || /@import/i.test(decoded) || /-moz-binding/i.test(decoded) || /behavior\\s*:/i.test(decoded)) return "";
      return String(value || "").trim();
    }

    function sanitizeStyle(style) {
      return String(style || "")
        .split(";")
        .map((declaration) => {
          const index = declaration.indexOf(":");
          if (index <= 0) return "";
          const property = declaration.slice(0, index).trim();
          const value = declaration.slice(index + 1).trim();
          if (!/^(?:--)?[a-zA-Z][\\w-]*$/.test(property) || !value) return "";
          const safeValue = sanitizeCssValue(value);
          return safeValue ? property + ": " + safeValue : "";
        })
        .filter(Boolean)
        .join("; ");
    }

    function sanitizeStyleSheet(css) {
      return String(css || "")
        .replace(/@import[^;]+;?/gi, "")
        .replace(/([^{}]+)\\{([^{}]*)\\}/g, (_match, selector, body) => {
          const safeBody = sanitizeStyle(String(body));
          return safeBody ? String(selector).trim() + " { " + safeBody + "; }" : "";
        });
    }

    function cleanNode(node, doc) {
      if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = node.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) return null;
      if (tag === "style") {
        const safeCss = sanitizeStyleSheet(node.textContent || "");
        if (!safeCss.trim()) return null;
        const out = doc.createElement("style");
        out.textContent = safeCss;
        return out;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        const fragment = doc.createDocumentFragment();
        node.childNodes.forEach((child) => {
          const cleaned = cleanNode(child, doc);
          if (cleaned) fragment.appendChild(cleaned);
        });
        return fragment;
      }
      const out = doc.createElement(tag);
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (name.startsWith("on") || name === "srcdoc" || name === "srcset") return;
        if (!ALLOWED_ATTRS.has(name) && !name.startsWith("data-") && !name.startsWith("aria-")) return;
        if (URL_ATTRS.has(name)) {
          const safeUrl = sanitizeUrl(value, tag === "img" ? "image" : "link");
          if (safeUrl) out.setAttribute(name, safeUrl);
          return;
        }
        if (name === "style") {
          const safeStyle = sanitizeStyle(value);
          if (safeStyle) out.setAttribute("style", safeStyle);
          return;
        }
        if (name === "target" && value !== "_blank") return;
        out.setAttribute(name, value);
      });
      if (tag === "a") {
        out.setAttribute("target", "_blank");
        out.setAttribute("rel", "noopener noreferrer");
      }
      node.childNodes.forEach((child) => {
        const cleaned = cleanNode(child, doc);
        if (cleaned) out.appendChild(cleaned);
      });
      return out;
    }

    function sanitizeHtml(raw) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(String(raw || ""), "text/html");
      const fragment = doc.createDocumentFragment();
      doc.head.querySelectorAll("style").forEach((style) => {
        const cleaned = cleanNode(style, doc);
        if (cleaned) fragment.appendChild(cleaned);
      });
      doc.body.childNodes.forEach((child) => {
        const cleaned = cleanNode(child, doc);
        if (cleaned) fragment.appendChild(cleaned);
      });
      const wrapper = doc.createElement("div");
      wrapper.appendChild(fragment);
      return wrapper.innerHTML;
    }

    function safeSlideHtml(raw) {
      return '<style>:host{display:block;width:100%;height:100%;background:white;color:#111827;font-family:ui-sans-serif,system-ui;overflow:hidden;}*,*:before,*:after{box-sizing:border-box;}</style>' + sanitizeHtml(raw);
    }

    function mountSlide() {
      const host = root.querySelector("[data-stage]");
      if (!host || !slides.length) return;
      const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
      shadow.innerHTML = safeSlideHtml(slides[selected].content);
    }

    function render() {
      collectSlides();
      if (!slides.length) {
        root.innerHTML = '<div class="empty muted">Deck slides were not available.</div>';
        return;
      }
      const title = toolResult.title || toolInput.title || "Deck";
      root.innerHTML =
        '<section class="top"><div><h1>' + esc(title) + '</h1><div class="muted">Slide ' + (selected + 1) + ' of ' + slides.length + '</div></div>' +
        '<div class="actions">' +
          '<button type="button" data-prev' + (selected === 0 ? ' disabled' : '') + '>Previous</button>' +
          '<button type="button" data-next' + (selected >= slides.length - 1 ? ' disabled' : '') + '>Next</button>' +
          (openUrl ? '<button type="button" data-open>Open in Slides</button>' : '') +
        '</div></section>' +
        '<section class="stage" data-stage></section>';
      root.querySelector("[data-prev]")?.addEventListener("click", () => {
        selected = Math.max(0, selected - 1);
        render();
      });
      root.querySelector("[data-next]")?.addEventListener("click", () => {
        selected = Math.min(slides.length - 1, selected + 1);
        render();
      });
      root.querySelector("[data-open]")?.addEventListener("click", () => {
        if (openUrl) void app.openLink({ url: openUrl });
      });
      mountSlide();
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
