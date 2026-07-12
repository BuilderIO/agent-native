import { callAction } from "@agent-native/core/client";

export type FigmaSvgCopyErrorCode =
  | "unsupported"
  | "blocked"
  | "write-failed"
  | "render-failed";

export class FigmaSvgCopyError extends Error {
  readonly code: FigmaSvgCopyErrorCode;

  constructor(code: FigmaSvgCopyErrorCode, cause?: unknown) {
    super(`Figma SVG copy ${code}`);
    this.name = "FigmaSvgCopyError";
    this.code = code;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: cause,
      });
    }
  }
}

type ClipboardWriter = Pick<Clipboard, "write"> & {
  writeText?: Clipboard["writeText"];
};

type ClipboardItemConstructor = {
  new (items: Record<string, Blob | Promise<Blob>>): ClipboardItem;
  supports?: (type: string) => boolean;
};

export interface FigmaSvgExportActionResult {
  ok: boolean;
  reason?: string;
  svg?: string;
  filename?: string;
  report?: unknown;
}

export interface FigmaSvgExportParams {
  designId?: string;
  fileId?: string;
  filename?: string;
  nodeId?: string;
  embedImages?: boolean;
  width?: number;
  height?: number;
}

export interface LiveFigmaSvgSource {
  /** The already-rendered preview document. Geometry comes from this live DOM. */
  document: Document;
  /** Optional explicit root. Defaults to nodeId, then document.body. */
  root?: Element | null;
  /** Stored screen geometry wins over a transient iframe viewport when supplied. */
  width?: number | null;
  height?: number | null;
  title?: string | null;
}

export interface LiveFigmaSvgSnapshot {
  /** Script-free runtime snapshot supplied by the localhost editor bridge. */
  html: string;
  width?: number | null;
  height?: number | null;
  title?: string | null;
}

export interface FigmaSvgCopyEnvironment {
  clipboard?: ClipboardWriter | null;
  ClipboardItem?: ClipboardItemConstructor | null;
  /** Injectable override for tests — defaults to the real `callAction`. */
  callExportAction?: (
    params: FigmaSvgExportParams,
  ) => Promise<FigmaSvgExportActionResult>;
  /**
   * Prefer the browser's already-rendered iframe DOM. This works in hosted and
   * serverless deployments without shipping Chromium and preserves live Alpine
   * state, loaded fonts, responsive layout, and unsaved visual-edit previews.
   */
  liveSource?: LiveFigmaSvgSource | null;
  /** Cross-origin localhost fallback captured by the trusted editor bridge. */
  liveSnapshot?: LiveFigmaSvgSnapshot | null;
}

const XMLNS = "http://www.w3.org/2000/svg";
const MAX_CLIENT_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
const CLIENT_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function number(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1000) / 1000);
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function transparent(value: string): boolean {
  return (
    !value ||
    value === "transparent" ||
    /rgba?\([^)]*(?:,|\s\/)\s*0(?:\.0+)?\s*\)$/i.test(value)
  );
}

function splitCssList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function simpleBoxShadow(value: string): {
  color: string;
  opacity: number | null;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
} | null {
  const shadow = splitCssList(value)[0]?.trim();
  if (!shadow || /\binset\b/i.test(shadow)) return null;
  const colorMatch = shadow.match(/(?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/i);
  if (!colorMatch) return null;
  const lengths = shadow
    .replace(colorMatch[0], "")
    .trim()
    .match(/^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?$/);
  if (!lengths) return null;

  let color = colorMatch[0];
  let opacity: number | null = null;
  const rgba = color.match(
    /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i,
  );
  const modernRgb = color.match(
    /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)$/i,
  );
  const alphaColor = rgba ?? modernRgb;
  if (alphaColor) {
    color = `rgb(${alphaColor[1]}, ${alphaColor[2]}, ${alphaColor[3]})`;
    opacity = Math.max(0, Math.min(1, Number(alphaColor[4])));
  }

  return {
    color,
    opacity,
    offsetX: Number(lengths[1]),
    offsetY: Number(lengths[2]),
    blur: Number(lengths[3]),
    spread: Number(lengths[4] ?? 0),
  };
}

