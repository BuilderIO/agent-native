import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";

const INERT_SNAPSHOT_TAGS = new Set([
  "animate",
  "audio",
  "base",
  "embed",
  "foreignobject",
  "form",
  "frame",
  "iframe",
  "link",
  "meta",
  "noscript",
  "object",
  "script",
  "set",
  "source",
  "style",
  "template",
  "track",
  "video",
]);

function isSafeSnapshotResourceUrl(value: string): boolean {
  const normalized = value.trim();
  if (/^data:image\//i.test(normalized)) return true;
  if (!/^(?:https?:)?\/\//i.test(normalized) || normalized.includes("\\")) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(normalized, "https://snapshot.invalid");
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return false;
  }
  return true;
}

function sanitizeCssUrls(value: string): string {
  return value.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    (match, doubleQuoted: string, singleQuoted: string, bare: string) =>
      isSafeSnapshotResourceUrl(doubleQuoted ?? singleQuoted ?? bare ?? "")
        ? match
        : "none",
  );
}

function sanitizeNode(node: DefaultTreeAdapterTypes.ChildNode): boolean {
  if (!("tagName" in node)) return true;

  if (INERT_SNAPSHOT_TAGS.has(node.tagName.toLowerCase())) return false;

  node.attrs = node.attrs.filter((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (
      name.startsWith("on") ||
      [
        "action",
        "autofocus",
        "formaction",
        "href",
        "srcdoc",
        "srcset",
        "target",
        "xlink:href",
      ].includes(name) ||
      /^(?:javascript|vbscript):/i.test(value)
    ) {
      return false;
    }
    if (["src", "poster"].includes(name)) {
      return isSafeSnapshotResourceUrl(value);
    }
    if (name === "style") attribute.value = sanitizeCssUrls(attribute.value);
    return true;
  });
  node.childNodes = node.childNodes.filter(sanitizeNode);
  return true;
}

/** Remove executable content, navigation controls, and owner-local resources. */
export function sanitizeVisualEditSnapshotHtml(html: string): string {
  const document = parse(html);
  document.childNodes = document.childNodes.filter(sanitizeNode);
  return serialize(document);
}
