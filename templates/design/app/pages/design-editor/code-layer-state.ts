import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerTreeNode,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { isComponentInstance } from "@shared/component-model";
export {
  renameFilenamePreservingExtension,
  replaceDataScreenReferences,
} from "@shared/screen-rename";

import type { LayersPanelNode } from "@/components/design/LayersPanel";
import type { ElementInfo } from "@/components/design/types";

import { queryUniqueSelector } from "./dom-utils";

export function layerTypeForCodeLayer(
  node: CodeLayerTreeNode,
): LayersPanelNode["type"] {
  if (node.type === "group") return "group";
  if (node.type === "component") return "component";
  if (node.type === "ellipse") return "ellipse";
  if (node.type === "shape") return "shape";
  if (node.type === "vector") return "vector";
  if (node.type === "line") return "line";
  if (node.type === "arrow") return "arrow";
  if (node.type === "polygon") return "polygon";
  if (node.type === "star") return "star";
  if (node.type === "text") return "text";
  if (node.type === "image") return "image";
  return "element";
}

export function codeLayerNodeLooksLikeComponent(
  node: CodeLayerNode | null | undefined,
): boolean {
  if (!node) return false;
  if (isComponentInstance(node)) return true;
  const tag = node.tag.toLowerCase();
  if (
    tag === "button" ||
    tag === "input" ||
    tag === "select" ||
    tag === "textarea"
  ) {
    return true;
  }
  if (/component|card|button|control/i.test(node.layerName)) return true;
  return node.classes.some((item) =>
    /component|card|button|control/i.test(item),
  );
}