function svgGradientFill(
  backgroundImage: string,
  nextId: () => string,
  defs: string[],
): string | null {
  const match = backgroundImage.match(/^(linear|radial)-gradient\((.*)\)$/i);
  if (!match) return null;
  const parts = splitCssList(match[2]);
  let angle = 180;
  if (match[1].toLowerCase() === "linear" && /deg$/i.test(parts[0] || "")) {
    angle = Number.parseFloat(parts.shift() || "180") || 180;
  }
  const stops = parts.map((part, index) => {
    const stopMatch = part.match(/^(.*?)(?:\s+(-?[\d.]+)%?)?$/);
    const color = stopMatch?.[1]?.trim() || part;
    const explicit = stopMatch?.[2];
    const offset = explicit
      ? Math.max(0, Math.min(100, Number(explicit)))
      : parts.length <= 1
        ? 0
        : (index / (parts.length - 1)) * 100;
    return `<stop offset="${number(offset)}%" stop-color="${xml(color)}"/>`;
  });
  if (stops.length === 0) return null;
  const gradientId = nextId();
  if (match[1].toLowerCase() === "radial") {
    defs.push(
      `<radialGradient id="${gradientId}" cx="50%" cy="50%" r="50%">${stops.join("")}</radialGradient>`,
    );
  } else {
    defs.push(
      `<linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(${number(angle - 90)} .5 .5)">${stops.join("")}</linearGradient>`,
    );
  }
  return `url(#${gradientId})`;
}

