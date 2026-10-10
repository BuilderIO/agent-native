import { decodeHTML } from "entities";
import { parse } from "parse5";

import { ensureGroupRuntime } from "../../shared/group-runtime.js";
import { parseEffectsFromHtml } from "../../shared/native-effects.js";
import { ensureNativeShaderRuntime } from "../../shared/shader-fills.js";
import {
  isActiveXmlAttributeValue,
  isNonStaticExportElement,
  isStaticXmlAttributeName,
  VOID_NON_STATIC_EXPORT_ELEMENT_RE,
} from "../../shared/xml-export-attributes.js";

export interface DesignExportFile {
  filename: string;
  fileType: string | null;
  content: string | null;
}

export interface DesignExportSaveResult {
  filePath?: string;
  saveWarning?: string;
}

export interface ExportRuntimeLibraries {
  tailwindBrowser: string;
  alpine: string;
}

export interface ExportFontLicense {
  path: string;
  text: string;
}

function embedFontLicenses(
  html: string,
  licenses: readonly ExportFontLicense[],
): string {
  if (!licenses.length) return html;
  const payload = JSON.stringify(licenses).replace(/<\/script/gi, "<\\/script");
  const script = `<script type="text/plain" data-agent-native-export-font-licenses>${payload}</script>`;
  const closeBody = html.lastIndexOf("</body>");
  return closeBody === -1
    ? `${html}\n${script}`
    : `${html.slice(0, closeBody)}${script}\n${html.slice(closeBody)}`;
}

function stripAuthoredNativeApprovals(html: string): string {
  type Node = {
    tagName?: string;
    attrs?: { name: string; value: string }[];
    childNodes?: Node[];
    content?: Node;
    sourceCodeLocation?: { startOffset: number; endOffset: number };
  };
  const ranges: { start: number; end: number }[] = [];
  const walk = (node: Node): void => {
    if (
      node.tagName === "script" &&
      node.attrs?.some(
        (attr) =>
          attr.name === "type" &&
          attr.value === "application/x-agent-native-effect-approvals",
      ) &&
      node.sourceCodeLocation
    ) {
      ranges.push({
        start: node.sourceCodeLocation.startOffset,
        end: node.sourceCodeLocation.endOffset,
      });
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(parse(html, { sourceCodeLocationInfo: true }) as Node);
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    html = html.slice(0, range.start) + html.slice(range.end);
  }
  return html;
}

function embedStandaloneNativeApprovals(
  html: string,
  hashes: readonly string[],
): string {
  const script = `<script type="application/x-agent-native-effect-approvals" data-agent-native-export-approvals>${JSON.stringify({ schemaVersion: 1, hashes })}</script>`;
  const closeBody = html.lastIndexOf("</body>");
  return closeBody === -1
    ? `${html}\n${script}`
    : `${html.slice(0, closeBody)}${script}\n${html.slice(closeBody)}`;
}

export function hasRenderableBoardArtwork(content: string | null): boolean {
  return (
    typeof content === "string" &&
    /data-agent-native-node-id\s*=/.test(extractRenderableHtml(content))
  );
}

function ensureNativeExportRuntime(html: string): string {
  if (!html.includes("application/x-agent-native-effects")) return html;
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length)
    throw new Error(
      `Native effect manifest is unreadable: ${parsed.errors.join("; ")}`,
    );
  return parsed.document?.instances.length
    ? ensureNativeShaderRuntime(html)
    : html;
}

function embeddedLibraryTags(libraries?: ExportRuntimeLibraries): string {
  if (!libraries)
    return `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>`;
  return `<script data-agent-native-export-tailwind>${libraries.tailwindBrowser.replace(/<\/script/gi, "<\\/script")}</script>
  <script data-agent-native-export-alpine>${libraries.alpine.replace(/<\/script/gi, "<\\/script")}</script>`;
}

