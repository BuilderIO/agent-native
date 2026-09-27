import { borderAreaSupportedBranch } from "@shared/border-area-fallback";
import {
  LINKED_COMPONENT_STRUCTURE_REFUSAL,
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerSource,
  type CodeLayerTreeNode,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { parseCssColorExtended } from "@shared/color-utils";
import { isComponentInstance } from "@shared/component-model";
import { resolveLayerNameAttribute } from "@shared/layer-name";
import {
  ELEMENT_PROVENANCE_METHODS,
  type ElementProvenanceFramework,
  type ElementProvenanceMethod,
} from "@shared/source-mode";

export {
  renameFilenamePreservingExtension,
  replaceDataScreenReferences,
} from "@shared/screen-rename";

import { GOOGLE_FONT_QUERIES } from "@agent-native/toolkit/design-tweaks";

import type { LayersPanelNode } from "@/components/design/LayersPanel";
import type { ElementInfo } from "@/components/design/types";
import type { UploadedFont } from "@/lib/font-upload";

import { queryUniqueSelector } from "./dom-utils";

export function layerTypeForCodeLayer(
  node: CodeLayerTreeNode,
): LayersPanelNode["type"] {
  if (node.type === "frame") return "frame";
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
  return (
    tag === "button" ||
    tag === "input" ||
    tag === "select" ||
    tag === "textarea"
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

export function liveDeleteSelectorGroups(args: {
  runtimeAliasGroups: readonly (readonly string[])[];
  liveSelectionSelectors: readonly string[];
  fallbackSelectors: readonly string[];
}): string[][] {
  const runtimeGroups = args.runtimeAliasGroups
    .map((aliases) => aliases.filter(Boolean))
    .filter((aliases) => aliases.length > 0);
  if (runtimeGroups.length > 0) return runtimeGroups;
  const liveSelectors = Array.from(
    new Set(args.liveSelectionSelectors.filter(Boolean)),
  );
  if (args.fallbackSelectors.length > 0) {
    return args.fallbackSelectors.map((selector) =>
      Array.from(new Set([selector, ...liveSelectors])),
    );
  }
  return liveSelectors.length > 0 ? [liveSelectors] : [];
}

export function shouldDeleteThroughLiveScreen(args: {
  screenSourceType: string | null | undefined;
  runtimeAliasGroups: readonly (readonly string[])[];
  liveSelectionSelectors: readonly string[];
}): boolean {
  if (args.screenSourceType !== "localhost") return false;
  return (
    args.runtimeAliasGroups.some((aliases) =>
      aliases.some((alias) => Boolean(alias)),
    ) || args.liveSelectionSelectors.some((selector) => Boolean(selector))
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
  if (
    node.name === node.tag.toUpperCase() ||
    node.name === node.tag.toLowerCase()
  ) {
    return GENERIC_TAG_DISPLAY_NAMES[node.tag] ?? node.name;
  }
  return node.name;
}

export function previewCodeLayerTreeMove(
  nodes: CodeLayerTreeNode[],
  args: {
    sourceId: string;
    anchorId: string;
    placement: "before" | "after" | "inside";
    insert?: boolean;
  },
): CodeLayerTreeNode[] | null {
  let moved: CodeLayerTreeNode | null = null;
  let anchorFound = false;
  const remove = (siblings: CodeLayerTreeNode[]): CodeLayerTreeNode[] =>
    siblings.flatMap((node) => {
      if (node.id === args.anchorId) anchorFound = true;
      if (node.id === args.sourceId) {
        moved = node;
        return [];
      }
      return [{ ...node, children: remove(node.children) }];
    });
  const withoutSource = remove(nodes);
  const movedNode = moved as CodeLayerTreeNode | null;
  if (movedNode === null || movedNode.id === args.anchorId || !anchorFound) {
    return null;
  }
  if (args.insert === false) return withoutSource;

  const insert = (siblings: CodeLayerTreeNode[]): CodeLayerTreeNode[] => {
    const next: CodeLayerTreeNode[] = [];
    for (const node of siblings) {
      if (args.placement === "before" && node.id === args.anchorId) {
        next.push(movedNode, node);
      } else if (args.placement === "after" && node.id === args.anchorId) {
        next.push(node, movedNode);
      } else {
        next.push({ ...node, children: insert(node.children) });
      }
    }
    if (args.placement === "inside") {
      return next.map((node) =>
        node.id === args.anchorId
          ? { ...node, children: [...node.children, movedNode] }
          : node,
      );
    }
    return next;
  };
  const result = insert(withoutSource);
  let sourceInserted = false;
  const visit = (node: CodeLayerTreeNode) => {
    if (node.id === args.sourceId) sourceInserted = true;
    node.children.forEach(visit);
  };
  result.forEach(visit);
  return sourceInserted ? result : null;
}

export function codeLayerTreeToPanelNodes(
  nodes: CodeLayerTreeNode[],
  lockedIds: Set<string>,
  hiddenIds: Set<string>,
  inheritedLocked = false,
  inheritedHidden = false,
  ancestors: Set<string> = new Set(),
): LayersPanelNode[] {
  return nodes.map((node) => {
    const selfLocked = lockedIds.has(node.id);
    const selfHidden = hiddenIds.has(node.id);
    const locked = inheritedLocked || selfLocked;
    const hidden = inheritedHidden || selfHidden;
    let children: LayersPanelNode[] = [];
    if (!node.isNativeTextPrimitive && !ancestors.has(node.id)) {
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
      isComponent: node.isComponent,
      tagName: node.tag,
      layout: node.layout,
      detail: node.detail,
      badge: node.badge,
      selectable: true,
      renamable: node.renamable,
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
  const declaredFramework =
    node.dataAttributes["data-source-framework"]?.trim();
  const framework =
    declaredFramework === "html" ||
    declaredFramework === "react" ||
    declaredFramework === "vue" ||
    declaredFramework === "svelte" ||
    declaredFramework === "angular" ||
    declaredFramework === "lwc"
      ? (declaredFramework as ElementProvenanceFramework)
      : undefined;
  const ownerSourceFile = node.dataAttributes["data-source-owner-file"]?.trim();
  const ownerLine = positiveIntegerDataAttribute(
    node.dataAttributes["data-source-owner-line"],
  );
  const ownerColumn = positiveIntegerDataAttribute(
    node.dataAttributes["data-source-owner-column"],
  );
  const ownerComponentName =
    node.dataAttributes["data-source-owner-component"]?.trim();
  const ownerKey = node.dataAttributes["data-source-owner-key"]?.trim();
  const declaredMethod = node.dataAttributes["data-source-method"]?.trim();
  const declaredOwnerMethod =
    node.dataAttributes["data-source-owner-method"]?.trim();
  const ownerMethod = ELEMENT_PROVENANCE_METHODS.includes(
    declaredOwnerMethod as ElementProvenanceMethod,
  )
    ? (declaredOwnerMethod as ElementProvenanceMethod)
    : undefined;
  const method = ELEMENT_PROVENANCE_METHODS.includes(
    declaredMethod as ElementProvenanceMethod,
  )
    ? (declaredMethod as ElementProvenanceMethod)
    : sourceFile
      ? "data-attribute"
      : undefined;
  const unavailable = node.dataAttributes["data-source-unavailable"]?.trim();
  const unavailableReason =
    !sourceFile &&
    (unavailable === "not-framework" ||
      unavailable === "not-react" ||
      unavailable === "no-debug-info")
      ? unavailable
      : undefined;
  if (
    !sourceFile &&
    !line &&
    !column &&
    !component &&
    !framework &&
    !ownerSourceFile &&
    !ownerKey &&
    !unavailableReason
  ) {
    return undefined;
  }
  return {
    ...(framework ? { framework } : {}),
    ...(sourceFile ? { sourceFile } : {}),
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
    ...(component ? { component } : {}),
    ...(ownerSourceFile ? { ownerSourceFile } : {}),
    ...(ownerLine ? { ownerLine } : {}),
    ...(ownerColumn ? { ownerColumn } : {}),
    ...(ownerComponentName ? { ownerComponentName } : {}),
    ...(ownerKey ? { ownerKey } : {}),
    ...(method ? { method } : {}),
    ...(ownerMethod ? { ownerMethod } : {}),
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

export function elementInfoFromCodeLayerNode(node: CodeLayerNode): ElementInfo {
  const sourceStyles = Object.fromEntries(
    Object.entries(node.style).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const styles = cssStyleAliases(
    sourceStyles,
    typeof node.attributes.style === "string"
      ? node.attributes.style
      : undefined,
    node.classes.length === 0,
  );
  return {
    tagName: node.tag,
    id: typeof node.attributes.id === "string" ? node.attributes.id : undefined,
    componentAnnotation:
      node.dataAttributes["data-agent-native-component"]?.trim() || undefined,
    sourceId: bridgeSourceIdForCodeLayerNode(node),
    provenance: provenanceForCodeLayerNode(node),
    selector: preferredCodeLayerSelector(node),
    classes: node.classes,
    computedStyles: styles,
    inlineStyles: { ...styles },
    primitiveKind: node.dataAttributes["data-an-primitive"] || undefined,
    isGroup: node.dataAttributes["data-agent-native-group"] === "true",
    vectorStrokeCanAlign: node.style["--an-vector-stroke-can-align"] === "true",
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    textContent: node.textSnippet ?? undefined,
    imageSource:
      node.tag === "img" && typeof node.attributes.src === "string"
        ? node.attributes.src
        : undefined,
    hasOwnText: node.paintsOwnText,
    wholeTextStyleRoot: node.wholeTextStyleRoot === true,
    ...(node.repeatXFor
      ? {
          repeat: {
            sourceSelector: preferredCodeLayerSelector(node),
            instanceCount: 0,
            instanceIndex: 0,
            xFor: node.repeatXFor,
            itemIndex: -1,
            textBinding:
              typeof node.attributes["x-text"] === "string"
                ? node.attributes["x-text"]
                : "",
            keyExpression: "",
            itemKey: "",
          },
        }
      : {}),
    childElementCount: node.children.length,
    isFlexChild: node.layout.parentDisplay?.includes("flex") ? true : false,
    isFlexContainer: node.layout.isFlexContainer,
    parentDisplay: node.layout.parentDisplay,
    parentLayout:
      node.layout.parentDisplay || node.layout.parentFlexDirection
        ? {
            display: node.layout.parentDisplay,
            flexDirection: node.layout.parentFlexDirection,
            gap: node.layout.parentGap,
          }
        : undefined,
    confidence: node.confidence,
  };
}

export function camelCaseCssProperty(property: string): string {
  const normalized = property.startsWith("-webkit-")
    ? property.slice(1)
    : property;
  return normalized.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function fontShorthandLonghands(value: string): Record<string, string> {
  const match =
    /^\s*(.*?)\s*(-?[\d.]+(?:px|r?em|%|pt)|x{1,2}-(?:small|large)|small|medium|large)\s*(?:\/\s*([^\s]+)\s*)?(\S.*)$/.exec(
      value,
    );
  if (!match) return {};
  const [, leading, size, lineHeight, family] = match;
  const longhands: Record<string, string> = {
    fontSize: size,
    fontFamily: family.trim(),
  };
  if (lineHeight) longhands.lineHeight = lineHeight;
  for (const token of leading.split(/\s+/).filter(Boolean)) {
    if (/^(?:normal|italic|oblique)$/.test(token)) longhands.fontStyle = token;
    else if (/^(?:\d{3}|bold|bolder|lighter)$/.test(token)) {
      longhands.fontWeight = token;
    } else if (/^small-caps$/.test(token)) longhands.fontVariant = token;
  }
  return longhands;
}

function backgroundShorthandColor(value: string): string | undefined {
  return parseCssColorExtended(value.trim()) ? value.trim() : undefined;
}

export function cssStyleAliases(
  styles: Record<string, string>,
  sourceStyleText?: string,
  fillMissingBackgroundDefaults = false,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [property, value] of Object.entries(styles)) {
    if (property === "background" && typeof document !== "undefined") {
      const declaration = document.createElement("div").style;
      declaration.background = value;
      for (const longhand of [
        "backgroundColor",
        "backgroundImage",
        "backgroundPosition",
        "backgroundSize",
        "backgroundRepeat",
        "backgroundOrigin",
        "backgroundClip",
        "backgroundAttachment",
      ] as const) {
        if (declaration[longhand]) result[longhand] = declaration[longhand];
      }
    }
    if (
      (property === "border" || property === "outline") &&
      typeof document !== "undefined"
    ) {
      const declaration = document.createElement("div").style;
      declaration.setProperty(property, value);
      for (const part of ["Width", "Style", "Color"] as const) {
        const longhand = `${property}${part}` as const;
        if (declaration[longhand]) result[longhand] = declaration[longhand];
      }
    }
    if (property === "-webkit-background-size") {
      const realSize = borderAreaSupportedBranch(value);
      if (realSize) result.backgroundSize = realSize;
    }
    if (property === "font") {
      Object.assign(result, fontShorthandLonghands(value));
    } else if (property === "background") {
      const color = backgroundShorthandColor(value);
      if (color) result.backgroundColor = color;
    }
    result[property] = value;
    if (property.includes("-")) {
      result[camelCaseCssProperty(property)] = value;
    }
  }
  if (sourceStyleText !== undefined && typeof document !== "undefined") {
    const authored = document.createElement("div").style;
    authored.cssText = sourceStyleText;
    const authoredProperties = Array.from(
      { length: authored.length },
      (_, index) => authored.item(index),
    );
    const hasBackgroundShorthand = authoredProperties.includes("background");
    const hasBackgroundDeclaration = authoredProperties.some(
      (property) =>
        property === "background" || property.startsWith("background-"),
    );
    const backgroundProperties = [
      ["backgroundColor", "background-color"],
      ["backgroundImage", "background-image"],
      ["backgroundPosition", "background-position"],
      ["backgroundSize", "background-size"],
      ["backgroundRepeat", "background-repeat"],
      ["backgroundOrigin", "background-origin"],
      ["backgroundClip", "background-clip"],
      ["backgroundAttachment", "background-attachment"],
    ] as const;
    if (hasBackgroundDeclaration) {
      const declaration = document.createElement("div").style;
      declaration.cssText = [
        "background-color: transparent",
        "background-image: none",
        "background-position: 0% 0%",
        "background-size: auto",
        "background-repeat: repeat",
        "background-origin: padding-box",
        "background-clip: border-box",
        "background-attachment: scroll",
        sourceStyleText,
      ].join("; ");
      for (const [property, sourceProperty] of backgroundProperties) {
        if (
          hasBackgroundShorthand ||
          fillMissingBackgroundDefaults ||
          authoredProperties.includes(sourceProperty)
        ) {
          const value = declaration[property];
          if (value) result[property] = value;
        }
      }
    }
  }
  return result;
}

const GEOMETRY_STYLE_PROPERTIES = ["width", "height"] as const;

export function refreshedComputedStyles(
  info: ElementInfo,
  sourceStyles: Record<string, string>,
  sourceClasses: readonly string[],
  sourceStyleText?: string,
): Record<string, string> {
  const sourceWithAliases = cssStyleAliases(
    sourceStyles,
    sourceStyleText,
    sourceClasses.length === 0,
  );
  const merged: Record<string, string> =
    sourceClasses.length > 0
      ? { ...info.computedStyles, ...sourceWithAliases }
      : { ...sourceWithAliases };
  GEOMETRY_STYLE_PROPERTIES.forEach((property) => {
    if (!(property in sourceWithAliases)) delete merged[property];
  });
  return merged;
}

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

export type CodeLayerResolution =
  | { status: "resolved"; node: CodeLayerNode }
  | { status: "absent" }
  | { status: "ambiguous"; candidates: CodeLayerNode[] };

const MOUNT_SHELL_MAX_NODES = 4;

export function isClientRenderedMountShell(projection: {
  nodes: CodeLayerNode[];
}): boolean {
  if (projection.nodes.length > MOUNT_SHELL_MAX_NODES) return false;
  return projection.nodes.every(
    (node) =>
      node.tag === "html" ||
      node.tag === "head" ||
      node.tag === "body" ||
      (node.children.length === 0 && !collapsedElementText(node.textSnippet)),
  );
}

export function resolveCodeLayerTargetFromBridge(
  projection: { nodes: CodeLayerNode[] },
  selector?: string,
  sourceId?: string,
): CodeLayerResolution {
  if (sourceId) {
    const idMatches = projection.nodes.filter((node) =>
      codeLayerNodeMatchesSourceId(node, sourceId),
    );
    if (idMatches.length === 1) {
      return { status: "resolved", node: idMatches[0]! };
    }
    if (idMatches.length > 1) {
      const selectorMatches = selector
        ? idMatches.filter((node) => codeLayerSelectorMatches(node, selector))
        : [];
      if (selectorMatches.length === 1) {
        return { status: "resolved", node: selectorMatches[0]! };
      }
      return { status: "ambiguous", candidates: idMatches };
    }
  }
  if (!selector) return { status: "absent" };
  const selectorMatches = projection.nodes.filter((node) =>
    codeLayerSelectorMatches(node, selector),
  );
  if (selectorMatches.length === 1) {
    return { status: "resolved", node: selectorMatches[0]! };
  }
  return selectorMatches.length === 0
    ? { status: "absent" }
    : { status: "ambiguous", candidates: selectorMatches };
}

export function resolveCodeLayerNodeFromBridge(
  projection: { nodes: CodeLayerNode[] },
  selector?: string,
  sourceId?: string,
): CodeLayerNode | null {
  const resolution = resolveCodeLayerTargetFromBridge(
    projection,
    selector,
    sourceId,
  );
  return resolution.status === "resolved" ? resolution.node : null;
}

export function remapLegacyCodeLayerNodeId(
  legacyProjection: CodeLayerProjection,
  scopedProjection: CodeLayerProjection,
  legacyNodeId: string,
): string | null {
  const legacyNodes = legacyProjection.nodes.filter(
    (node) => node.id === legacyNodeId,
  );
  if (legacyNodes.length !== 1) return null;
  const legacyNode = legacyNodes[0]!;
  const matches = scopedProjection.nodes.filter(
    (node) => node.tag === legacyNode.tag && node.path === legacyNode.path,
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

export function collapsedElementText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function resolveCodeLayerTargetFromElementInfo(
  projection: {
    nodes: CodeLayerNode[];
    source?: Pick<CodeLayerSource, "fileId">;
  },
  info: ElementInfo | null | undefined,
): CodeLayerResolution {
  if (!info) return { status: "absent" };
  if (
    info.sourceLayerIdentity?.screenId &&
    projection.source?.fileId &&
    info.sourceLayerIdentity.screenId !== projection.source.fileId
  ) {
    return { status: "absent" };
  }
  const direct = resolveCodeLayerTargetFromBridge(
    projection,
    info.selector,
    info.sourceId ?? info.id,
  );
  if (direct.status === "resolved") return direct;

  const tagName = info.tagName.toLowerCase();
  const text = collapsedElementText(info.textContent);
  const classes = new Set(info.classes);
  const candidates =
    direct.status === "ambiguous" ? direct.candidates : projection.nodes;
  const scored = candidates
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

  const [best, next] = scored;
  if (!best) return direct;
  if (next && next.score === best.score) {
    return {
      status: "ambiguous",
      candidates: scored
        .filter((candidate) => candidate.score === best.score)
        .map((candidate) => candidate.node),
    };
  }
  return { status: "resolved", node: best.node };
}

export function resolveCodeLayerNodeFromElementInfo(
  projection: {
    nodes: CodeLayerNode[];
    source?: Pick<CodeLayerSource, "fileId">;
  },
  info: ElementInfo | null | undefined,
): CodeLayerNode | null {
  const resolution = resolveCodeLayerTargetFromElementInfo(projection, info);
  return resolution.status === "resolved" ? resolution.node : null;
}

function sourceAuthoredGridTemplateOverlay(node: CodeLayerNode): {
  gridTemplateColumns: string | undefined;
  gridTemplateRows: string | undefined;
} {
  if (
    !("grid-template-columns" in node.style) &&
    !("grid-template-rows" in node.style)
  ) {
    return { gridTemplateColumns: undefined, gridTemplateRows: undefined };
  }
  const sourceInlineStyles = elementInfoFromCodeLayerNode(node).inlineStyles;
  return {
    gridTemplateColumns: sourceInlineStyles?.gridTemplateColumns,
    gridTemplateRows: sourceInlineStyles?.gridTemplateRows,
  };
}

export function canonicalElementInfoForCodeLayerNode(
  info: ElementInfo,
  node: CodeLayerNode,
  ownerScreenId?: string,
): ElementInfo {
  const gridTemplateOverlay = sourceAuthoredGridTemplateOverlay(node);
  const hasGridTemplateOverlay =
    gridTemplateOverlay.gridTemplateColumns !== undefined ||
    gridTemplateOverlay.gridTemplateRows !== undefined;
  const inlineStyles = hasGridTemplateOverlay
    ? {
        ...info.inlineStyles,
        ...(gridTemplateOverlay.gridTemplateColumns !== undefined
          ? { gridTemplateColumns: gridTemplateOverlay.gridTemplateColumns }
          : {}),
        ...(gridTemplateOverlay.gridTemplateRows !== undefined
          ? { gridTemplateRows: gridTemplateOverlay.gridTemplateRows }
          : {}),
      }
    : info.inlineStyles;
  return {
    ...info,
    inlineStyles,
    vectorStrokeCanAlign:
      info.vectorStrokeCanAlign ||
      node.style["--an-vector-stroke-can-align"] === "true",
    runtimeSelector: info.runtimeSelector ?? info.selector,
    runtimeSourceId: info.runtimeSourceId ?? info.sourceId,
    sourceLayerIdentity: ownerScreenId
      ? { screenId: ownerScreenId, nodeId: node.id }
      : info.sourceLayerIdentity?.nodeId === node.id
        ? info.sourceLayerIdentity
        : undefined,
    sourceId: bridgeSourceIdForCodeLayerNode(node),
    selector: preferredCodeLayerSelector(node),
    classes: node.classes,
    primitiveKind: node.dataAttributes["data-an-primitive"] || undefined,
    isGroup: node.dataAttributes["data-agent-native-group"] === "true",
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

export function elementInfoForOwnedCodeLayerNode(args: {
  info: ElementInfo | null;
  node: CodeLayerNode;
  ownerFileId: string;
}): ElementInfo {
  const { info, node, ownerFileId } = args;
  if (
    (info?.portableStyleSnapshot !== undefined ||
      info?.styleSnapshotCaptureFailed === true) &&
    info.sourceLayerIdentity?.screenId === ownerFileId &&
    info.sourceLayerIdentity.nodeId === node.id
  ) {
    return canonicalElementInfoForCodeLayerNode(info, node, ownerFileId);
  }
  return {
    ...elementInfoFromCodeLayerNode(node),
    sourceLayerIdentity: { screenId: ownerFileId, nodeId: node.id },
  };
}

export function canonicalizeElementInfoFromProjection(
  projection: {
    nodes: CodeLayerNode[];
    source?: Pick<CodeLayerSource, "fileId">;
  },
  info: ElementInfo,
  ownerScreenId?: string,
  resolvedNode?: CodeLayerNode | null,
): ElementInfo {
  if (
    info.sourceLayerIdentity?.screenId &&
    projection.source?.fileId &&
    info.sourceLayerIdentity.screenId !== projection.source.fileId
  ) {
    return info;
  }
  const node =
    resolvedNode === undefined
      ? resolveCodeLayerNodeFromElementInfo(projection, info)
      : resolvedNode;
  if (node)
    return canonicalElementInfoForCodeLayerNode(info, node, ownerScreenId);
  return ownerScreenId && info.sourceLayerIdentity
    ? { ...info, sourceLayerIdentity: undefined }
    : info;
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

export function isCodeLayerNodeRuntimeOnly(args: {
  fileIsRuntimeProjected: boolean;
  nodeIdAttr: string | undefined;
  sourceNodeIdAttrs: ReadonlySet<string>;
}): boolean {
  if (!args.nodeIdAttr) return args.fileIsRuntimeProjected;
  if (args.sourceNodeIdAttrs.has(args.nodeIdAttr)) return false;
  return (
    args.fileIsRuntimeProjected || /^runtime-[a-z0-9]+$/i.test(args.nodeIdAttr)
  );
}

export function codeLayerSourceNodeIdAttrs(
  source: string | CodeLayerProjection,
): ReadonlySet<string> {
  const projection =
    typeof source === "string" ? buildCodeLayerProjection(source) : source;
  return new Set(
    projection.nodes
      .map((node) => node.dataAttributes["data-agent-native-node-id"])
      .filter((value): value is string => Boolean(value)),
  );
}

export function runtimeLayerStateHandoffMode(args: {
  runtimeOnly: boolean;
  provenanceSourceFile: string | null | undefined;
}): "handoff" | "preview-only" {
  if (!args.runtimeOnly) return "preview-only";
  return args.provenanceSourceFile?.trim() ? "handoff" : "preview-only";
}

export function codeLayerPatchMessage(
  message: string | null | undefined,
  fallback: string,
  t?: (key: string) => string,
): string {
  if (message === LINKED_COMPONENT_STRUCTURE_REFUSAL)
    return (
      t?.("designEditor.componentInstances.linkedStructureUnsupported") ??
      message
    );
  if (!message) return fallback;
  return /code layer node|data-agent-native-node-id/i.test(message)
    ? fallback
    : message;
}

export const KNOWN_GOOGLE_FONTS = GOOGLE_FONT_QUERIES;

const LATO_MEDIUM_FACE_URL =
  "https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/lato/Lato-Medium.ttf";

function ensurePinnedFontFace(doc: Document, family: string): boolean {
  if (
    family !== "Lato" ||
    doc.head.querySelector('style[data-agent-native-font-face="Lato-500"]')
  ) {
    return false;
  }

  const style = doc.createElement("style");
  style.setAttribute("data-agent-native-font-face", "Lato-500");
  style.textContent = `/* Lato Medium; Copyright (c) 2011-2015 tyPoland, Lukasz Dziedzic; SIL Open Font License 1.1. */
@font-face {
  font-family: 'Lato';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('${LATO_MEDIUM_FACE_URL}') format('truetype');
}`;
  doc.head.appendChild(style);
  return true;
}

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
      let normalizedHref = href;
      try {
        normalizedHref = decodeURIComponent(href);
      } catch {
        // coercion-ok: malformed legacy URL stays raw for conservative matching.
        // Keep the raw URL when a legacy link contains malformed escaping.
      }
      normalizedHref = normalizedHref.replace(/\+/g, " ").toLowerCase();
      return (
        href.includes(`family=${fontQuery}`) ||
        normalizedHref.includes(`family=${family.toLowerCase()}:`)
      );
    });
    let changed = ensurePinnedFontFace(doc, family);
    if (!alreadyLoaded) {
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
      if (
        !head.querySelector(
          'link[href="https://fonts.googleapis.com"][rel="preconnect"]',
        )
      ) {
        head.appendChild(preconnectGoogleapis);
      }
      if (
        !head.querySelector(
          'link[href="https://fonts.gstatic.com"][rel="preconnect"]',
        )
      ) {
        head.appendChild(preconnectGstatic);
      }
      head.appendChild(fontLink);
      changed = true;
    }
    if (!changed) return content;
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, "");
}

export function ensureUploadedFontFaceInHtml(
  content: string,
  font: UploadedFont,
): string {
  if (typeof window === "undefined") return content;
  if (!font.url || !font.family) return content;
  const doc = new DOMParser().parseFromString(content, "text/html");
  const head = doc.head;
  if (!head) return content;
  const alreadyLoaded = Array.from(
    head.querySelectorAll('style[data-agent-native-uploaded-font="true"]'),
  ).some(
    (style) =>
      style.getAttribute("data-font-family") === font.family &&
      style.getAttribute("data-font-url") === font.url &&
      style.getAttribute("data-font-weight") === font.weight &&
      style.getAttribute("data-font-style") === font.style,
  );
  if (alreadyLoaded) return content;

  const style = doc.createElement("style");
  style.setAttribute("data-agent-native-uploaded-font", "true");
  style.setAttribute("data-font-family", font.family);
  style.setAttribute("data-font-url", font.url);
  style.setAttribute("data-font-weight", font.weight);
  style.setAttribute("data-font-style", font.style);
  style.textContent = `@font-face {
  font-family: "${escapeCssString(font.family)}";
  font-style: ${font.style};
  font-weight: ${font.weight};
  font-display: swap;
  src: url("${escapeCssString(font.url)}") format("${font.format}");
}`;
  head.appendChild(style);
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

export function refreshElementInfoFromContent(
  content: string,
  info: ElementInfo | null,
  source?: CodeLayerSource,
): ElementInfo | null {
  if (!info) return null;
  const infoScreenId = info.sourceLayerIdentity?.screenId;
  if (source?.fileId && infoScreenId && source.fileId !== infoScreenId) {
    return info;
  }
  const projectionSource =
    source ??
    (infoScreenId
      ? { kind: "design-file" as const, fileId: infoScreenId }
      : undefined);
  const projection = buildCodeLayerProjection(
    content,
    projectionSource ? { source: projectionSource } : undefined,
  );
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
      typeof node.attributes.style === "string"
        ? node.attributes.style
        : undefined,
    );
    return {
      ...canonicalElementInfoForCodeLayerNode(
        info,
        node,
        projectionSource?.fileId,
      ),
      computedStyles,
      inlineStyles: sourceInfo.inlineStyles ?? {},
      authoredSizeStyles: undefined,
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
    const sourceStyleText = element.getAttribute("style") ?? undefined;
    const inlineStyles = cssStyleAliases(
      parseInlineStyleAttribute(sourceStyleText ?? null),
      sourceStyleText,
    );
    const computedStyles = refreshedComputedStyles(
      info,
      inlineStyles,
      classes,
      sourceStyleText,
    );
    return {
      ...info,
      classes,
      computedStyles,
      inlineStyles,
      authoredSizeStyles: undefined,
      boundingRect: refreshedBoundingRectSize(info, computedStyles),
      textContent: element.textContent?.slice(0, 200) ?? info.textContent,
      childElementCount: element.children.length,
    };
  } catch {
    return null;
  }
}

export function refreshSelectedLayerIdsFromContent(
  content: string,
  layerIds: readonly string[],
  source?: CodeLayerSource,
): string[] {
  if (layerIds.length === 0) return layerIds as string[];
  const projection = buildCodeLayerProjection(
    content,
    source ? { source } : undefined,
  );
  const validIds = new Set<string>();
  projection.nodes.forEach((node) => {
    validIds.add(node.id);
    const dataNodeId = node.dataAttributes["data-agent-native-node-id"];
    if (dataNodeId) validIds.add(dataNodeId);
  });
  const next = layerIds.filter((id) => validIds.has(id));
  return next.length === layerIds.length ? (layerIds as string[]) : next;
}

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

export function isGeneratedGroupWrapperNode(node: CodeLayerNode): boolean {
  if (node.dataAttributes["data-agent-native-clone-root"] === "true") {
    return false;
  }
  if (node.dataAttributes["data-agent-native-group-wrapper"] === "true") {
    return true;
  }
  const layerName =
    resolveLayerNameAttribute((attribute) => {
      const value =
        node.attributes[attribute] ?? node.dataAttributes[attribute];
      return typeof value === "string" ? value : null;
    })?.value ?? "";
  const nodeId = node.dataAttributes["data-agent-native-node-id"] ?? "";
  return (
    /^an-[a-z0-9]+$/i.test(nodeId) &&
    /^group(?: \d+)?$/i.test(layerName.trim()) &&
    node.dataAttributes["data-agent-native-preserve-styles"] === "true"
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
  if (
    !content.includes("data-agent-native-group-wrapper") &&
    !content.includes("data-agent-native-preserve-styles")
  ) {
    return content;
  }
  let next = content;
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

export function resolveSelectedCodeLayerNode(args: {
  selectedElement: ElementInfo | null | undefined;
  sourceProjection: CodeLayerProjection;
  runtimeProjection?: CodeLayerProjection | null;
}): CodeLayerNode | null {
  if (!args.selectedElement) return null;
  if (args.runtimeProjection) {
    const runtimeNode = resolveCodeLayerNodeFromElementInfo(
      args.runtimeProjection,
      args.selectedElement,
    );
    if (runtimeNode) return runtimeNode;
  }
  return resolveCodeLayerNodeFromElementInfo(
    args.sourceProjection,
    args.selectedElement,
  );
}

export function nudgeBaseContentForScreen(args: {
  isRunningApp: boolean;
  runtimeSnapshotHtml?: string | null;
  liveSnapshotHtml?: string | null;
  sourceContent: string;
}): string {
  if (!args.isRunningApp) return args.sourceContent;
  return args.runtimeSnapshotHtml ?? args.liveSnapshotHtml ?? "";
}

export interface LiveNudgeReorderHandoff {
  anchorSelector: string;
  placement: "before" | "after";
  anchorSourceId?: string;
}

export function liveNudgeReorderHandoff(args: {
  content: string;
  anchorNodeId: string;
  placement: "before" | "after";
  source?: CodeLayerSource;
}): LiveNudgeReorderHandoff | null {
  const projection = buildCodeLayerProjection(
    args.content,
    args.source ? { source: args.source } : undefined,
  );
  const anchorNode = projection.nodes.find(
    (node) => node.id === args.anchorNodeId,
  );
  const anchorSelector = codeLayerSelectorAliases(anchorNode)[0];
  if (!anchorSelector) return null;
  const anchorSourceId =
    anchorNode?.dataAttributes["data-agent-native-node-id"]?.trim();
  return {
    anchorSelector,
    placement: args.placement,
    ...(anchorSourceId ? { anchorSourceId } : {}),
  };
}
