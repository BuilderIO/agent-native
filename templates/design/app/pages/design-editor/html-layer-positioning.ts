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
  "inset",
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
  changedProperties: readonly string[],
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
  const previousValues = new Map(
    changedProperties.map((property) => [
      property,
      [
        element.style.getPropertyValue(property),
        element.style.getPropertyPriority(property),
      ] as const,
    ]),
  );
  mutate(element);
  const updates = changedProperties.map((property) => ({
    property,
    value: element.style.getPropertyValue(property) || null,
    priority: element.style.getPropertyPriority(property),
  }));
  if (
    updates.every((update) => {
      const previous = previousValues.get(update.property);
      return (
        previous?.[0] === (update.value ?? "") &&
        previous[1] === update.priority
      );
    })
  ) {
    return content;
  }

  const nextStyle = patchInlineStyleDeclarations(previousStyle, updates);
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

function patchInlineStyleDeclarations(
  style: string | null,
  updates: Array<{
    property: string;
    value: string | null;
    priority: string;
  }>,
): string | null {
  const updatesByProperty = new Map(
    updates.map((update) => [update.property.toLowerCase(), update]),
  );
  const updatedProperties = new Set<string>();
  const declarations: string[] = [];

  for (const declaration of splitStyleDeclarations(style ?? "")) {
    if (!declaration.trim()) continue;
    const separator = stylePropertySeparator(declaration);
    const property =
      separator < 0
        ? null
        : declaration
            .slice(0, separator)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .trim()
            .toLowerCase();
    const update = property ? updatesByProperty.get(property) : undefined;
    if (!update) {
      declarations.push(declaration);
      continue;
    }

    updatedProperties.add(update.property.toLowerCase());
    const rawValue = declaration.slice(separator + 1);
    const commentStart = trailingCommentStart(rawValue);
    const trailingComments =
      commentStart < 0 ? "" : rawValue.slice(commentStart);
    if (update.value) {
      declarations.push(
        `${declaration.slice(0, separator + 1)} ${update.value}${update.priority ? " !important" : ""}${trailingComments}`,
      );
    } else if (trailingComments) {
      declarations.push(trailingComments);
    }
  }

  for (const update of updates) {
    const property = update.property.toLowerCase();
    if (!update.value || updatedProperties.has(property)) continue;
    declarations.push(
      `${update.property}: ${update.value}${update.priority ? " !important" : ""}`,
    );
  }

  const nextStyle = declarations.join(";");
  return nextStyle.trim() ? nextStyle : null;
}

export function removeAbsolutePositioningFromNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  return patchNodeStyleInHtml(
    content,
    nodeAttrId,
    ABS_POSITION_PROPS,
    (element) => {
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
    },
  );
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

export function authoredAbsoluteChildOriginForNode(
  content: string,
  parentAttrId: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined" || !parentAttrId) return null;
  const doc = new DOMParser().parseFromString(content, "text/html");
  const parent = doc.querySelector(
    `[data-agent-native-node-id="${CSS.escape(parentAttrId)}"]`,
  );
  if (!parent) return null;
  for (
    let ancestor: Element | null = parent;
    ancestor && ancestor !== doc.documentElement;
    ancestor = ancestor.parentElement
  ) {
    if (isAuthoredPositioned(ancestor)) {
      const position = authoredElementPosition(ancestor);
      const style = (ancestor as HTMLElement).style;
      return {
        x: position.x + (parseInlinePx(style.borderLeftWidth) ?? 0),
        y: position.y + (parseInlinePx(style.borderTopWidth) ?? 0),
      };
    }
  }
  return { x: 0, y: 0 };
}

function isAuthoredPositioned(element: Element): boolean {
  const position = (element as HTMLElement).style.position;
  if (
    position === "absolute" ||
    position === "fixed" ||
    position === "relative" ||
    position === "sticky"
  ) {
    return true;
  }
  const className =
    typeof (element as HTMLElement).className === "string"
      ? (element as HTMLElement).className
      : "";
  return POSITION_CLASS_RE.test(className);
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
  return patchNodeStyleInHtml(
    content,
    nodeAttrId,
    ABS_POSITION_PROPS,
    (element) => {
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
    },
  );
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
  const changedProperties = [
    ...ABS_POSITION_PROPS,
    ...FLEX_ITEM_PROPS,
    ...(computedSize?.width !== undefined &&
    Number.isFinite(computedSize.width) &&
    computedSize.width >= 0
      ? ["width"]
      : []),
    ...(computedSize?.height !== undefined &&
    Number.isFinite(computedSize.height) &&
    computedSize.height >= 0
      ? ["height"]
      : []),
  ];
  return patchNodeStyleInHtml(
    content,
    nodeAttrId,
    changedProperties,
    (element) => {
      element.style.removeProperty("inset");
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
    },
  );
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

// Reads whole tags with their quoted attributes and skips every element whose
// content HTML parses as text (to its end tag, or to EOF when it has none), so
// only the document's own `<body` matches.
const BODY_OPEN_TAG_SCAN =
  /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*|<\/?[A-Za-z][^\s/>]*(?:"[^"]*"|'[^']*'|[^'">])*>/gi;

function findBodyOpenTag(
  content: string,
): { start: number; end: number; tag: string } | null {
  BODY_OPEN_TAG_SCAN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BODY_OPEN_TAG_SCAN.exec(content))) {
    if (/^<body\b/i.test(match[0])) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        tag: match[0],
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
  let escaped = false;
  let comment = false;
  let current = "";
  for (let index = 0; index < style.length; index += 1) {
    const char = style[index]!;
    const next = style[index + 1];
    if (comment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        comment = false;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "/" && next === "*") {
      current += "/*";
      index += 1;
      comment = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
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

function stylePropertySeparator(declaration: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let comment = false;
  for (let index = 0; index < declaration.length; index += 1) {
    const char = declaration[index]!;
    const next = declaration[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        index += 1;
        comment = false;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 1;
      comment = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === ":") return index;
  }
  return -1;
}

function trailingCommentStart(value: string): number {
  const comments: Array<{ start: number; end: number }> = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let commentStart = -1;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    const next = value[index + 1];
    if (commentStart >= 0) {
      if (char === "*" && next === "/") {
        comments.push({ start: commentStart, end: index + 2 });
        commentStart = -1;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "/" && next === "*") {
      commentStart = index;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "\\") escaped = true;
  }

  let cursor = value.length;
  while (cursor > 0 && /\s/u.test(value[cursor - 1]!)) cursor -= 1;
  let previous = comments.find((comment) => comment.end === cursor);
  if (!previous) return -1;
  let start = previous.start;
  cursor = start;
  while (cursor > 0) {
    while (cursor > 0 && /\s/u.test(value[cursor - 1]!)) cursor -= 1;
    previous = comments.find((comment) => comment.end === cursor);
    if (!previous) break;
    start = previous.start;
    cursor = start;
  }
  while (start > 0 && /\s/u.test(value[start - 1]!)) start -= 1;
  return start;
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
    const separator = stylePropertySeparator(part);
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
    const body = new DOMParser().parseFromString(
      findBodyOpenTag(content)?.tag ?? "",
      "text/html",
    ).body;
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