function replaceKnownLibraryTags(
  html: string,
  libraries?: ExportRuntimeLibraries,
): string {
  if (!libraries) return html;
  return html
    .replace(
      /<script\b[^>]*\bsrc=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@[^"']+["'][^>]*>\s*<\/script>/gi,
      `<script data-agent-native-export-tailwind>${libraries.tailwindBrowser.replace(/<\/script/gi, "<\\/script")}</script>`,
    )
    .replace(
      /<script\b[^>]*\bsrc=["']https:\/\/cdn\.jsdelivr\.net\/npm\/alpinejs@[^"']+\/dist\/cdn(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi,
      `<script data-agent-native-export-alpine>${libraries.alpine.replace(/<\/script/gi, "<\\/script")}</script>`,
    );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const HIDDEN_LAYER_EXPORT_STYLE_MARKER =
  "data-agent-native-export-hidden";
export const HIDDEN_LAYER_EXPORT_CSS = `[data-agent-native-hidden="true"]{display:none!important}`;

export function hiddenLayerExportStyleTag(): string {
  return `<style ${HIDDEN_LAYER_EXPORT_STYLE_MARKER}>${HIDDEN_LAYER_EXPORT_CSS}</style>`;
}

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

function appendToBody(html: string, bodyContent: string): string {
  const closeBody = html.lastIndexOf("</body>");
  return closeBody === -1
    ? `${html}\n${bodyContent}`
    : `${html.slice(0, closeBody)}${bodyContent}\n${html.slice(closeBody)}`;
}

function injectExportCss(html: string, combinedCss: string): string {
  if (
    !combinedCss.trim() ||
    /<style[^>]*data-agent-native-export\b/i.test(html)
  ) {
    return html;
  }
  const styleBlock = `<style data-agent-native-export>
${combinedCss}
</style>`;
  const closeHead = html.lastIndexOf("</head>");
  return closeHead === -1
    ? `${styleBlock}\n${html}`
    : `${html.slice(0, closeHead)}${styleBlock}\n${html.slice(closeHead)}`;
}

function standaloneScreenDocument(args: {
  title: string;
  content: string;
  combinedCss: string;
  runtimeLibraries?: ExportRuntimeLibraries;
}): string {
  const { title, content, combinedCss, runtimeLibraries } = args;
  if (/<!doctype html|<html[\s>]/i.test(content)) {
    return replaceKnownLibraryTags(
      ensureNativeExportRuntime(
        ensureGroupRuntime(
          injectHiddenLayerExportStyle(injectExportCss(content, combinedCss)),
        ),
      ),
      runtimeLibraries,
    );
  }
  const bodyContent = extractRenderableHtml(content);

  return ensureNativeExportRuntime(
    ensureGroupRuntime(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${embeddedLibraryTags(runtimeLibraries)}
  <style data-agent-native-export>
    ${combinedCss}
  </style>
  ${hiddenLayerExportStyleTag()}
</head>
<body>
  ${bodyContent}
</body>
</html>`),
  );
}

function buildStackedScreenHtml(args: {
  title: string;
  screens: DesignExportFile[];
  jsxFiles: DesignExportFile[];
  combinedCss: string;
  runtimeLibraries?: ExportRuntimeLibraries;
  approvedDefinitionHashes?: readonly string[];
  fontLicenses?: readonly ExportFontLicense[];
}): string {
  const {
    title,
    screens,
    jsxFiles,
    combinedCss,
    runtimeLibraries,
    approvedDefinitionHashes = [],
    fontLicenses = [],
  } = args;
  const jsxBody = jsxFiles
    .map((file) => extractRenderableHtml(file.content ?? ""))
    .filter(Boolean)
    .join("\n\n");
  const screenFrames = screens
    .map((screen, index) => {
      const content = screen.content ?? "";
      const screenContent =
        index === 0 && jsxBody ? appendToBody(content, jsxBody) : content;
      const document = standaloneScreenDocument({
        title: screen.filename,
        content: screenContent,
        combinedCss,
        runtimeLibraries,
      });
      return `<iframe
  data-agent-native-export-screen
  title="${escapeHtml(screen.filename)}"
  srcdoc="${escapeHtml(document)}"
></iframe>`;
    })
    .join("\n");

  const approvalScript = approvedDefinitionHashes.length
    ? `<script data-agent-native-export-approval-relay>
  const hashes = ${JSON.stringify(approvedDefinitionHashes)};
  for (const frame of document.querySelectorAll('[data-agent-native-export-screen]')) {
    const send = () => frame.contentWindow?.postMessage({ type: 'native-shader-approvals', status: 'ready', hashes }, window.location.origin);
    frame.addEventListener('load', send);
    if (frame.contentDocument?.readyState === 'complete') send();
  }
</script>`
    : "";

  return embedFontLicenses(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; min-height: 100%; }
    [data-agent-native-export-screens] { display: block; }
    [data-agent-native-export-screen] {
      display: block;
      width: 100%;
      height: 100vh;
      border: 0;
      margin: 0 0 24px;
    }
  </style>
</head>
<body>
  <main data-agent-native-export-screens>
    ${screenFrames}
  </main>
  ${approvalScript}
</body>
</html>`,
    fontLicenses,
  );
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
  screenLayout?: "merged" | "stacked";
  runtimeLibraries?: ExportRuntimeLibraries;
  approvedDefinitionHashes?: readonly string[];
  fontLicenses?: readonly ExportFontLicense[];
}): string {
  const {
    title,
    screenLayout = "merged",
    runtimeLibraries,
    approvedDefinitionHashes = [],
    fontLicenses = [],
  } = args;
  const files = args.files.map((file) => ({
    ...file,
    content:
      file.content === null ? null : stripAuthoredNativeApprovals(file.content),
  }));
  const cssFiles = files.filter((f) => f.fileType === "css");
  const htmlFiles = files.filter((f) => f.fileType === "html");
  const jsxFiles = files.filter((f) => f.fileType === "jsx");
  const indexHtml =
    files.find((f) => f.filename === "index.html") ?? htmlFiles[0];
  const combinedCss = cssFiles
    .map((f) => f.content ?? "")
    .join("\n\n")
    .replace(/<\/style/gi, "<\\/style");

  if (screenLayout === "stacked" && htmlFiles.length > 1) {
    const screens = indexHtml
      ? [indexHtml, ...htmlFiles.filter((file) => file !== indexHtml)]
      : htmlFiles;
    return buildStackedScreenHtml({
      title,
      screens,
      jsxFiles,
      combinedCss,
      runtimeLibraries,
      approvedDefinitionHashes,
      fontLicenses,
    });
  }

  if (
    indexHtml?.content &&
    /<!doctype html|<html[\s>]/i.test(indexHtml.content)
  ) {
    let html = indexHtml.content;
    const extraBody = [...htmlFiles, ...jsxFiles]
      .filter((f) => f !== indexHtml)
      .map((f) => extractRenderableHtml(f.content ?? ""))
      .join("\n\n");
    if (extraBody.trim()) {
      const closeBody = html.lastIndexOf("</body>");
      if (closeBody !== -1) {
        html = `${html.slice(0, closeBody)}${extraBody}\n${html.slice(closeBody)}`;
      } else {
        html = `${html}\n${extraBody}`;
      }
    }

    html = injectExportCss(html, combinedCss);

    return embedFontLicenses(
      embedStandaloneNativeApprovals(
        replaceKnownLibraryTags(
          ensureNativeExportRuntime(
            ensureGroupRuntime(injectHiddenLayerExportStyle(html)),
          ),
          runtimeLibraries,
        ),
        approvedDefinitionHashes,
      ),
      fontLicenses,
    );
  }

  const combinedBody = [...htmlFiles, ...jsxFiles]
    .map((f) => extractRenderableHtml(f.content ?? ""))
    .join("\n\n");

  return embedFontLicenses(
    embedStandaloneNativeApprovals(
      ensureNativeExportRuntime(
        ensureGroupRuntime(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${embeddedLibraryTags(runtimeLibraries)}
  <style>
    ${combinedCss}
  </style>
  ${hiddenLayerExportStyleTag()}
</head>
<body>
  ${combinedBody}
</body>
</html>`),
      ),
      approvedDefinitionHashes,
    ),
    fontLicenses,
  );
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  const raw = unquotedAttributeValue(valueSuffix);
  return (
    !isActiveXmlAttributeValue(name, raw) &&
    !isActiveXmlAttributeValue(name, decodeHTML(raw))
  );
}

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
        isNonStaticExportElement(openingTagName, {
          hasHttpEquiv: /\shttp-equiv\s*=/i.test(tag),
        }))
    ) {
      const isVoid =
        VOID_NON_STATIC_EXPORT_ELEMENT_RE.test(openingTagName) ||
        /\/\s*>$/.test(tag);
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