export function preferredCodeLayerSelector(node: CodeLayerNode): string {
  return (
    node.selectors.find((selector) =>
      /^\[data-(agent-native-node-id|code-layer-id|layer-id|builder-id|loc)=/.test(
        selector,
      ),
    ) ??
    node.path ??
    node.selector
  );
}

export function codeLayerSelectorAliases(
  node: CodeLayerNode | null | undefined,
): string[] {
  if (!node) return [];
  return Array.from(
    new Set(
      [
        preferredCodeLayerSelector(node),
        node.selector,
        node.path,
        ...node.selectors,
      ]
        .map((selector) => selector.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeCodeLayerSelector(selector: string): string {
  return (
    selector
      .trim()
      .replace(/\s*>\s*/g, " > ")
      .replace(/\s+/g, " ")
      // Bridge emits :nth-of-type(1) for first siblings when multiple share a
      // tag; the projection omits the suffix for first occurrences. Strip it so
      // both forms round-trip to the same normalized string.
      .replace(/:nth-of-type\(1\)/g, "")
  );
}

export function codeLayerSelectorPartTag(selectorPart: string): string | null {
  const match = selectorPart.trim().match(/^([A-Za-z][A-Za-z0-9:-]*)/);
  return match?.[1]?.toLowerCase() ?? null;
}

export function stripLeadingDocumentRootSelectorParts(
  selector: string,
): string {
  const parts = normalizeCodeLayerSelector(selector)
    .split(" > ")
    .map((part) => part.trim())
    .filter(Boolean);
  while (
    parts.length > 0 &&
    ["html", "body"].includes(codeLayerSelectorPartTag(parts[0] ?? "") ?? "")
  ) {
    parts.shift();
  }
  return parts.join(" > ");
}

export function codeLayerSelectorMatchTargets(selector: string): string[] {
  return Array.from(
    new Set(
      [
        normalizeCodeLayerSelector(selector),
        stripLeadingDocumentRootSelectorParts(selector),
      ]
        .map((target) => target.trim())
        .filter(Boolean),
    ),
  );
}

export function codeLayerSelectorMatches(
  node: CodeLayerNode | null | undefined,
  selector: string | undefined,
): boolean {
  if (!node || !selector) return false;
  const targets = codeLayerSelectorMatchTargets(selector);
  return codeLayerSelectorAliases(node).some((candidate) => {
    const normalized = normalizeCodeLayerSelector(candidate);
    return targets.some((target) => {
      const targetHasDirectPath = target.includes(" > ");
      return (
        normalized === target ||
        (targetHasDirectPath &&
          normalized.includes(" > ") &&
          (normalized.endsWith(` > ${target}`) ||
            target.endsWith(` > ${normalized}`)))
      );
    });
  });
}

export const GENERIC_TAG_DISPLAY_NAMES: Record<string, string> = {
  html: "Document",
  head: "Head",
  canvas: "Canvas",
  table: "Table",
  thead: "Table Head",
  tbody: "Table Body",
  tr: "Table Row",
  td: "Table Cell",
  th: "Table Header",
  dl: "Description List",
  dt: "Description Term",
  dd: "Description",
  blockquote: "Quote",
  pre: "Preformatted",
  code: "Code",
  input: "Input",
  select: "Select",
  textarea: "Textarea",
  video: "Video",
  audio: "Audio",
  iframe: "Embed",
  details: "Details",
  summary: "Summary",
};

export function resolvedLayerName(node: CodeLayerTreeNode): string {
  // layerNameSource "tag" means the projection fell back to the raw tag name.
  // For unrecognised tags fallbackTagLayerName() returns tag.toUpperCase(),
  // which is not user-friendly. Override those with a friendlier label while
  // leaving explicit semantic/text/attribute names unchanged.
  if (
    node.name === node.tag.toUpperCase() ||
    node.name === node.tag.toLowerCase()
  ) {
    return GENERIC_TAG_DISPLAY_NAMES[node.tag] ?? node.name;
  }
  return node.name;
}

export function codeLayerTreeToPanelNodes(
  nodes: CodeLayerTreeNode[],
  lockedIds: Set<string>,
  hiddenIds: Set<string>,
  inheritedLocked = false,
  inheritedHidden = false,
  // Ancestor-path ids guarding against a cyclic projection (e.g. duplicate or
  // empty node ids like "an-" that make a node its own descendant) recursing
  // forever and crashing the whole editor with a stack overflow.
  ancestors: Set<string> = new Set(),
): LayersPanelNode[] {
  return nodes.map((node) => {
    const selfLocked = lockedIds.has(node.id);
    const selfHidden = hiddenIds.has(node.id);
    const locked = inheritedLocked || selfLocked;
    const hidden = inheritedHidden || selfHidden;
    let children: LayersPanelNode[] = [];
    if (!ancestors.has(node.id)) {
      ancestors.add(node.id);
      children = codeLayerTreeToPanelNodes(
        node.children,
        lockedIds,
        hiddenIds,
        locked,
        hidden,
        ancestors,
      );
      ancestors.delete(node.id);
    }
    return {
      id: node.id,
      name: resolvedLayerName(node),
      type: layerTypeForCodeLayer(node),
      tagName: node.tag,
      layout: node.layout,
      detail: node.detail,
      badge: node.badge,
      selectable: true,
      renamable: node.renamable,
      // L18: a descendant that is read-only only because an ANCESTOR is
      // locked/hidden (not itself directly locked/hidden) still renders in
      // the dimmed/read-only visual state (locked/hidden below stay true so
      // existing row styling picks it up), but its own toggle affordance is
      // suppressed — toggling it directly would be a no-op while the
      // ancestor is still locked/hidden, which is confusing UI. Only a
      // directly (self) locked/hidden row keeps a live toggle.
      lockable: selfLocked || !inheritedLocked,
      hideable: selfHidden || !inheritedHidden,
      locked,
      hidden,
      children,
    };
  });
}

export interface EffectiveCodeLayerState {
  lockedIds: Set<string>;
  hiddenIds: Set<string>;
}

export interface SelectedLayerTarget {
  layerId: string;
  fileId: string;
  node: CodeLayerNode;
  tree: CodeLayerTreeNode[];
  elementInfo: ElementInfo;
}

export function collectEffectiveCodeLayerState(
  nodes: CodeLayerTreeNode[],
  lockedIds: Set<string>,
  hiddenIds: Set<string>,
  inheritedLocked: boolean,
  inheritedHidden: boolean,
  state: EffectiveCodeLayerState,
  // Ids on the current ancestor path — guards against a malformed/cyclic
  // projection (e.g. a node that appears as its own descendant from duplicate
  // node ids) recursing forever and crashing the whole editor with a stack
  // overflow. A true cycle is skipped; duplicate ids in disjoint subtrees are
  // still visited.
  ancestors: Set<string> = new Set(),
): EffectiveCodeLayerState {
  nodes.forEach((node) => {
    if (ancestors.has(node.id)) return;
    const locked = inheritedLocked || lockedIds.has(node.id);
    const hidden = inheritedHidden || hiddenIds.has(node.id);
    if (locked) state.lockedIds.add(node.id);
    if (hidden) state.hiddenIds.add(node.id);
    ancestors.add(node.id);
    collectEffectiveCodeLayerState(
      node.children,
      lockedIds,
      hiddenIds,
      locked,
      hidden,
      state,
      ancestors,
    );
    ancestors.delete(node.id);
  });
  return state;
}

export function bridgeSourceIdForCodeLayerNode(node: CodeLayerNode): string {
  return (
    node.dataAttributes["data-agent-native-node-id"] ??
    node.dataAttributes["data-code-layer-id"] ??
    node.dataAttributes["data-layer-id"] ??
    node.dataAttributes["data-builder-id"] ??
    node.dataAttributes["data-loc"] ??
    (typeof node.attributes.id === "string" ? node.attributes.id : undefined) ??
    node.id
  );
}

function positiveIntegerDataAttribute(
  value: string | undefined,
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function provenanceForCodeLayerNode(
  node: CodeLayerNode,
): ElementInfo["provenance"] {
  const sourceFile = node.dataAttributes["data-source-file"]?.trim();
  const line = positiveIntegerDataAttribute(
    node.dataAttributes["data-source-line"],
  );
  const column = positiveIntegerDataAttribute(
    node.dataAttributes["data-source-column"],
  );
  const component = node.dataAttributes["data-component-name"]?.trim();
  if (!sourceFile && !line && !column && !component) return undefined;
  return {
    ...(sourceFile ? { sourceFile } : {}),
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
    ...(component ? { component } : {}),
  };
}

export function elementInfoFromCodeLayerNode(node: CodeLayerNode): ElementInfo {
  return {
    tagName: node.tag,
    id: typeof node.attributes.id === "string" ? node.attributes.id : undefined,
    sourceId: bridgeSourceIdForCodeLayerNode(node),
    provenance: provenanceForCodeLayerNode(node),
    selector: preferredCodeLayerSelector(node),
    classes: node.classes,
    computedStyles: Object.fromEntries(
      Object.entries(node.style).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    textContent: node.textSnippet ?? undefined,
    childElementCount: node.children.length,
    isFlexChild: node.layout.parentDisplay?.includes("flex") ? true : false,
    isFlexContainer: node.layout.isFlexContainer,
    parentDisplay: node.layout.parentDisplay,
    confidence: node.confidence,
  };
}

export function camelCaseCssProperty(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

export function cssStyleAliases(
  styles: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [property, value] of Object.entries(styles)) {
    result[property] = value;
    if (property.includes("-")) {
      result[camelCaseCssProperty(property)] = value;
    }
  }
  return result;
}

// BUG-UNDO-RESIZE-GEOMETRY: width/height are the two computedStyles keys the
// Layout panel's W/H fields actually read (edit-panel/element-classification.ts's
// cssElementSize parses element.computedStyles.width/height first, falling
// back to boundingRect only when that's missing/unparseable). Every other
// computedStyles property is fine to carry over additively when the fresh
// (reverted/replayed) source doesn't mention it — most style properties come
// from a CSS class the string-parse can't see, so keeping the previously
// known value is the right default. Width/height are different: an undo or
// redo of a resize commit is EXACTLY a change to (or removal of) an inline
// width/height, so a stale carried-over value here isn't just incomplete —
// it's actively wrong (it's the pre-undo/pre-redo box size).
const GEOMETRY_STYLE_PROPERTIES = ["width", "height"] as const;

export function refreshedComputedStyles(
  info: ElementInfo,
  sourceStyles: Record<string, string>,
  sourceClasses: readonly string[],
): Record<string, string> {
  const sourceWithAliases = cssStyleAliases(sourceStyles);
  const merged: Record<string, string> =
    sourceClasses.length > 0
      ? { ...info.computedStyles, ...sourceWithAliases }
      : { ...sourceWithAliases };
  GEOMETRY_STYLE_PROPERTIES.forEach((property) => {
    if (!(property in sourceWithAliases)) delete merged[property];
  });
  return merged;
}

/**
 * Companion to `refreshedComputedStyles` for the same undo/redo/remote-sync
 * resync path — `ElementInfo.boundingRect` is otherwise left completely
 * untouched by `refreshElementInfoFromContent` (both its node-match branch,
 * via `canonicalElementInfoForCodeLayerNode`'s `{...info}` spread, and its
 * DOM-parse fallback, via its own `{...info}` spread), so it keeps showing
 * whatever rect was live-measured before the content change. `cssElementSize`
 * falls back to `boundingRect.width`/`height` whenever computedStyles has no
 * parseable value for that axis, so a permanently-stale boundingRect can
 * still surface the pre-undo/redo size even after `refreshedComputedStyles`
 * is fixed. Reuses the SAME freshly-resolved computedStyles (already merged
 * above) so both fields agree, instead of re-deriving from a different
 * source.
 *
 * Exported for unit testing.
 */
export function refreshedBoundingRectSize(
  info: ElementInfo,
  computedStyles: Record<string, string>,
): ElementInfo["boundingRect"] {
  const parsedWidth = parseFloat(computedStyles.width ?? "");
  const parsedHeight = parseFloat(computedStyles.height ?? "");
  return {
    ...info.boundingRect,
    width:
      Number.isFinite(parsedWidth) && parsedWidth >= 0
        ? parsedWidth
        : info.boundingRect.width,
    height:
      Number.isFinite(parsedHeight) && parsedHeight >= 0
        ? parsedHeight
        : info.boundingRect.height,
  };
}

function codeLayerNodeMatchesSourceId(
  node: CodeLayerNode,
  sourceId: string,
): boolean {
  return (
    node.id === sourceId ||
    node.dataAttributes["data-agent-native-node-id"] === sourceId ||
    node.dataAttributes["data-code-layer-id"] === sourceId ||
    node.dataAttributes["data-layer-id"] === sourceId ||
    node.dataAttributes["data-builder-id"] === sourceId ||
    node.dataAttributes["data-loc"] === sourceId ||
    node.attributes.id === sourceId
  );
}

export function codeLayerNodeMatchesBridgeTarget(
  node: CodeLayerNode,
  selector?: string,
  sourceId?: string,
): boolean {
  if (sourceId && codeLayerNodeMatchesSourceId(node, sourceId)) return true;
  return codeLayerSelectorMatches(node, selector);
}

export function resolveCodeLayerNodeFromBridge(
  projection: { nodes: CodeLayerNode[] },
  selector?: string,
  sourceId?: string,
): CodeLayerNode | null {
  // Id-based match first, across the WHOLE projection (not just up to
  // whichever node the old combined-predicate `.find()` reached first) — a
  // sourceId identifies one node by its own stable id/data-attribute, which
  // is unique in a well-formed projection, so this branch alone can never be
  // ambiguous. Checking it before the selector fallback also fixes a subtler
  // pre-existing bug: the old single-pass `.find()` could match an EARLIER
  // node purely by selector before ever reaching the correct sourceId match
  // later in iteration order.
  if (sourceId) {
    const idMatch = projection.nodes.find((node) =>
      codeLayerNodeMatchesSourceId(node, sourceId),
    );
    if (idMatch) return idMatch;
  }
  // No sourceId (or no node carries it yet, e.g. a bridge target minted a
  // fresh pending id the projection hasn't picked up) — fall back to the
  // bridge's structural selector. Unlike an id, a generic short selector
  // (e.g. a 2-segment "div > p" suffix path) can legitimately match several
  // repeated list/card/row instances. The server-side resolver for the same
  // problem (code-layer.ts's resolveTarget) explicitly refuses to resolve a
  // selector that matches more than one node rather than silently picking
  // the first DOM-order match — mirror that discipline here so a duplicate/
  // move/style edit can never silently land on the wrong sibling instance.
  if (!selector) return null;
  const selectorMatches = projection.nodes.filter((node) =>
    codeLayerSelectorMatches(node, selector),
  );
  return selectorMatches.length === 1 ? selectorMatches[0]! : null;
}

export function collapsedElementText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function resolveCodeLayerNodeFromElementInfo(
  projection: { nodes: CodeLayerNode[] },
  info: ElementInfo | null | undefined,
): CodeLayerNode | null {
  if (!info) return null;
  const direct = resolveCodeLayerNodeFromBridge(
    projection,
    info.selector,
    info.sourceId ?? info.id,
  );
  if (direct) return direct;

  const tagName = info.tagName.toLowerCase();
  const text = collapsedElementText(info.textContent);
  const classes = new Set(info.classes);
  const scored = projection.nodes
    .filter((node) => node.tag === tagName)
    .map((node) => {
      let score = 0;
      const nodeText = collapsedElementText(node.textSnippet);
      if (text && nodeText) {
        if (nodeText === text) score += 8;
        else if (nodeText.includes(text) || text.includes(nodeText)) score += 4;
      }
      if (classes.size > 0) {
        const matchingClasses = node.classes.filter((className) =>
          classes.has(className),
        ).length;
        if (matchingClasses === classes.size) score += 4;
        else if (matchingClasses > 0) score += matchingClasses;
      }
      if (info.id && node.attributes.id === info.id) score += 6;
      return { node, score };
    })
    .filter((candidate) => candidate.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const [best, next] = scored;
  if (!best) return null;
  if (next && next.score === best.score) return null;
  return best.node;
}

export function canonicalElementInfoForCodeLayerNode(
  info: ElementInfo,
  node: CodeLayerNode,
): ElementInfo {
  return {
    ...info,
    sourceId: bridgeSourceIdForCodeLayerNode(node),
    selector: preferredCodeLayerSelector(node),
    classes: node.classes,
    confidence: node.confidence,
    childElementCount: node.children.length,
    editCapabilities: info.editCapabilities?.some((capability) =>
      capability.kind.startsWith("deterministic"),
    )
      ? info.editCapabilities
      : [
          {
            kind: "deterministic-style-edit",
            label: "deterministic-style-edit",
            confidence: 0.88,
            reason: "Selection resolved to a unique source code layer.",
          },
        ],
  };
}

export function canonicalizeElementInfoFromProjection(
  projection: { nodes: CodeLayerNode[] },
  info: ElementInfo,
): ElementInfo {
  const node = resolveCodeLayerNodeFromElementInfo(projection, info);
  return node ? canonicalElementInfoForCodeLayerNode(info, node) : info;
}

export function elementInfoIsRuntimeOnly(
  info: ElementInfo | null | undefined,
): boolean {
  return Boolean(
    info?.editCapabilities?.some(
      (capability) => capability.kind === "unsupported",
    ),
  );
}

export function codeLayerPatchMessage(
  message: string | null | undefined,
  fallback: string,
): string {
  if (!message) return fallback;
  return message.includes("did not match a code layer node")
    ? fallback
    : message;
}

// T16: known Google Font families offered by the inspector's font-family
// picker (FONT_FAMILY_OPTIONS in EditPanel.tsx — kept in sync manually since
// that file isn't editable from here). Maps the exact display family name to
// the Google Fonts CSS2 API family query param (weight range 400-700 covers
// the FONT_WEIGHT_OPTIONS range without over-fetching every weight).
export const KNOWN_GOOGLE_FONTS: Record<string, string> = {
  Inter: "Inter:wght@400;500;600;700",
  Poppins: "Poppins:wght@400;500;600;700",
  "Playfair Display": "Playfair+Display:wght@400;500;600;700",
  "JetBrains Mono": "JetBrains+Mono:wght@400;500;600;700",
};

/**
 * T16: extract the primary (first) font-family name from a CSS font-family
 * value, stripping quotes. Deliberately simple (no full CSS-value tokenizer)
 * since this only needs to recognize the small known-Google-Fonts set above,
 * not arbitrary font stacks.
 */
export function primaryFontFamilyName(value: string): string {
  const first = value.split(",")[0]?.trim() ?? "";
  if (
    (first.startsWith('"') && first.endsWith('"')) ||
    (first.startsWith("'") && first.endsWith("'"))
  ) {
    return first.slice(1, -1).trim();
  }
  return first;
}

/**
 * T16: EditPanel's font-family picker lets a user choose Inter/Poppins/
 * Playfair Display/JetBrains Mono, but EditPanel only calls onStyleChange —
 * it has no way to also load the webfont, so picking one just silently fell
 * back to the browser's default font (the family was never actually
 * available). Injects a Google Fonts <link> into the screen's <head> when
 * the committed fontFamily's primary family is a KNOWN_GOOGLE_FONTS entry
 * and no link for that family is already present. Conservative by design:
 * exact-match family name only (case-sensitive, matching the picker's own
 * option values), and skips if ANY existing <link> already mentions the
 * family (avoids duplicate/near-duplicate <link> tags on repeated edits).
 */
export function ensureGoogleFontLinkInHtml(
  content: string,
  fontFamilyValue: string,
): string {
  if (typeof window === "undefined") return content;
  const family = primaryFontFamilyName(fontFamilyValue);
  const fontQuery = family ? KNOWN_GOOGLE_FONTS[family] : undefined;
  if (!fontQuery) return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const head = doc.head;
    if (!head) return content;
    const existingLinks = Array.from(
      head.querySelectorAll('link[href*="fonts.googleapis.com"]'),
    );
    const alreadyLoaded = existingLinks.some((link) => {
      const href = link.getAttribute("href") ?? "";
      return href.includes(encodeURIComponent(family)) || href.includes(family);
    });
    if (alreadyLoaded) return content;
    const preconnectGoogleapis = doc.createElement("link");
    preconnectGoogleapis.setAttribute("rel", "preconnect");
    preconnectGoogleapis.setAttribute("href", "https://fonts.googleapis.com");
    const preconnectGstatic = doc.createElement("link");
    preconnectGstatic.setAttribute("rel", "preconnect");
    preconnectGstatic.setAttribute("href", "https://fonts.gstatic.com");
    preconnectGstatic.setAttribute("crossorigin", "");
    const fontLink = doc.createElement("link");
    fontLink.setAttribute("rel", "stylesheet");
    fontLink.setAttribute(
      "href",
      `https://fonts.googleapis.com/css2?family=${fontQuery}&display=swap`,
    );
    // Skip the preconnect hints if the head already has one for either host
    // (avoids piling up duplicates across repeated font picks).
    if (
      !existingLinks.some((link) =>
        (link.getAttribute("href") ?? "").includes("fonts.googleapis.com"),
      ) &&
      !head.querySelector(
        'link[href*="fonts.googleapis.com"][rel="preconnect"]',
      )
    ) {
      head.appendChild(preconnectGoogleapis);
    }
    if (
      !head.querySelector('link[href*="fonts.gstatic.com"][rel="preconnect"]')
    ) {
      head.appendChild(preconnectGstatic);
    }
    head.appendChild(fontLink);
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

export function refreshElementInfoFromContent(
  content: string,
  info: ElementInfo | null,
): ElementInfo | null {
  if (!info) return null;
  const projection = buildCodeLayerProjection(content);
  const node =
    resolveCodeLayerNodeFromElementInfo(projection, info) ??
    resolveCodeLayerNodeFromBridge(
      projection,
      info.selector,
      info.sourceId ?? info.id,
    );
  if (node) {
    const sourceInfo = elementInfoFromCodeLayerNode(node);
    const computedStyles = refreshedComputedStyles(
      info,
      sourceInfo.computedStyles,
      sourceInfo.classes,
    );
    return {
      ...canonicalElementInfoForCodeLayerNode(info, node),
      computedStyles,
      boundingRect: refreshedBoundingRectSize(info, computedStyles),
      textContent: sourceInfo.textContent,
      childElementCount: sourceInfo.childElementCount,
      isFlexChild: sourceInfo.isFlexChild,
      isFlexContainer: sourceInfo.isFlexContainer,
      parentDisplay: sourceInfo.parentDisplay,
    };
  }
  if (!info.selector || typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, info.selector);
    if (!element) return null;
    const classes = Array.from(element.classList);
    const computedStyles = refreshedComputedStyles(
      info,
      parseInlineStyleAttribute(element.getAttribute("style")),
      classes,
    );
    return {
      ...info,
      classes,
      computedStyles,
      boundingRect: refreshedBoundingRectSize(info, computedStyles),
      textContent: element.textContent?.slice(0, 200) ?? info.textContent,
      childElementCount: element.children.length,
    };
  } catch {
    return null;
  }
}

// U18: undo/redo already refreshes selectedElement via
// refreshElementInfoFromContent, but selectedLayerIdsState (the layers-panel
// multi-highlight array) was never touched — after an undo/redo that removes
// or re-ids a node, the panel kept highlighting rows for ids that no longer
// exist in the new content. Drops any id not present (as either the
// projection node's own .id or its data-agent-native-node-id) in the new
// content; returns the SAME array reference when nothing changed so callers
// can skip the state update.
export function refreshSelectedLayerIdsFromContent(
  content: string,
  layerIds: readonly string[],
): string[] {
  if (layerIds.length === 0) return layerIds as string[];
  const projection = buildCodeLayerProjection(content);
  const validIds = new Set<string>();
  projection.nodes.forEach((node) => {
    validIds.add(node.id);
    const dataNodeId = node.dataAttributes["data-agent-native-node-id"];
    if (dataNodeId) validIds.add(dataNodeId);
  });
  const next = layerIds.filter((id) => validIds.has(id));
  return next.length === layerIds.length ? (layerIds as string[]) : next;
}

// L4: locate the DOM-order sibling id list that contains targetId (i.e. the
// children array of its parent, or the root list when targetId is top-level)
// plus its index within that list. Used by changeSelectedZIndex to compute
// bring/send-forward/backward moveNode placements among real siblings,
// instead of the previous z-index/position-hack approach. Returns null when
// targetId isn't found anywhere in the tree.
export function findCodeLayerSiblingOrder(
  nodes: CodeLayerTreeNode[],
  targetId: string,
): { siblingIds: string[]; index: number; parentId: string | null } | null {
  const rootIndex = nodes.findIndex((node) => node.id === targetId);
  if (rootIndex !== -1) {
    return {
      siblingIds: nodes.map((node) => node.id),
      index: rootIndex,
      parentId: null,
    };
  }
  for (const node of nodes) {
    const childIndex = node.children.findIndex(
      (child) => child.id === targetId,
    );
    if (childIndex !== -1) {
      return {
        siblingIds: node.children.map((child) => child.id),
        index: childIndex,
        parentId: node.id,
      };
    }
    const nested = findCodeLayerSiblingOrder(node.children, targetId);
    if (nested) return nested;
  }
  return null;
}

// L25: matches the auto-generated wrapper name pattern from
// nextSequentialGroupName in shared/code-layer.ts ("Group", "Group 2", ...).
// Used to identify wrappers that were CREATED by the group action (as opposed
// to a user's own named container) so we only auto-clean up ones we made.
export const GENERATED_GROUP_NAME_PATTERN = /^Group(?: \d+)?$/;

export function isGeneratedGroupWrapperNode(node: CodeLayerNode): boolean {
  const layerNameAttr = node.dataAttributes["data-agent-native-layer-name"];
  return Boolean(
    layerNameAttr && GENERATED_GROUP_NAME_PATTERN.test(layerNameAttr.trim()),
  );
}

/**
 * L25: after a move or delete empties out a generated "Group"/"Group N"
 * wrapper (created by the group action), remove the now-empty wrapper
 * instead of leaving an invisible, pointless container behind in the layer
 * tree. Only auto-generated group wrappers are cleaned up — a user's own
 * named empty container is left alone. Checks each candidate former-parent
 * id (by data-agent-native-node-id) against the CURRENT content, since by
 * the time this runs other edits may have already changed the document.
 * Returns the possibly-updated content (unchanged if nothing qualified).
 */
export function removeEmptyGeneratedGroupWrappers(
  content: string,
  candidateParentAttrIds: ReadonlySet<string>,
): string {
  if (candidateParentAttrIds.size === 0) return content;
  let next = content;
  // Loop: removing one empty wrapper can itself empty out ITS parent (e.g.
  // ungrouping down a chain of nested generated groups), so keep sweeping
  // until a pass makes no changes.
  let changedInPass = true;
  let guard = 0;
  while (changedInPass && guard < 10) {
    changedInPass = false;
    guard += 1;
    for (const attrId of candidateParentAttrIds) {
      const projection = buildCodeLayerProjection(next);
      const node = projection.nodes.find(
        (n) => n.dataAttributes["data-agent-native-node-id"] === attrId,
      );
      if (!node || node.children.length > 0) continue;
      if (!isGeneratedGroupWrapperNode(node)) continue;
      const removed = removeCodeLayerNodeFromHtml(next, node);
      if (removed && removed !== next) {
        next = removed;
        changedInPass = true;
      }
    }
  }
  return next;
}

export function collectCodeLayerAncestors(
  nodes: CodeLayerTreeNode[],
  targetId: string,
  ancestors: string[] = [],
): string[] {
  for (const node of nodes) {
    if (node.id === targetId) return ancestors;
    const match = collectCodeLayerAncestors(node.children, targetId, [
      ...ancestors,
      node.id,
    ]);
    if (match.length > 0) return match;
  }
  return [];
}

// U14: collects the `data-agent-native-node-id` of targetId and every
// descendant beneath it in `tree`, using `nodesById` (keyed by projection
// node .id) to resolve each tree node's stamped id. Used to find every
// motion-track targetNodeId that becomes orphaned when a subtree is deleted
// — deleting a parent silently removes its children's node ids from the DOM
// too, and any track still targeting one of them would animate nothing.
export function collectCodeLayerSubtreeDataNodeIds(
  tree: CodeLayerTreeNode[],
  targetId: string,
  nodesById: Map<string, CodeLayerNode>,
): Set<string> {
  const ids = new Set<string>();
  const collectSubtree = (nodes: CodeLayerTreeNode[]) => {
    for (const node of nodes) {
      const dataNodeId = nodesById.get(node.id)?.dataAttributes[
        "data-agent-native-node-id"
      ];
      if (dataNodeId) ids.add(dataNodeId);
      collectSubtree(node.children);
    }
  };
  const findAndCollect = (nodes: CodeLayerTreeNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === targetId) {
        const dataNodeId = nodesById.get(node.id)?.dataAttributes[
          "data-agent-native-node-id"
        ];
        if (dataNodeId) ids.add(dataNodeId);
        collectSubtree(node.children);
        return true;
      }
      if (findAndCollect(node.children)) return true;
    }
    return false;
  };
  findAndCollect(tree);
  return ids;
}

export function sortCodeLayerIdsByTreeOrder(
  ids: readonly string[],
  tree: readonly CodeLayerTreeNode[],
): string[] {
  const treeOrder = new Map<string, number>();
  let index = 0;
  const visit = (nodes: readonly CodeLayerTreeNode[]) => {
    for (const node of nodes) {
      treeOrder.set(node.id, index);
      index += 1;
      visit(node.children);
    }
  };
  visit(tree);

  const originalOrder = new Map(
    ids.map((id, originalIndex) => [id, originalIndex]),
  );
  return [...ids].sort((a, b) => {
    const aOrder = treeOrder.get(a);
    const bOrder = treeOrder.get(b);
    if (aOrder === undefined && bOrder === undefined) {
      return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
    }
    if (aOrder === undefined) return 1;
    if (bOrder === undefined) return -1;
    return aOrder - bOrder;
  });
}

export function findCodeLayerNodeInProjection(
  projection: CodeLayerProjection,
  previousNode: CodeLayerNode,
): CodeLayerNode | null {
  const stableSourceIds = [
    previousNode.dataAttributes["data-agent-native-node-id"],
    previousNode.dataAttributes["data-code-layer-id"],
    previousNode.dataAttributes["data-layer-id"],
    previousNode.dataAttributes["data-builder-id"],
    previousNode.dataAttributes["data-loc"],
    typeof previousNode.attributes.id === "string"
      ? previousNode.attributes.id
      : undefined,
  ].filter((id): id is string => Boolean(id));

  for (const sourceId of stableSourceIds) {
    const stableMatch = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === sourceId ||
        node.dataAttributes["data-code-layer-id"] === sourceId ||
        node.dataAttributes["data-layer-id"] === sourceId ||
        node.dataAttributes["data-builder-id"] === sourceId ||
        node.dataAttributes["data-loc"] === sourceId ||
        node.attributes.id === sourceId,
    );
    if (stableMatch) return stableMatch;
  }

  const exactMatch = projection.nodes.find(
    (node) => node.id === previousNode.id,
  );
  if (exactMatch) return exactMatch;

  const fallbackMatches = projection.nodes.filter(
    (node) =>
      node.tag === previousNode.tag &&
      node.layerName === previousNode.layerName &&
      (node.textSnippet ?? "") === (previousNode.textSnippet ?? ""),
  );
  return fallbackMatches.length === 1 ? (fallbackMatches[0] ?? null) : null;
}

export function findMovedCodeLayerNodeInProjection(
  projection: CodeLayerProjection,
  previousNode: CodeLayerNode,
  movedNodeId?: string | null,
): CodeLayerNode | null {
  if (movedNodeId) {
    const movedMatch = projection.nodes.find(
      (node) =>
        node.id === movedNodeId ||
        node.dataAttributes["data-agent-native-node-id"] === movedNodeId ||
        node.dataAttributes["data-code-layer-id"] === movedNodeId ||
        node.dataAttributes["data-layer-id"] === movedNodeId ||
        node.dataAttributes["data-builder-id"] === movedNodeId ||
        node.dataAttributes["data-loc"] === movedNodeId ||
        node.attributes.id === movedNodeId,
    );
    if (movedMatch) return movedMatch;
  }
  return findCodeLayerNodeInProjection(projection, previousNode);
}

export function parseInlineStyleAttribute(
  style: string | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const declaration of (style ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator <= 0) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (property && value) result[property] = value;
  }
  return result;
}
