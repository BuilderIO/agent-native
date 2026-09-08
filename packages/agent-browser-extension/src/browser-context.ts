import {
  BROWSER_CONTEXT_V1_SCHEMA,
  type BrowserContextV1,
  type BrowserReadableProjectionV1,
} from "@agent-native/core/browser-context";

const EXTRACTION_LIMITS = {
  textChars: 24_000,
  selectionChars: 2_000,
  blocks: 32,
  blockChars: 500,
  links: 24,
  linkLabelChars: 160,
  linkUrlChars: 1_000,
  scannedTextNodes: 12_000,
} as const;

const EXCLUDED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "CANVAS",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "DATALIST",
]);
const SENSITIVE_QUERY_KEY =
  /(auth|authorization|code|credential|key|password|secret|session|token)/i;

export interface CaptureWindow {
  location: Pick<Location, "href">;
  getComputedStyle(element: Element): CSSStyleDeclaration;
  getSelection(): Selection | null;
}

interface ExtractionStats {
  omittedItems: number;
  omittedBytes: number;
  sourceLimited: boolean;
}

export function extractReadableBrowserContext(
  documentValue: Document,
  windowValue: CaptureWindow,
  options: {
    captureId?: string;
    capturedAt?: string;
  } = {},
): BrowserContextV1 {
  const pageUrl = sanitizeHttpUrl(windowValue.location.href);
  if (!pageUrl)
    throw new Error("Page URL is not a credential-free HTTP(S) URL.");

  const root =
    documentValue.querySelector("main") ??
    documentValue.querySelector("[role='main']") ??
    documentValue.querySelector("article") ??
    documentValue.body ??
    documentValue.documentElement;
  if (!root) throw new Error("The page has no readable document root.");

  const stats: ExtractionStats = {
    omittedItems: 0,
    omittedBytes: 0,
    sourceLimited: false,
  };
  const text = collectVisibleText(
    root,
    documentValue,
    windowValue,
    EXTRACTION_LIMITS.textChars,
    stats,
  );
  const blocks = collectReadableBlocks(root, documentValue, windowValue, stats);
  const links = collectReadableLinks(root, documentValue, windowValue, stats);
  const selection = collectSelection(
    windowValue,
    documentValue.documentElement,
    stats,
  );
  const truncated = stats.omittedItems > 0 || stats.omittedBytes > 0;
  const status: BrowserReadableProjectionV1["status"] = truncated
    ? {
        state: "truncated",
        reason: stats.sourceLimited ? "source-limit" : "item-limit",
        ...(stats.omittedItems ? { omittedItems: stats.omittedItems } : {}),
        ...(stats.omittedBytes ? { omittedBytes: stats.omittedBytes } : {}),
        detail:
          "Readable context was bounded. Hidden content, form values, and full DOM markup were not captured.",
      }
    : { state: "complete" };
  const projection: BrowserReadableProjectionV1 = {
    type: "readable",
    status,
    text,
    ...(selection ? { selection } : {}),
    ...(blocks.length ? { blocks } : {}),
    ...(links.length ? { links } : {}),
  };

  return {
    schema: BROWSER_CONTEXT_V1_SCHEMA,
    captureId: options.captureId ?? crypto.randomUUID(),
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    page: {
      url: pageUrl,
      origin: new URL(pageUrl).origin,
      title: cleanText(documentValue.title).slice(0, 2_048),
    },
    outcome: {
      state: truncated ? "truncated" : "complete",
      projections: [projection],
    },
  };
}

export function createCaptureFailure(
  pageUrl: string,
  code: string,
  message: string,
  retryable: boolean,
): BrowserContextV1 | null {
  const url = sanitizeHttpUrl(pageUrl);
  if (!url) return null;
  return {
    schema: BROWSER_CONTEXT_V1_SCHEMA,
    captureId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    page: { url, origin: new URL(url).origin, title: "" },
    outcome: {
      state: "failure",
      failure: {
        code: cleanText(code).slice(0, 120) || "PAGE_CAPTURE_FAILED",
        message: cleanText(message).slice(0, 4_096) || "Page capture failed.",
        retryable,
      },
    },
  };
}

export function sanitizeHttpUrl(
  value: string,
  maxChars = 8_192,
): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        url.searchParams.set(key, "<redacted>");
      }
    }
    const normalized = url.toString();
    return normalized.length <= maxChars ? normalized : null;
  } catch {
    return null;
  }
}

function collectVisibleText(
  root: Element,
  documentValue: Document,
  windowValue: CaptureWindow,
  maxChars: number,
  stats: ExtractionStats,
): string {
  const walker = documentValue.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  let length = 0;
  let scanned = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    scanned += 1;
    if (scanned > EXTRACTION_LIMITS.scannedTextNodes) {
      stats.sourceLimited = true;
      stats.omittedItems += 1;
      break;
    }
    if (!isReadableTextNode(node, root, windowValue)) continue;
    const text = cleanText(node.textContent ?? "");
    if (!text) continue;
    const separator = chunks.length ? "\n" : "";
    const available = maxChars - length - separator.length;
    if (available <= 0) {
      stats.omittedBytes += new TextEncoder().encode(text).byteLength;
      continue;
    }
    const bounded = text.slice(0, available);
    chunks.push(`${separator}${bounded}`);
    length += separator.length + bounded.length;
    if (bounded.length < text.length) {
      stats.omittedBytes += new TextEncoder().encode(
        text.slice(bounded.length),
      ).byteLength;
    }
  }
  return chunks.join("");
}