function safeClientFilename(title: string | null | undefined): string {
  const safe = (title || "design")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${safe || "design"}-figma-${Date.now()}.svg`;
}

function queryNodeById(doc: Document, nodeId: string): Element | null {
  for (const element of Array.from(
    doc.querySelectorAll("[data-agent-native-node-id]"),
  )) {
    if (element.getAttribute("data-agent-native-node-id") === nodeId) {
      return element;
    }
  }
  return null;
}

function directText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

interface MeasuredTextLine {
  text: string;
  left: number;
  top: number;
}

function measuredDirectTextLines(element: Element): MeasuredTextLine[] | null {
  const textNodes = Array.from(element.childNodes).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE,
  );
  if (textNodes.length !== 1) return null;
  const node = textNodes[0];
  const value = node.textContent ?? "";
  if (!value.trim() || value.length > 10_000) return null;
  const range = element.ownerDocument.createRange();
  if (typeof range.getBoundingClientRect !== "function") return null;

  const lines: Array<MeasuredTextLine & { right: number; bottom: number }> = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index] ?? "";
      if (character === "\n" || character === "\r") continue;
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (!Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
        if (/\s/.test(character) && lines.length) {
          lines[lines.length - 1]!.text += character;
        }
        continue;
      }
      const current = lines[lines.length - 1];
      if (!current || Math.abs(current.top - rect.top) > 1) {
        lines.push({
          text: character,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        });
      } else {
        current.text += character;
        current.left = Math.min(current.left, rect.left);
        current.top = Math.min(current.top, rect.top);
        current.right = Math.max(current.right, rect.right);
        current.bottom = Math.max(current.bottom, rect.bottom);
      }
    }
  } finally {
    range.detach?.();
  }

  return lines
    .map((line) => ({
      text: line.text.trim(),
      left: line.left,
      top: line.top,
    }))
    .filter((line) => line.text);
}

function sanitizeNestedSvg(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll("script, foreignObject")
    .forEach((node) => node.remove());
  for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
      if (
        (attribute.name === "href" || attribute.name === "xlink:href") &&
        /^javascript:/i.test(attribute.value.trim())
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

function liveSvgRoot(source: LiveFigmaSvgSource, nodeId?: string): Element {
  if (nodeId) {
    const selected = queryNodeById(source.document, nodeId);
    if (!selected) {
      throw new Error(`The selected live layer "${nodeId}" no longer exists`);
    }
    return selected;
  }
  const root = source.root ?? source.document.body;
  if (!root)
    throw new Error("The live preview has no renderable document body");
  return root;
}

/**
 * Serialize the already-laid-out iframe DOM to genuine SVG primitives. This
 * deliberately emits no foreignObject: Figma imports the result as editable
 * rectangles, text, images, and native SVG paths instead of one opaque blob.
 */
export function buildFigmaSvgFromLiveDocument(
  source: LiveFigmaSvgSource,
  nodeId?: string,
): FigmaSvgExportActionResult & { svg: string } {
  const doc = source.document;
  const view = doc.defaultView;
  if (!view) throw new Error("The live preview is not attached to a window");
  const root = liveSvgRoot(source, nodeId);
  const rootRect = root.getBoundingClientRect();
  const isDocumentRoot = root === doc.body || root === doc.documentElement;
  const width = positive(source.width)
    ? source.width
    : Math.max(
        1,
        rootRect.width,
        isDocumentRoot ? doc.documentElement.scrollWidth : 0,
        isDocumentRoot ? (doc.body?.scrollWidth ?? 0) : 0,
      );
  const height = positive(source.height)
    ? source.height
    : Math.max(
        1,
        rootRect.height,
        isDocumentRoot ? doc.documentElement.scrollHeight : 0,
        isDocumentRoot ? (doc.body?.scrollHeight ?? 0) : 0,
      );
  const originX = rootRect.left;
  const originY = rootRect.top;
  let id = 0;
  const defs: string[] = [];
  const vectorized: string[] = [];
  const approximated: Array<{ node: string; note: string }> = [];
  const omitted: Array<{ node: string; reason: string }> = [];

  const serialize = (element: Element): string => {
    const style = view.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      element.getAttribute("data-agent-native-hidden") === "true" ||
      element.closest("[data-agent-native-editor-chrome]")
    ) {
      return "";
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return "";
    const x = rect.left - originX;
    const y = rect.top - originY;
    const elementId =
      element.getAttribute("data-agent-native-node-id") || `node-${++id}`;
    const name =
      element.getAttribute("data-agent-native-layer-name") ||
      element.getAttribute("aria-label") ||
      element.tagName.toLowerCase();
    const opacity = Number.parseFloat(style.opacity || "1");
    const opacityAttr = opacity < 1 ? ` opacity="${number(opacity)}"` : "";
    const children = Array.from(element.children).map(serialize).join("");
    const tag = element.tagName.toUpperCase();

    if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK") return "";
    if (tag === "SVG") {
      vectorized.push(elementId);
      return sanitizeNestedSvg(element).replace(
        /^<svg\b([^>]*)>/i,
        (_opening, attributes: string) => {
          const cleanAttributes = attributes.replace(
            /\s(?:x|y|width|height)="[^"]*"/gi,
            "",
          );
          return `<svg x="${number(x)}" y="${number(y)}" width="${number(rect.width)}" height="${number(rect.height)}"${cleanAttributes}>`;
        },
      );
    }
    if (tag === "IMG") {
      const image = element as HTMLImageElement;
      const href = image.currentSrc || image.src;
      if (!href) {
        omitted.push({ node: elementId, reason: "Image has no source" });
        return "";
      }
      vectorized.push(elementId);
      const fit =
        style.objectFit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
      return `<image id="${xml(elementId)}" data-name="${xml(name)}" x="${number(x)}" y="${number(y)}" width="${number(rect.width)}" height="${number(rect.height)}" href="${xml(href)}" preserveAspectRatio="${fit}"${opacityAttr}/>`;
    }

    const radius = Math.max(
      0,
      Number.parseFloat(style.borderTopLeftRadius || "0") || 0,
    );
    const gradientFill = svgGradientFill(
      style.backgroundImage,
      () => `gradient-${++id}`,
      defs,
    );
    if (style.transform && style.transform !== "none") {
      approximated.push({
        node: elementId,
        note: "CSS transform flattened to its rendered bounding box",
      });
    }
    if (
      style.backgroundImage &&
      style.backgroundImage !== "none" &&
      !gradientFill
    ) {
      approximated.push({
        node: elementId,
        note: "Unsupported CSS background image omitted",
      });
    }
    if (style.clipPath && style.clipPath !== "none") {
      approximated.push({
        node: elementId,
        note: "CSS clip-path is not preserved in this SVG export",
      });
    }
    if (
      style.overflow === "hidden" ||
      style.overflow === "clip" ||
      style.overflowX === "hidden" ||
      style.overflowX === "clip" ||
      style.overflowY === "hidden" ||
      style.overflowY === "clip"
    ) {
      approximated.push({
        node: elementId,
        note: "Overflow clipping is approximated; child geometry remains editable",
      });
    }
    const fill =
      gradientFill ??
      (transparent(style.backgroundColor) ? "none" : style.backgroundColor);
    const borderWidth = Number.parseFloat(style.borderTopWidth || "0") || 0;
    const stroke =
      borderWidth > 0 && style.borderTopStyle !== "none"
        ? style.borderTopColor
        : "none";
    const dash =
      style.borderTopStyle === "dashed" || style.borderTopStyle === "dotted"
        ? ` stroke-dasharray="${number(borderWidth * 3)} ${number(borderWidth * 2)}"`
        : "";
    let filter = "";
    if (style.boxShadow && style.boxShadow !== "none") {
      const shadow = simpleBoxShadow(style.boxShadow);
      if (shadow) {
        const filterId = `shadow-${++id}`;
        const floodOpacity =
          shadow.opacity === null
            ? ""
            : ` flood-opacity="${number(shadow.opacity)}"`;
        defs.push(
          `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${number(shadow.offsetX)}" dy="${number(shadow.offsetY)}" stdDeviation="${number(shadow.blur / 2)}" flood-color="${xml(shadow.color)}"${floodOpacity}/></filter>`,
        );
        filter = ` filter="url(#${filterId})"`;
        if (shadow.spread !== 0 || splitCssList(style.boxShadow).length > 1) {
          approximated.push({
            node: elementId,
            note: "Shadow spread or additional shadows approximated",
          });
        }
      } else {
        approximated.push({
          node: elementId,
          note: "Complex box shadow omitted",
        });
      }
    }

    const text = directText(element);
    const shapeNeeded =
      fill !== "none" || stroke !== "none" || radius > 0 || filter !== "";
    const shape = shapeNeeded
      ? `<rect id="${xml(elementId)}" data-name="${xml(name)}" x="${number(x)}" y="${number(y)}" width="${number(rect.width)}" height="${number(rect.height)}" rx="${number(Math.min(radius, rect.width / 2, rect.height / 2))}" fill="${xml(fill)}" stroke="${xml(stroke)}" stroke-width="${number(borderWidth)}"${dash}${opacityAttr}${filter}/>`
      : "";
    let textNode = "";
    if (text) {
      const fontSize = Number.parseFloat(style.fontSize || "16") || 16;
      const align = style.textAlign;
      const anchor =
        align === "center"
          ? "middle"
          : align === "right" || align === "end"
            ? "end"
            : "start";
      const paddingLeft = Number.parseFloat(style.paddingLeft || "0") || 0;
      const paddingRight = Number.parseFloat(style.paddingRight || "0") || 0;
      const paddingTop = Number.parseFloat(style.paddingTop || "0") || 0;
      const paddingBottom = Number.parseFloat(style.paddingBottom || "0") || 0;
      const contentWidth = Math.max(0, rect.width - paddingLeft - paddingRight);
      const textX =
        anchor === "middle"
          ? x + paddingLeft + contentWidth / 2
          : anchor === "end"
            ? x + rect.width - paddingRight
            : x + paddingLeft;
      const lineHeight =
        Number.parseFloat(style.lineHeight || "") || fontSize * 1.2;
      const contentHeight = Math.max(
        0,
        rect.height - paddingTop - paddingBottom,
      );
      const textY =
        y +
        paddingTop +
        Math.max(fontSize, (contentHeight - lineHeight) / 2 + fontSize);
      const measuredLines = measuredDirectTextLines(element);
      const textContent =
        measuredLines && measuredLines.length > 1
          ? measuredLines
              .map(
                (line) =>
                  `<tspan x="${number(line.left - originX)}" y="${number(line.top - originY + fontSize)}">${xml(line.text)}</tspan>`,
              )
              .join("")
          : xml(text);
      textNode = `<text data-name="${xml(name)}" x="${number(textX)}" y="${number(textY)}" fill="${xml(style.color)}" font-family="${xml(style.fontFamily)}" font-size="${number(fontSize)}" font-weight="${xml(style.fontWeight)}" font-style="${xml(style.fontStyle)}" letter-spacing="${xml(style.letterSpacing)}" text-anchor="${anchor}"${opacityAttr}>${textContent}</text>`;
    }
    if (shape || textNode) vectorized.push(elementId);
    return `${shape}${textNode}${children}`;
  };

  const body = serialize(root);
  if (!body)
    throw new Error("The live preview has no visible exportable layers");
  const title = source.title ? `<title>${xml(source.title)}</title>` : "";
  const defsMarkup = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  return {
    ok: true,
    svg:
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="${XMLNS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}">${title}${defsMarkup}${body}</svg>`,
    filename: safeClientFilename(source.title),
    report: {
      source: "live-dom",
      vectorized,
      approximated,
      rasterized: [],
      omitted,
      warnings:
        approximated.length > 0
          ? [
              "Some live CSS effects were flattened or omitted; inspect the approximations report.",
            ]
          : [],
      vectorizedTextCaveat:
        "Figma may convert imported SVG text to outlined vector paths.",
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function embedLiveSvgImages(
  result: FigmaSvgExportActionResult & { svg: string },
): Promise<FigmaSvgExportActionResult & { svg: string }> {
  const parsed = new DOMParser().parseFromString(result.svg, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return result;
  const omitted: Array<{ node: string; reason: string }> = [];
  await Promise.all(
    Array.from(parsed.querySelectorAll("image")).map(async (image) => {
      const href =
        image.getAttribute("href") || image.getAttribute("xlink:href");
      if (!href || !/^https?:\/\//i.test(href)) return;
      try {
        const response = await fetch(href, {
          credentials: "omit",
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        });
        const mimeType = (response.headers.get("content-type") || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        const contentLength = Number(
          response.headers.get("content-length") || 0,
        );
        if (
          !response.ok ||
          !CLIENT_IMAGE_MIME_TYPES.has(mimeType) ||
          (Number.isFinite(contentLength) &&
            contentLength > MAX_CLIENT_EMBEDDED_IMAGE_BYTES)
        ) {
          throw new Error("image response was not safe to embed");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_CLIENT_EMBEDDED_IMAGE_BYTES) {
          throw new Error("image exceeded the embed size limit");
        }
        image.setAttribute(
          "href",
          `data:${mimeType};base64,${bytesToBase64(bytes)}`,
        );
        image.removeAttribute("xlink:href");
      } catch {
        // Do not persist an expiring Figma CDN URL in a supposedly self-
        // contained artifact. A missing image is explicit in the report and
        // safer than an export that silently breaks hours later.
        omitted.push({
          node: image.getAttribute("id") || "image",
          reason: "Remote image could not be safely embedded",
        });
        image.remove();
      }
    }),
  );
  const report =
    result.report && typeof result.report === "object"
      ? (result.report as Record<string, unknown>)
      : {};
  const previousOmitted = Array.isArray(report.omitted) ? report.omitted : [];
  const previousWarnings = Array.isArray(report.warnings)
    ? report.warnings
    : [];
  return {
    ...result,
    svg: new XMLSerializer().serializeToString(parsed.documentElement),
    report: {
      ...report,
      omitted: [...previousOmitted, ...omitted],
      warnings:
        omitted.length > 0
          ? [
              ...previousWarnings,
              "One or more remote images were omitted because they could not be safely embedded.",
            ]
          : previousWarnings,
    },
  };
}

/**
 * Defense-in-depth sanitizer for cross-origin runtime snapshots. The bridge
 * already strips active content before posting; this receiver repeats the
 * policy before assigning srcdoc so a forged/stale message is still inert.
 */
export function sanitizeLiveFigmaSvgSnapshotHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed
    .querySelectorAll(
      "script,iframe,object,embed,base,link,meta,template,noscript,foreignObject,video,audio,source,track,animate,set",
    )
    .forEach((node) => node.remove());
  for (const node of [
    parsed.documentElement,
    ...Array.from(parsed.querySelectorAll("*")),
  ]) {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        name === "autofocus" ||
        name === "action" ||
        name === "formaction" ||
        /javascript\s*:/i.test(attribute.value)
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  }
  let head = parsed.head;
  if (!head) {
    head = parsed.createElement("head");
    parsed.documentElement.prepend(head);
  }
  const csp = parsed.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute(
    "content",
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
  head.prepend(csp);
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

export function prepareLiveFigmaSvgSnapshotFrame(
  iframe: HTMLIFrameElement,
  snapshot: LiveFigmaSvgSnapshot,
): void {
  iframe.setAttribute("aria-hidden", "true");
  // allow-same-origin keeps contentDocument readable; deliberately omit
  // allow-scripts, allow-forms, allow-popups, and allow-top-navigation.
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;inset:auto auto -100000px -100000px;visibility:hidden;pointer-events:none;border:0";
  iframe.style.width = `${positive(snapshot.width) ? snapshot.width : 1440}px`;
  iframe.style.height = `${positive(snapshot.height) ? snapshot.height : 1200}px`;
  iframe.srcdoc = sanitizeLiveFigmaSvgSnapshotHtml(snapshot.html);
}

async function buildFigmaSvgFromLiveSnapshot(
  snapshot: LiveFigmaSvgSnapshot,
  nodeId?: string,
): Promise<FigmaSvgExportActionResult & { svg: string }> {
  if (typeof document === "undefined") {
    throw new Error("Live snapshot rendering requires a browser document");
  }
  const iframe = document.createElement("iframe");
  prepareLiveFigmaSvgSnapshotFrame(iframe, snapshot);
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Live export snapshot timed out")),
        3_000,
      );
      iframe.addEventListener(
        "load",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    const doc = iframe.contentDocument;
    if (!doc?.documentElement) throw new Error("Live snapshot did not render");
    return buildFigmaSvgFromLiveDocument(
      {
        document: doc,
        width: snapshot.width,
        height: snapshot.height,
        title: snapshot.title,
      },
      nodeId,
    );
  } finally {
    iframe.remove();
  }
}

function defaultFigmaSvgCopyEnvironment(): FigmaSvgCopyEnvironment {
  return {
    clipboard:
      typeof navigator === "undefined" ? null : (navigator.clipboard ?? null),
    ClipboardItem:
      typeof globalThis.ClipboardItem === "undefined"
        ? null
        : globalThis.ClipboardItem,
  };
}

function defaultCallExportAction(
  params: FigmaSvgExportParams,
): Promise<FigmaSvgExportActionResult> {
  // Same cast-to-loose-signature pattern as design-save-outbox.ts's
  // `invokeAction` default: the action registry's generated `ActionName`
  // union doesn't need to be threaded through this small client module.
  return (
    callAction as (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<FigmaSvgExportActionResult>
  )("export-design-as-figma-svg", params as unknown as Record<string, unknown>);
}

export function canCopyFigmaSvgToClipboard(
  environment: FigmaSvgCopyEnvironment = defaultFigmaSvgCopyEnvironment(),
): boolean {
  // `text/plain` (the proven Figma-paste MIME — see the export-handoff skill's
  // "Export to Figma (SVG)" section) only needs a plain `clipboard.write` or
  // `writeText`; ClipboardItem is optional (only gates the extra
  // `image/svg+xml` representation).
  return Boolean(
    (environment.clipboard?.write && environment.ClipboardItem) ||
    environment.clipboard?.writeText,
  );
}

function supportsClipboardType(
  ClipboardItemCtor: ClipboardItemConstructor,
  type: string,
): boolean {
  try {
    return (
      typeof ClipboardItemCtor.supports !== "function" ||
      ClipboardItemCtor.supports(type)
    );
  } catch {
    return false;
  }
}

function classifyClipboardWriteError(error: unknown): FigmaSvgCopyErrorCode {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotSupportedError" || error instanceof TypeError)
    return "unsupported";
  return "write-failed";
}

export interface FigmaSvgCopyResult {
  filename: string;
  report: unknown;
}

function actionParams(params: FigmaSvgExportParams): FigmaSvgExportParams {
  return {
    ...(params.designId ? { designId: params.designId } : {}),
    ...(params.fileId ? { fileId: params.fileId } : {}),
    ...(params.filename ? { filename: params.filename } : {}),
    ...(params.nodeId ? { nodeId: params.nodeId } : {}),
    ...(params.embedImages !== undefined
      ? { embedImages: params.embedImages }
      : {}),
    ...(positive(params.width) ? { width: params.width } : {}),
    ...(positive(params.height) ? { height: params.height } : {}),
  };
}

/**
 * Prefer a synchronous live-DOM conversion and retain the action as a fallback
 * for agent calls, non-rendered screens, and browsers that cannot expose the
 * preview document. The live path is what makes exports hosted/serverless-safe.
 */
export async function exportDesignAsFigmaSvg(
  params: FigmaSvgExportParams,
  environment: FigmaSvgCopyEnvironment = defaultFigmaSvgCopyEnvironment(),
): Promise<FigmaSvgExportActionResult & { svg: string }> {
  if (environment.liveSource) {
    try {
      const result = buildFigmaSvgFromLiveDocument(
        environment.liveSource,
        params.nodeId,
      );
      return params.embedImages === false
        ? result
        : await embedLiveSvgImages(result);
    } catch {
      // A detached/cross-origin preview may become unreadable between the menu
      // opening and activation. The authenticated action remains the fallback.
    }
  }
  if (environment.liveSnapshot) {
    try {
      const result = await buildFigmaSvgFromLiveSnapshot(
        environment.liveSnapshot,
        params.nodeId,
      );
      return params.embedImages === false
        ? result
        : await embedLiveSvgImages(result);
    } catch {
      // Snapshot may have expired during a dev-server HMR replacement.
    }
  }
  const callExportAction =
    environment.callExportAction ?? defaultCallExportAction;
  const result = await callExportAction(actionParams(params));
  if (!result.ok || !result.svg) {
    throw new FigmaSvgCopyError(
      "render-failed",
      new Error(result.reason ?? "Figma SVG export failed"),
    );
  }
  return result as FigmaSvgExportActionResult & { svg: string };
}

/**
 * Exports a design screen (or a selected element's subtree via `nodeId`) as
 * a genuinely vector SVG through the `export-design-as-figma-svg` action,
 * then writes it to the system clipboard as BOTH:
 *
 *   - `text/plain` — the raw SVG markup. This is the MIME Figma's own paste
 *     handler reads for "paste as vector shapes"; a `image/svg+xml`-only
 *     clipboard write is NOT enough on its own for a reliable Figma paste.
 *   - `image/svg+xml` — the same markup as a typed image representation,
 *     for any other paste target that specifically requests SVG images.
 *
 * Call this from a user-gesture handler (e.g. a context-menu "Copy as SVG"
 * item) — `clipboard.write` requires transient activation in most browsers,
 * the same reason `copyPngPromiseToClipboard` in `png-clipboard.ts` is
 * gesture-scoped.
 */
export async function copyDesignAsFigmaSvg(
  params: FigmaSvgExportParams,
  environment: FigmaSvgCopyEnvironment = defaultFigmaSvgCopyEnvironment(),
): Promise<FigmaSvgCopyResult> {
  // Callers normally provide only a liveSource/liveSnapshot. Preserve the real
  // browser clipboard defaults instead of treating that partial override as a
  // complete environment (which made the hosted live-DOM path always report
  // "unsupported" despite navigator.clipboard being available).
  const resolvedEnvironment = {
    ...defaultFigmaSvgCopyEnvironment(),
    ...environment,
  };
  if (!canCopyFigmaSvgToClipboard(resolvedEnvironment)) {
    throw new FigmaSvgCopyError("unsupported");
  }

  const clipboard = resolvedEnvironment.clipboard;
  const ClipboardItemCtor = resolvedEnvironment.ClipboardItem;

  let renderError: unknown;
  const exportPromise = exportDesignAsFigmaSvg(
    params,
    resolvedEnvironment,
  ).catch((error: unknown) => {
    renderError =
      error instanceof FigmaSvgCopyError
        ? error
        : new FigmaSvgCopyError("render-failed", error);
    throw renderError;
  });
  // ClipboardItem owns the promises below in real browsers. Keep a separate
  // observer so test doubles or an early clipboard rejection cannot surface an
  // unhandled action/render rejection.
  void exportPromise.catch(() => undefined);

  try {
    if (clipboard?.write && ClipboardItemCtor) {
      // Call clipboard.write while the initiating click/key event still owns
      // transient activation. ClipboardItem deliberately receives pending
      // Blob promises, matching the proven PNG clipboard path; awaiting the
      // server render first makes slow exports fail in Safari and hardened
      // Chromium even though the user invoked the command correctly.
      const textBlobPromise = exportPromise.then(
        (result) => new Blob([result.svg], { type: "text/plain" }),
      );
      void textBlobPromise.catch(() => undefined);
      const items: Record<string, Blob | Promise<Blob>> = {
        "text/plain": textBlobPromise,
      };
      if (supportsClipboardType(ClipboardItemCtor, "image/svg+xml")) {
        const svgBlobPromise = exportPromise.then(
          (result) => new Blob([result.svg], { type: "image/svg+xml" }),
        );
        void svgBlobPromise.catch(() => undefined);
        items["image/svg+xml"] = svgBlobPromise;
      }
      await clipboard.write([new ClipboardItemCtor(items)]);
    } else if (clipboard?.writeText) {
      // No ClipboardItem constructor available — still deliver the SVG
      // markup as text/plain, which is the proven Figma-paste path anyway.
      const result = await exportPromise;
      await clipboard.writeText(result.svg);
    } else {
      throw new FigmaSvgCopyError("unsupported");
    }
  } catch (error) {
    if (error instanceof FigmaSvgCopyError) throw error;
    if (renderError !== undefined) throw renderError;
    throw new FigmaSvgCopyError(classifyClipboardWriteError(error), error);
  }

  const result = await exportPromise;

  return {
    filename: result.filename ?? "design-figma.svg",
    report: result.report,
  };
}
