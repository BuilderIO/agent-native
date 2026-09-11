import { normalizePoisonedBoardNestedCoords } from "@shared/board-file";
import type { CodeLayerNode } from "@shared/code-layer";

import { authoredElementPosition } from "@/components/design/multi-screen/primitive-drop-target";

import { escapeHtmlAttributeValue } from "./dom-utils";

const ABS_POSITION_PROPS = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
] as const;

// Flex/grid-item-only inline properties. Mirrors FLEX_ITEM_INLINE_PROPS in
// editor-chrome.bridge.ts's prepareFlowMembersForAbsoluteDrop (the live
// in-iframe optimistic strip) — a former flow child persisted here as
// position:absolute must lose these too, or the source round-trip re-adds
// back exactly the flex-item styling the live DOM already dropped, and any
// later reparent back into flow (including undo) resurrects a stale,
// source-parent-relative grow/shrink/basis/align-self/order.
const FLEX_ITEM_PROPS = [
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "order",
] as const;

/**
 * Remove absolute-positioning style properties from the element identified by
 * `data-agent-native-node-id` so that it becomes a flow child after being
 * reparented into a container. Returns the updated HTML, or the original HTML
 * if the node cannot be found or parsing is unavailable.
 *
 * Uses DOMParser + CSSStyleDeclaration.removeProperty() rather than
 * applyVisualEdit({kind:"style",value:""}) because the substrate rejects
 * empty-string values in isSafeStyleValue, making that approach a silent no-op.
 */
export function removeAbsolutePositioningFromNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    for (const prop of ABS_POSITION_PROPS) {
      element.style.removeProperty(prop);
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

/** Root-absolute authored left/top by walking positioned ancestors.
 * A node's own computed left/top is containing-block relative, which is
 * wrong once clones insert at the document root. Returns null when the
 * subject has no inline left/top so callers can fall through to computed
 * styles instead of treating a class-positioned 0,0 walk as resolved. */
export function authoredDocumentPositionForNode(
  content: string,
  nodeAttrId: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined" || !nodeAttrId) return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    );
    if (!element) return null;
    if (!hasResolvableInlineOffset(element)) return null;
    return authoredElementPosition(element);
  } catch {
    // coercion-ok: unreadable HTML is "no authored position", same as a missing node.
    return null;
  }
}

/** Document-root position of the nearest ancestor with inline
 * absolute/fixed/relative/sticky left/top. Used when the subject itself is
 * class-positioned: its computed left/top is containing-block relative, so
 * paste-over adds this ancestor offset instead of writing iframe boundingRect
 * as CSS. Returns null when an in-between ancestor is positioned without
 * resolvable inline coords — that remaining nested class-in-class case
 * cannot be composed from HTML. */
export function authoredContainingBlockPositionForNode(
  content: string,
  nodeAttrId: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined" || !nodeAttrId) return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    );
    if (!element) return null;
    let ancestor = element.parentElement;
    while (ancestor && ancestor.tagName.toLowerCase() !== "body") {
      if (hasResolvableInlineOffset(ancestor)) {
        return authoredElementPosition(ancestor);
      }
      if (isUnresolvedContainingBlock(ancestor)) return null;
      ancestor = ancestor.parentElement;
    }
    return null;
  } catch {
    // coercion-ok: unreadable HTML is "no authored position", same as a missing node.
    return null;
  }
}

function hasResolvableInlineOffset(element: Element): boolean {
  const style = (element as HTMLElement).style;
  const position = style.position;
  if (
    position !== "absolute" &&
    position !== "fixed" &&
    position !== "relative" &&
    position !== "sticky"
  ) {
    return false;
  }
  return (
    Number.isFinite(parseFloat(style.left)) &&
    Number.isFinite(parseFloat(style.top))
  );
}

const POSITION_CLASS_RE =
  /(?:^|\s)(?:!)?(?:absolute|fixed|relative|sticky)(?:\s|$)/;

function isUnresolvedContainingBlock(element: Element): boolean {
  const style = (element as HTMLElement).style;
  const position = style.position;
  if (
    position === "absolute" ||
    position === "fixed" ||
    position === "relative" ||
    position === "sticky"
  ) {
    return !hasResolvableInlineOffset(element);
  }
  const className =
    typeof (element as HTMLElement).className === "string"
      ? (element as HTMLElement).className
      : "";
  return POSITION_CLASS_RE.test(className);
}

/** Persist the bridge's narrow fallback for a flow insertion whose authored
 * stylesheet still resolves the moved child to absolute/fixed after its
 * editable inline/utility positioning has been stripped. `!important` is
 * intentional: the stylesheet declaration that forced this path may itself
 * be important. Left/top are removed because they are inert in static flow
 * and should not become surprising offsets if positioning changes later. */
export function setFlowPositioningOverrideForNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    for (const prop of ABS_POSITION_PROPS) {
      element.style.removeProperty(prop);
    }
    element.style.setProperty("position", "static", "important");
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

function parseInlinePx(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDocumentRootAnchorSelector(selector?: string): boolean {
  if (!selector) return false;
  const normalized = selector.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "body" ||
    normalized === "html" ||
    normalized === "html > body"
  );
}

/** Offset to persist for an absolute-container drop.
 * Inside drops use sourceRect − anchorRect (anchor is the new containing
 * block). Before/after anchors and document-root inside anchors are not
 * that block — use the bridge's already-rebased inline left/top. */
export function rawAbsoluteContainerOffsetFromDrop(args: {
  dropMode?: "flow-insert" | "absolute-container";
  placement: "before" | "after" | "inside";
  sourceRect?: { x: number; y: number };
  anchorRect?: { x: number; y: number };
  inlineStyles?: Record<string, string>;
  anchorSelector?: string;
}): { x: number; y: number } | null {
  if (args.dropMode !== "absolute-container") return null;
  if (
    args.placement === "before" ||
    args.placement === "after" ||
    isDocumentRootAnchorSelector(args.anchorSelector)
  ) {
    const x = parseInlinePx(args.inlineStyles?.left);
    const y = parseInlinePx(args.inlineStyles?.top);
    if (x !== null && y !== null) return { x, y };
  }
  if (!args.sourceRect || !args.anchorRect) return null;
  return {
    x: args.sourceRect.x - args.anchorRect.x,
    y: args.sourceRect.y - args.anchorRect.y,
  };
}

export function setAbsolutePositioningForNodeInHtml(
  content: string,
  nodeAttrId: string,
  point: { x: number; y: number },
  pointerOffset?: { x: number; y: number },
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    element.style.position = "absolute";
    element.style.left = `${Math.round(point.x - (pointerOffset?.x ?? 0))}px`;
    element.style.top = `${Math.round(point.y - (pointerOffset?.y ?? 0))}px`;
    element.style.removeProperty("right");
    element.style.removeProperty("bottom");
    for (const prop of FLEX_ITEM_PROPS) {
      element.style.removeProperty(prop);
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

export function getAbsolutePositioningForNodeInHtml(
  content: string,
  nodeAttrId: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return null;
    // Walk every ancestor up to <body> (authoredElementPosition, shared with
    // MultiScreenCanvas's drop-target math) instead of reading only this
    // node's own inline left/top. A node nested two-plus containers deep has
    // a style.left/top that's relative to its OWN immediate parent, not the
    // screen root, so a flat read here previously fed
    // computeReparentedChildPosition two positions from different coordinate
    // spaces whenever the source/target containers weren't both direct
    // children of the screen root — producing a garbage delta and making the
    // dropped element jump away from the cursor. For a root-level node this
    // walk terminates after one step and returns the exact same left/top as
    // before, so root-level reparents are unaffected.
    return authoredElementPosition(element);
  } catch {
    return null;
  }
}

/**
 * Finding 4: normalizePoisonedBoardNestedCoords (shared/board-file.ts)
 * heuristically rewrites persisted nested board coords with no built-in
 * trace of its own (kept side-effect-free so it stays safely callable from
 * any context — see its doc comment). Every call site that applies its
 * result and persists it goes through this shared logger instead, so a bad
 * heuristic firing in the wild is visible: file id, how many nodes were
 * rebased, and a small before/after sample.
 */
export function warnIfPoisonedBoardCoordsNormalized(
  fileId: string,
  result: ReturnType<typeof normalizePoisonedBoardNestedCoords>,
): void {
  if (!result.changed) return;
  console.warn(
    "[design] normalized poisoned nested board coordinates on load/reparent",
    {
      fileId,
      fixedNodeCount: result.fixedNodeCount,
      samples: result.samples,
    },
  );
}

export function isAbsoluteCodeLayerNode(
  node: CodeLayerNode | null | undefined,
) {
  const position = String(node?.style.position ?? "").toLowerCase();
  return position === "absolute" || position === "fixed";
}

export function setCodeLayerAttributeInHtml(
  content: string,
  node: CodeLayerNode,
  name: string,
  value: string | null,
): string | null {
  if (!node.source) return null;
  const openStart = node.source.openStart;
  const openEnd = node.source.openEnd;
  if (openStart < 0 || openEnd <= openStart || openEnd > content.length) {
    return null;
  }

  const openTag = content.slice(openStart, openEnd);
  const attrPattern = new RegExp(
    `\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>]+))?`,
    "i",
  );
  const replacement =
    value === null || value === ""
      ? ""
      : ` ${name}="${escapeHtmlAttributeValue(value)}"`;

  if (attrPattern.test(openTag)) {
    const nextOpenTag = openTag.replace(attrPattern, replacement);
    return `${content.slice(0, openStart)}${nextOpenTag}${content.slice(openEnd)}`;
  }

  if (value === null || value === "") return content;
  const insertAt = openTag.endsWith("/>") ? openEnd - 2 : openEnd - 1;
  return `${content.slice(0, insertAt)}${replacement}${content.slice(insertAt)}`;
}

/** Scan to the real end of a tag: `[^>]*` stops at a `>` inside a quoted
 *  attribute (an Alpine `x-data="{ w: a > b }"` is enough), which splices the
 *  rewrite into the middle of that attribute. */
function findBodyOpenTag(
  content: string,
): { start: number; end: number; tag: string } | null {
  const match = /<body\b/i.exec(content);
  if (!match) return null;
  let quote: '"' | "'" | null = null;
  for (let i = match.index; i < content.length; i += 1) {
    const char = content[i]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") {
      return {
        start: match.index,
        end: i + 1,
        tag: content.slice(match.index, i + 1),
      };
    }
  }
  return null;
}