function collectReadableBlocks(
  root: Element,
  documentValue: Document,
  windowValue: CaptureWindow,
  stats: ExtractionStats,
): NonNullable<BrowserReadableProjectionV1["blocks"]> {
  const selectors = "h1,h2,h3,h4,h5,h6,p,li,td,th,pre,blockquote";
  const elements = root.matches(selectors)
    ? [root, ...root.querySelectorAll(selectors)]
    : [...root.querySelectorAll(selectors)];
  const blocks: NonNullable<BrowserReadableProjectionV1["blocks"]> = [];

  for (const element of elements) {
    if (blocks.length >= EXTRACTION_LIMITS.blocks) {
      stats.omittedItems += 1;
      continue;
    }
    if (!isVisibleElement(element, root, windowValue)) continue;
    const blockStats: ExtractionStats = {
      omittedItems: 0,
      omittedBytes: 0,
      sourceLimited: false,
    };
    const text = collectVisibleText(
      element,
      documentValue,
      windowValue,
      EXTRACTION_LIMITS.blockChars,
      blockStats,
    );
    if (!text) continue;
    stats.omittedBytes += blockStats.omittedBytes;
    stats.omittedItems += blockStats.omittedItems;
    stats.sourceLimited ||= blockStats.sourceLimited;
    const heading = /^H([1-6])$/.exec(element.tagName);
    blocks.push({
      role: heading
        ? "heading"
        : element.matches("li")
          ? "list-item"
          : element.matches("td,th")
            ? "table-cell"
            : element.matches("pre")
              ? "code"
              : element.matches("blockquote")
                ? "quote"
                : element.matches("p")
                  ? "paragraph"
                  : "other",
      text,
      ...(heading ? { level: Number(heading[1]) } : {}),
    });
  }
  return blocks;
}

function collectReadableLinks(
  root: Element,
  documentValue: Document,
  windowValue: CaptureWindow,
  stats: ExtractionStats,
): NonNullable<BrowserReadableProjectionV1["links"]> {
  const links: NonNullable<BrowserReadableProjectionV1["links"]> = [];
  for (const element of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (links.length >= EXTRACTION_LIMITS.links) {
      stats.omittedItems += 1;
      continue;
    }
    if (!isVisibleElement(element, root, windowValue)) continue;
    const url = sanitizeHttpUrl(element.href, EXTRACTION_LIMITS.linkUrlChars);
    if (!url) continue;
    const labelStats: ExtractionStats = {
      omittedItems: 0,
      omittedBytes: 0,
      sourceLimited: false,
    };
    const label = collectVisibleText(
      element,
      documentValue,
      windowValue,
      EXTRACTION_LIMITS.linkLabelChars,
      labelStats,
    );
    if (!label) continue;
    stats.omittedBytes += labelStats.omittedBytes;
    links.push({ label, url });
  }
  return links;
}

function collectSelection(
  windowValue: CaptureWindow,
  visibilityRoot: Element,
  stats: ExtractionStats,
): string | undefined {
  const selection = windowValue.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) return;
  const anchor =
    selection.anchorNode.nodeType === Node.ELEMENT_NODE
      ? (selection.anchorNode as Element)
      : selection.anchorNode.parentElement;
  if (
    !anchor ||
    isExcludedElement(anchor) ||
    !isVisibleElement(anchor, visibilityRoot, windowValue)
  ) {
    return;
  }
  const value = cleanText(selection.toString());
  if (!value) return;
  const bounded = value.slice(0, EXTRACTION_LIMITS.selectionChars);
  if (bounded.length < value.length) {
    stats.omittedBytes += new TextEncoder().encode(
      value.slice(bounded.length),
    ).byteLength;
  }
  return bounded;
}

function isReadableTextNode(
  node: Node,
  root: Element,
  windowValue: CaptureWindow,
): boolean {
  const element = node.parentElement;
  return Boolean(element && isVisibleElement(element, root, windowValue));
}

function isVisibleElement(
  element: Element,
  root: Element,
  windowValue: CaptureWindow,
): boolean {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    if (
      isExcludedElement(current) ||
      current.hasAttribute("hidden") ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    const style = windowValue.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false;
    }
    if (current === root) break;
  }
  return true;
}

function isExcludedElement(element: Element): boolean {
  const contentEditable = element.getAttribute("contenteditable");
  return (
    EXCLUDED_TAGS.has(element.tagName) ||
    (contentEditable !== null && contentEditable !== "false")
  );
}

function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
