import { decodeHTML } from "entities";

export interface DesignExportFile {
  filename: string;
  fileType: string | null;
  content: string | null;
}

export interface DesignExportSaveResult {
  filePath?: string;
  saveWarning?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Layers toggled hidden in the editor are only visually suppressed by the
// live editor bridge (which paints `display:none` on
// `[data-agent-native-hidden="true"]` inside the canvas iframe). Exports never
// go through that bridge, so without this rule hidden layers would leak back
// into every exported artifact. Inject the same rule at export time so
// hidden-in-editor stays hidden-in-export.
export const HIDDEN_LAYER_EXPORT_STYLE_MARKER =
  "data-agent-native-export-hidden";
export const HIDDEN_LAYER_EXPORT_CSS = `[data-agent-native-hidden="true"]{display:none!important}`;

/**
 * Wraps the hidden-layer suppression rule in a marked <style> tag so callers
 * can idempotently check whether it's already present (e.g. before injecting
 * into HTML that may have already been through this pipeline).
 */
export function hiddenLayerExportStyleTag(): string {
  return `<style ${HIDDEN_LAYER_EXPORT_STYLE_MARKER}>${HIDDEN_LAYER_EXPORT_CSS}</style>`;
}

/**
 * Injects the hidden-layer suppression rule into a standalone HTML document,
 * before `</head>` when present, otherwise prepended to the document. Safe to
 * call more than once — re-injection is skipped if the marked style tag is
 * already present.
 */
export function injectHiddenLayerExportStyle(html: string): string {
  if (
    new RegExp(`<style[^>]*${HIDDEN_LAYER_EXPORT_STYLE_MARKER}\\b`, "i").test(
      html,
    )
  ) {
    return html;
  }
  const styleTag = hiddenLayerExportStyleTag();
  const closeHead = html.lastIndexOf("</head>");
  if (closeHead !== -1) {
    return `${html.slice(0, closeHead)}${styleTag}\n${html.slice(closeHead)}`;
  }
  return `${styleTag}\n${html}`;
}

function extractRenderableHtml(content: string): string {
  const bodyMatch = content.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  return content;
}

export function safeExportBaseName(title: string | null | undefined): string {
  const safe = (title || "design")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "design";
}

export function exportFilename(
  title: string | null | undefined,
  extension: string,
): string {
  return `${safeExportBaseName(title)}-${Date.now()}.${extension}`;
}

export function buildStandaloneHtml(args: {
  title: string;
  files: DesignExportFile[];
}): string {
  const { title, files } = args;
  const cssFiles = files.filter((f) => f.fileType === "css");
  const htmlFiles = files.filter((f) => f.fileType === "html");
  const jsxFiles = files.filter((f) => f.fileType === "jsx");
  const indexHtml =
    files.find((f) => f.filename === "index.html") ?? htmlFiles[0];
  const combinedCss = cssFiles
    .map((f) => f.content ?? "")
    .join("\n\n")
    .replace(/<\/style/gi, "<\\/style");

  if (
    indexHtml?.content &&
    /<!doctype html|<html[\s>]/i.test(indexHtml.content)
  ) {
    let html = indexHtml.content;
    // Merge non-index HTML/JSX files into the body of the standalone document
    // so multi-file designs still ship in one bundle.
    const extraBody = [...htmlFiles, ...jsxFiles]
      .filter((f) => f !== indexHtml)
      .map((f) => extractRenderableHtml(f.content ?? ""))
      .join("\n\n");
    if (extraBody.trim()) {
      // Inline JS / template literals can contain `</body>` strings, so favor
      // the final document boundary.
      const closeBody = html.lastIndexOf("</body>");
      if (closeBody !== -1) {
        html = `${html.slice(0, closeBody)}${extraBody}\n${html.slice(closeBody)}`;
      } else {
        html = `${html}\n${extraBody}`;
      }
    }

    // Idempotency: if a prior export already injected this CSS block, skip
    // re-injection so repeated exports don't duplicate the style tag.
    if (
      combinedCss.trim() &&
      !/<style[^>]*data-agent-native-export\b/i.test(html)
    ) {
      const styleBlock = `<style data-agent-native-export>\n${combinedCss}\n</style>`;
      const closeHead = html.lastIndexOf("</head>");
      if (closeHead !== -1) {
        html = `${html.slice(0, closeHead)}${styleBlock}\n${html.slice(closeHead)}`;
      } else {
        html = `${styleBlock}\n${html}`;
      }
    }

    return injectHiddenLayerExportStyle(html);
  }

  const combinedBody = [...htmlFiles, ...jsxFiles]
    .map((f) => extractRenderableHtml(f.content ?? ""))
    .join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>
  <style>
    ${combinedCss}
  </style>
  ${hiddenLayerExportStyleTag()}
</head>
<body>
  ${combinedBody}
</body>
</html>`;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isStaticXmlAttributeName(name: string): boolean {
  if (
    name.startsWith("@") ||
    name.startsWith(":") ||
    /^x-(?:data|init|show|cloak|if|for|transition|on|bind|model|text|html|ref|teleport|id|effect|ignore)(?:$|[.:])/i.test(
      name,
    )
  ) {
    return false;
  }
  if (/^on/i.test(name)) return false;
  // Preserve the standard namespaces used by inline SVG icons. Other colon
  // prefixes are unbound in raw HTML and would make the enclosing XML invalid.
  return (
    /^(?:xmlns:xlink|xlink:href|xml:lang|xml:space)$/i.test(name) ||
    /^[A-Za-z_][A-Za-z0-9._-]*$/.test(name)
  );
}

function unquotedAttributeValue(valueSuffix: string): string {
  const equals = valueSuffix.indexOf("=");
  if (equals === -1) return "";
  const raw = valueSuffix.slice(equals + 1).trim();
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function isStaticXmlAttributeValue(name: string, valueSuffix: string): boolean {
  const value = unquotedAttributeValue(valueSuffix);
  if (
    /^(?:href|src|action|formaction|poster|xlink:href)$/i.test(name) &&
    (/^(?:javascript|vbscript):/i.test(value.trim()) ||
      (/^data:/i.test(value.trim()) &&
        !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value.trim())))
  ) {
    return false;
  }
  if (
    name.toLowerCase() === "style" &&
    /(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value)
  ) {
    return false;
  }
  return true;
}

/**
 * Convert one HTML start tag into XML-safe XHTML without touching quoted
 * values. This is a small stateful tokenizer rather than a directive-specific
 * regex: it handles arbitrary whitespace, quoted `>` characters, boolean
 * attributes, and any future framework shorthand whose name is not an XML
 * QName. Runtime directives are deliberately omitted because an exported SVG
 * is a static snapshot and cannot run the source framework scripts.
 */
function normalizeStartTagForXml(tag: string): string {
  let cursor = 1;
  while (cursor < tag.length && !/[\s/>]/.test(tag[cursor]!)) cursor += 1;
  let output = tag.slice(0, cursor);

  while (cursor < tag.length) {
    const whitespaceStart = cursor;
    while (cursor < tag.length && /\s/.test(tag[cursor]!)) cursor += 1;
    const whitespace = tag.slice(whitespaceStart, cursor);
    if (tag.startsWith("/>", cursor) || tag[cursor] === ">") {
      return output + whitespace + tag.slice(cursor);
    }

    const nameStart = cursor;
    while (cursor < tag.length && !/[\s=/>]/.test(tag[cursor]!)) cursor += 1;
    const name = tag.slice(nameStart, cursor);
    if (!name) return output + whitespace + tag.slice(cursor);

    const afterNameStart = cursor;
    while (cursor < tag.length && /\s/.test(tag[cursor]!)) cursor += 1;
    let valueSuffix = tag.slice(afterNameStart, cursor);
    let hasValue = false;
    if (tag[cursor] === "=") {
      hasValue = true;
      const equalsStart = cursor;
      cursor += 1;
      while (cursor < tag.length && /\s/.test(tag[cursor]!)) cursor += 1;
      if (tag[cursor] === '"' || tag[cursor] === "'") {
        const quote = tag[cursor]!;
        cursor += 1;
        while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
        if (cursor < tag.length) cursor += 1;
      } else {
        while (cursor < tag.length && !/[\s>]/.test(tag[cursor]!)) cursor += 1;
      }
      valueSuffix += tag.slice(equalsStart, cursor);
    }

    if (
      isStaticXmlAttributeName(name) &&
      isStaticXmlAttributeValue(name, valueSuffix)
    ) {
      output += `${whitespace}${name}${hasValue ? valueSuffix : '=""'}`;
    }
  }
  return output;
}

function findMatchingElementEnd(
  html: string,
  openEnd: number,
  tagName: string,
): number {
  const tagPattern = new RegExp(`<\\s*(/?)\\s*${tagName}\\b`, "gi");
  tagPattern.lastIndex = openEnd + 1;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    let end = match.index + match[0].length;
    let quote = "";
    while (end < html.length) {
      const character = html[end]!;
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      end += 1;
    }
    if (end >= html.length) return html.length;
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return end + 1;
    } else if (!/\/\s*>$/.test(html.slice(match.index, end + 1))) {
      depth += 1;
    }
    tagPattern.lastIndex = end + 1;
  }
  return html.length;
}

function normalizeStartTagsForXml(html: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start === -1) return output + html.slice(cursor);
    output += html.slice(cursor, start);
    if (html.startsWith("<!--", start) || html.startsWith("<![CDATA[", start)) {
      const marker = html.startsWith("<!--", start) ? "-->" : "]]>";
      const end = html.indexOf(marker, start + 4);
      if (end === -1) return output + html.slice(start);
      output += html.slice(start, end + marker.length);
      cursor = end + marker.length;
      continue;
    }
    if (/^<\s*[!/?]/.test(html.slice(start))) {
      const end = html.indexOf(">", start + 1);
      if (end === -1) return output + html.slice(start);
      output += html.slice(start, end + 1);
      cursor = end + 1;
      continue;
    }

    let end = start + 1;
    let quote = "";
    while (end < html.length) {
      const character = html[end]!;
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      end += 1;
    }
    if (end >= html.length) return output + html.slice(start);
    const tag = html.slice(start, end + 1);
    const openingTagName = /^<\s*([A-Za-z][A-Za-z0-9:-]*)\b/.exec(tag)?.[1];
    const editorChromeElement =
      /\bdata-agent-native-(?:editor-chrome|edit-overlay|edit-handle|edge-handle|rotate-handle|transform-badge|spacing-badge|spacing-overlay|spacing-line|spacing-region|insertion-guide|measurement-overlay)\b/i.test(
        tag,
      );
    if (
      openingTagName &&
      (editorChromeElement ||
        /^(?:script|iframe|object|embed|base|foreignObject|animate|set)$/i.test(
          openingTagName,
        ))
    ) {
      const isVoid =
        /^(?:embed|base)$/i.test(openingTagName) || /\/\s*>$/.test(tag);
      if (isVoid) {
        cursor = end + 1;
        continue;
      }
      cursor = findMatchingElementEnd(html, end, openingTagName);
      continue;
    }
    output += normalizeStartTagForXml(tag);
    cursor = end + 1;

    const rawTag = /^<\s*(script|style)\b/i.exec(tag)?.[1];
    if (rawTag) {
      const closePattern = new RegExp(`<\\/\\s*${rawTag}\\s*>`, "i");
      const rest = html.slice(cursor);
      const close = closePattern.exec(rest);
      if (!close?.index) {
        if (!close) return output + rest;
      }
      if (close) {
        const closeEnd = cursor + close.index + close[0].length;
        output += html.slice(cursor, closeEnd);
        cursor = closeEnd;
      }
    }
  }
  return output;
}

function normalizeHtmlForSvg(html: string): string {
  const withoutDoctype = html.replace(/<!doctype[^>]*>/i, "").trim();
  const withXmlSafeTags = normalizeStartTagsForXml(withoutDoctype);
  const withClosedVoidElements = withXmlSafeTags.replace(
    /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*)>/gi,
    (match, tag: string, attrs: string) => {
      if (/\/\s*>$/.test(match)) return match;
      return `<${tag}${attrs} />`;
    },
  );
  const withXmlEntities = withClosedVoidElements.replace(
    /&([A-Za-z][A-Za-z0-9]+);/g,
    (entity, name: string) => {
      if (/^(?:amp|lt|gt|quot|apos)$/i.test(name)) return entity;
      const decoded = decodeHTML(entity);
      if (decoded === entity) return `&amp;${name};`;
      return Array.from(decoded)
        .map((character) => `&#${character.codePointAt(0)};`)
        .join("");
    },
  );
  const withEscapedBareAmpersands = withXmlEntities.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g,
    "&amp;",
  );

  // Wrap <script> and <style> block content in CDATA so that JS/CSS with
  // raw `<`, `>`, or `&&` survives the XML parse required by SVG foreignObject.
  const withCdata = withEscapedBareAmpersands
    .replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (_, open: string, content: string, close: string) => {
        if (content.includes("//]]>")) return _;
        return `${open}//<![CDATA[\n${content}\n//]]>${close}`;
      },
    )
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_, open: string, content: string, close: string) => {
        if (content.includes("]]>")) return _;
        return `${open}<![CDATA[\n${content}\n]]>${close}`;
      },
    );

  if (/<html\b[^>]*\bxmlns=/i.test(withCdata)) {
    return withCdata;
  }

  if (/<html\b/i.test(withCdata)) {
    return withCdata.replace(
      /<html\b/i,
      '<html xmlns="http://www.w3.org/1999/xhtml"',
    );
  }

  return `<html xmlns="http://www.w3.org/1999/xhtml"><body>${withCdata}</body></html>`;
}

export function buildSvgForeignObject(args: {
  html: string;
  width: number;
  height: number;
  title?: string | null;
}): string {
  const width = Math.max(1, Math.round(args.width));
  const height = Math.max(1, Math.round(args.height));
  const title = args.title ? escapeXmlAttribute(args.title) : "Design export";
  const html = normalizeHtmlForSvg(args.html);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <foreignObject width="${width}" height="${height}">
${html}
  </foreignObject>
</svg>`;
}

function getExportDir(path: typeof import("path")): string {
  if (process.env.NODE_ENV === "production") {
    return path.join(process.cwd(), "data", "exports");
  }

  return path.join(
    process.cwd(),
    "node_modules",
    ".cache",
    "agent-native-design",
    "exports",
  );
}

export async function trySaveExportFile(
  filename: string,
  contents: string | Uint8Array,
): Promise<DesignExportSaveResult> {
  const fs = await import("fs");
  const path = await import("path");
  const exportDir = getExportDir(path);
  const filePath = path.join(exportDir, filename);

  try {
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(filePath, contents);
    return { filePath };
  } catch (error) {
    console.warn("Design export server-side save skipped:", error);
    return {
      saveWarning:
        "Could not save a server-side copy, but the download payload was created.",
    };
  }
}
