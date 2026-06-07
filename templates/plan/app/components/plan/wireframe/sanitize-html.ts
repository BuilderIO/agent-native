/*
 * Render-layer sanitizer for model-authored wireframe HTML.
 *
 * The HTML artboard injects model HTML via dangerouslySetInnerHTML into the LIVE
 * page DOM (it can't be iframe-sandboxed because the rough overlay must measure
 * the laid-out elements). The schema's regex guard is necessary but not
 * sufficient — obfuscated schemes (java\tscript:, &#106;avascript:) slip past
 * string matching. This neutralizes the html at the render point using the
 * browser's OWN parser/URL normalization, which decodes entities and collapses
 * whitespace, so obfuscation can't survive:
 *   - drops dangerous elements (script/style/iframe/object/embed/...);
 *   - strips every on* event-handler attribute;
 *   - removes url attributes whose RESOLVED scheme isn't safe;
 *   - removes inline styles carrying expression()/javascript:/data:text/html.
 * Defense-in-depth: stored content should also be sanitized server-side, but
 * this guarantees the live DOM never carries an executable payload.
 */

const BLOCKED_TAGS =
  "script,style,iframe,object,embed,link,meta,base,form,noscript,frame,frameset,applet,marquee,portal";

const URL_ATTRS = new Set([
  "href",
  "src",
  "xlink:href",
  "srcdoc",
  "action",
  "formaction",
  "background",
  "poster",
  "data",
  "ping",
]);

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "ftp:"]);

const WHITESPACE = /\s+/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);/i;

function isSafeUrl(value: string): boolean {
  // Strip whitespace for scheme detection ONLY (the browser collapses these when
  // resolving too, so obfuscated schemes like "java\tscript:" can't hide). The
  // original attribute is left untouched unless we decide to drop it.
  const v = (value || "").replace(WHITESPACE, "");
  if (
    v === "" ||
    v.startsWith("#") ||
    v.startsWith("/") ||
    v.startsWith("./") ||
    v.startsWith("../")
  ) {
    return true;
  }
  if (!HAS_SCHEME.test(v)) return true; // no scheme => relative, safe
  try {
    const a = document.createElement("a");
    a.href = v; // browser decodes the scheme + normalizes
    const proto = a.protocol.toLowerCase();
    // Allow only safe raster data images; block data:image/svg+xml (can script)
    // and data:text/html.
    if (proto === "data:") return SAFE_DATA_IMAGE.test(a.href);
    return SAFE_SCHEMES.has(proto);
  } catch {
    return false;
  }
}

const DANGEROUS_STYLE =
  /(expression\s*\(|javascript:|vbscript:|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data:text\/html))/i;
const DANGEROUS_CSS =
  /(@(?:import|font-face|keyframes|page|namespace|charset)\b|expression\s*\(|javascript:|vbscript:|data:text\/html|data:image\/svg\+xml|<\/?\s*(?:script|style)\b)/i;
const DANGEROUS_VIEWPORT_CSS =
  /(?:^|[;{\s])position\s*:\s*(?:fixed|sticky)\b|(?:^|[;{\s])z-index\s*:\s*[1-9]\d{4,}\b/i;

function decodeCssSafetyEscapes(value: string): string {
  return value.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_match, escaped) => {
    const hex = String(escaped).match(/^[0-9a-fA-F]{1,6}/)?.[0];
    if (hex) {
      const point = Number.parseInt(hex, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    }
    return String(escaped)[0] ?? "";
  });
}

function cssSafetyText(value: string): string {
  return decodeCssSafetyEscapes(value)
    .toLowerCase()
    .replace(/[\u0000-\u0020]+/g, "");
}

/** Conservative no-DOM fallback for any non-browser code path (SSR). */
function fallbackStrip(html: string): string {
  // Drop the whole url attribute if its value (whitespace/control-stripped)
  // carries a dangerous scheme. Mirrors the DOM path for the rare no-DOMParser
  // case; entity-obfuscation isn't decoded here (the live DOM path handles it).
  const stripScheme = (m: string, dq?: string, sq?: string, uq?: string) => {
    const v = (dq ?? sq ?? uq ?? "").replace(/[\s\u0000-\u001f]+/g, "");
    return /^(?:javascript|vbscript):|^data:text\/html/i.test(v) ? "" : m;
  };
  return html
    .replace(
      /<\/?(?:script|style|iframe|object|embed|link|meta|base|form|noscript|frame|frameset|applet|marquee|portal)\b[^>]*>/gi,
      "",
    )
    .replace(/\son[a-z][\w:-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(?:href|src|xlink:href|action|formaction|poster|background|data|ping)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      stripScheme,
    )
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (m) =>
      DANGEROUS_STYLE.test(m) ? "" : m,
    );
}

export function sanitizeWireframeHtml(html: string | undefined): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return fallbackStrip(html);
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(BLOCKED_TAGS).forEach((el) => el.remove());
  sanitizeElementAttributes(doc.body);
  return doc.body.innerHTML;
}

export function sanitizeWireframeCss(css: string | undefined): string {
  if (!css) return "";
  return css
    .split("\n")
    .filter((line) => {
      const decoded = decodeCssSafetyEscapes(line);
      const compact = cssSafetyText(line);
      return !(
        DANGEROUS_CSS.test(line) ||
        DANGEROUS_CSS.test(decoded) ||
        DANGEROUS_VIEWPORT_CSS.test(decoded) ||
        /(?:javascript|vbscript):|data:(?:text\/html|image\/svg\+xml)|expression\(|url\(['"]?(?:javascript|vbscript|data:(?:text\/html|image\/svg\+xml))/.test(
          compact,
        )
      );
    })
    .join("\n")
    .replace(/\bjava\s*script\s*:/gi, "")
    .replace(/\bvb\s*script\s*:/gi, "")
    .replace(/\bdata\s*:\s*(?:text\/html|image\/svg\+xml)/gi, "");
}

export function scopeDesignCss(css: string, scopeSelector: string): string {
  if (!css.trim()) return "";
  return css.replace(
    /(^|[{}])\s*([^@{}][^{}]*)\{/g,
    (_match, boundary: string, selectors: string) => {
      const scoped = splitSelectorList(selectors)
        .map((selector) => selector.trim())
        .filter(Boolean)
        .map((selector) => {
          if (selector.startsWith(scopeSelector)) return selector;
          if (
            selector === ":root" ||
            selector === "html" ||
            selector === "body"
          )
            return scopeSelector;
          return `${scopeSelector} ${selector}`;
        })
        .join(", ");
      return `${boundary} ${scoped} {`;
    },
  );
}

function splitSelectorList(selectors: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of selectors) {
    current += char;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "," && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current.slice(0, -1));
      current = "";
    }
  }

  parts.push(current);
  return parts;
}

function sanitizeElementAttributes(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style" && DANGEROUS_STYLE.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el instanceof HTMLTemplateElement) {
      sanitizeElementAttributes(el.content);
    }
  });
}
