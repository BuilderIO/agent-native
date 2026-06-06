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
