import { normalizePoisonedBoardNestedCoords } from "@shared/board-file";
import {
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
  type CodeLayerNode,
} from "@shared/code-layer";

import { authoredElementPosition } from "@/components/design/multi-screen/primitive-drop-target";

import { escapeHtmlAttributeValue, queryUniqueSelector } from "./dom-utils";

const ABS_POSITION_PROPS = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
] as const;

const FLEX_ITEM_PROPS = [
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "order",
] as const;

function isCodeBackedFrame(element: HTMLElement): boolean {
  const primitiveKind = (
    element.getAttribute("data-an-primitive") ||
    element.getAttribute("data-agent-native-primitive") ||
    ""
  ).toLowerCase();
  return primitiveKind === "frame";
}

function patchNodeStyleInHtml(
  content: string,
  nodeAttrId: string,
  mutate: (element: HTMLElement) => void,
): string {
  if (typeof window === "undefined" || !nodeAttrId) return content;
  const targetNodes = buildCodeLayerProjection(content).nodes.filter(
    (node) => node.dataAttributes["data-agent-native-node-id"] === nodeAttrId,
  );
  if (targetNodes.length !== 1) return content;
  const [targetNode] = targetNodes;
  if (!targetNode?.source) return content;

  const doc = new DOMParser().parseFromString(content, "text/html");
  const element = queryUniqueSelector(
    doc,
    `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
  ) as HTMLElement | null;
  if (!element) return content;

  const previousStyle = element.getAttribute("style");
  mutate(element);
  const nextStyle = element.getAttribute("style");
  if (nextStyle === previousStyle) return content;

  const patched = patchCodeLayerNodeAttributes(content, [
    {
      node: targetNode,
      attributes: {
        style: nextStyle || null,
      },
    },
  ]);
  return patched ?? content;
}

export function removeAbsolutePositioningFromNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  return patchNodeStyleInHtml(content, nodeAttrId, (element) => {
    const keepsContainingBlock = isCodeBackedFrame(element);
    for (const prop of ABS_POSITION_PROPS) {
      element.style.removeProperty(prop);
    }
    if (keepsContainingBlock) {
      element.style.setProperty("position", "relative");
      for (const prop of ["left", "top", "right", "bottom"] as const) {
        element.style.setProperty(prop, "auto");
      }
    }
  });
}

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

export function setFlowPositioningOverrideForNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  return patchNodeStyleInHtml(content, nodeAttrId, (element) => {
    const keepsContainingBlock = isCodeBackedFrame(element);
    for (const prop of ABS_POSITION_PROPS) {
      element.style.removeProperty(prop);
    }
    element.style.setProperty(
      "position",
      keepsContainingBlock ? "relative" : "static",
      "important",
    );
    if (keepsContainingBlock) {
      for (const prop of ["left", "top", "right", "bottom"] as const) {
        element.style.setProperty(prop, "auto", "important");
      }
    }
  });
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
  computedSize?: { width?: number; height?: number },
): string {
  return patchNodeStyleInHtml(content, nodeAttrId, (element) => {
    element.style.position = "absolute";
    element.style.left = `${Math.round(point.x - (pointerOffset?.x ?? 0))}px`;
    element.style.top = `${Math.round(point.y - (pointerOffset?.y ?? 0))}px`;
    element.style.removeProperty("right");
    element.style.removeProperty("bottom");
    for (const prop of FLEX_ITEM_PROPS) {
      element.style.removeProperty(prop);
    }
    if (
      computedSize?.width !== undefined &&
      Number.isFinite(computedSize.width) &&
      computedSize.width >= 0
    ) {
      element.style.width = `${computedSize.width}px`;
    }
    if (
      computedSize?.height !== undefined &&
      Number.isFinite(computedSize.height) &&
      computedSize.height >= 0
    ) {
      element.style.height = `${computedSize.height}px`;
    }
  });
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
    return authoredElementPosition(element);
  } catch {
    return null;
  }
}

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

const SHORTHAND_FOR_LONGHAND: Record<string, string> = {
  "background-color": "background",
  "background-image": "background",
  "background-repeat": "background",
  "background-position": "background",
  "background-size": "background",
};

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

const SCREEN_FRAME_RENDER_STYLE =
  /<style\b(?=[^>]*\bdata-agent-native-screen-frame-rendering(?:[=\s>]))[^>]*>[\s\S]*?<\/style\s*>/gi; // i18n-ignore regex syntax is not user-facing text
const SCREEN_DEFAULT_HEIGHT_STYLE =
  /<style\b(?=[^>]*\bdata-agent-native-screen-default-height(?:[=\s>]))[^>]*>[\s\S]*?<\/style\s*>/gi; // i18n-ignore regex syntax is not user-facing text
const SCREEN_HEIGHT_MODE_META =
  /<meta\b(?=[^>]*\bdata-agent-native-screen-height-mode(?:[=\s>]))[^>]*\s*\/?>/gi; // i18n-ignore regex syntax is not user-facing text

/** Toggle the blank Screen viewport floor and mark explicit Hug for the
 * content reporter. Authored page constraints remain intact. */
export function setScreenRootDefaultHeightMode(
  content: string,
  heightMode: "auto" | "fixed" | "hug",
): string {
  const withoutModeMeta = content.replace(SCREEN_HEIGHT_MODE_META, "");
  const withDefaultHeight = withoutModeMeta.replace(
    SCREEN_DEFAULT_HEIGHT_STYLE,
    heightMode === "hug"
      ? "<style data-agent-native-screen-default-height></style>"
      : "<style data-agent-native-screen-default-height>body { min-height: 100vh; }</style>",
  );
  if (heightMode !== "hug") return withDefaultHeight;
  const modeMarker = '<meta data-agent-native-screen-height-mode="hug">';
  if (/<\/head\s*>/i.test(withDefaultHeight)) {
    return withDefaultHeight.replace(/<\/head\s*>/i, `${modeMarker}</head>`);
  }
  if (/<body\b/i.test(withDefaultHeight)) {
    return withDefaultHeight.replace(/<body\b/i, `${modeMarker}<body`);
  }
  return `${modeMarker}${withDefaultHeight}`;
}

export function screenRootFrameRenderingOptions(
  rootStyles: Record<string, string>,
  heightPinned: boolean,
) {
  const hasRadius = [
    rootStyles.borderRadius,
    rootStyles.borderTopLeftRadius,
    rootStyles.borderTopRightRadius,
    rootStyles.borderBottomRightRadius,
    rootStyles.borderBottomLeftRadius,
  ].some((value) =>
    value
      ? value
          .split(/[\s/]+/)
          .some((part) => !/^0(?:\.0+)?(?:px|%)?$/i.test(part))
      : false,
  );
  const opacity = Number.parseFloat(rootStyles.opacity ?? "1");
  return {
    contained: hasRadius || (Number.isFinite(opacity) && opacity < 1),
    clipped: hasRadius,
    heightPinned,
  };
}

export function setScreenRootFrameRenderingStyles(
  content: string,
  options: { contained: boolean; clipped: boolean; heightPinned: boolean },
): string {
  const withoutManagedStyle = content.replace(SCREEN_FRAME_RENDER_STYLE, "");
  if (!options.contained) return withoutManagedStyle;

  const declarations = ["contain: paint"];
  if (options.clipped) declarations.push("overflow: hidden");
  if (options.heightPinned) declarations.push("min-height: 100vh");
  const style = `<style data-agent-native-screen-frame-rendering>body{${declarations.join(";")}}</style>`;
  if (/<\/head\s*>/i.test(withoutManagedStyle)) {
    return withoutManagedStyle.replace(/<\/head\s*>/i, `${style}</head>`);
  }
  if (/<body\b/i.test(withoutManagedStyle)) {
    return withoutManagedStyle.replace(/<body\b/i, `${style}<body`);
  }
  return `${style}${withoutManagedStyle}`;
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