/** Quoted or unquoted: `style=background:red` is valid markup, and treating it
 *  as absent appends a second style attribute that HTML then ignores, so the
 *  edit silently does nothing. */
const BODY_STYLE_ATTRIBUTE =
  /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

function decodeHtmlAttributeValue(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Split on top-level `;` only: a `data:` URL and a quoted font stack both
 *  carry semicolons that a naive split truncates. */
function splitStyleDeclarations(style: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let current = "";
  for (const char of style) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Longhands the inspector resolves out of a shorthand. Clearing one has to
 *  drop the shorthand too, or the value it was read from survives and the edit
 *  looks like it did nothing. */
const SHORTHAND_FOR_LONGHAND: Record<string, string> = {
  "background-color": "background",
  "background-image": "background",
  "background-repeat": "background",
  "background-position": "background",
  "background-size": "background",
};

/**
 * Patch the `<body>` open tag's inline styles in place. Surgical on purpose:
 * re-serializing a parsed document rewrites attribute order, entities and
 * self-closing tags across the user's whole file, so this only rewrites the
 * one `style` attribute. Returns null when there is no `<body>` to patch — a
 * URL-backed live screen has none, and silently returning the input would look
 * like a saved edit.
 */
export function setBodyInlineStyles(
  content: string,
  patch: Record<string, string | null>,
): string | null {
  const body = findBodyOpenTag(content);
  if (!body) return null;
  const styleMatch = BODY_STYLE_ATTRIBUTE.exec(body.tag);
  const rawStyle = styleMatch
    ? (styleMatch[3] ?? styleMatch[4] ?? styleMatch[5] ?? "")
    : "";
  // Read through the same decode the browser applies, so an existing
  // `&amp;` in a query string is one `&` here and is re-encoded once below
  // rather than compounding on every save.
  const declarations = new Map<string, string>();
  for (const part of splitStyleDeclarations(
    decodeHtmlAttributeValue(rawStyle),
  )) {
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    const property = part.slice(0, separator).trim().toLowerCase();
    if (!property) continue;
    declarations.set(property, part.slice(separator + 1).trim());
  }
  for (const [property, value] of Object.entries(patch)) {
    const cssProperty = property
      .replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
      .toLowerCase();
    if (value === null || value.trim() === "") {
      declarations.delete(cssProperty);
      const shorthand = SHORTHAND_FOR_LONGHAND[cssProperty];
      if (shorthand) declarations.delete(shorthand);
      continue;
    }
    declarations.set(cssProperty, value.trim());
  }
  const nextStyle = [...declarations]
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
  const replacement = nextStyle
    ? ` style="${escapeHtmlAttributeValue(nextStyle)}"`
    : "";
  const nextTag = styleMatch
    ? body.tag.replace(
        BODY_STYLE_ATTRIBUTE,
        replacement.trimStart() ? replacement : "",
      )
    : `${body.tag.slice(0, -1)}${replacement}>`;
  if (nextTag === body.tag) return content;
  return `${content.slice(0, body.start)}${nextTag}${content.slice(body.end)}`;
}

export function getBodyInlineStyles(content: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const body = doc.body;
    if (!body) return {};
    return {
      backgroundColor: body.style.backgroundColor,
      backgroundImage: body.style.backgroundImage,
      backgroundPosition: body.style.backgroundPosition,
      backgroundRepeat: body.style.backgroundRepeat,
      backgroundSize: body.style.backgroundSize,
      fontFamily: body.style.fontFamily,
      fontSize: body.style.fontSize,
    };
  } catch {
    return {};
  }
}
