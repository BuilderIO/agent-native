export { linkedComponentRootForNode } from "./component-model";
import { parseFragment } from "parse5";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
  readCodeLayerNodeTextContent,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerSource,
  type EditIntent,
} from "./code-layer";
import {
  componentNodeIdMatches,
  linkedComponentRootForNode as nearestComponentRoot,
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "./component-model";
import { ensureGroupRuntime } from "./group-runtime";
import { resolveLayerNameAttribute } from "./layer-name.js";

const NODE_ID_ATTR = "data-agent-native-node-id";

interface LocatedNode {
  node: CodeLayerNode;
  source: CodeLayerSource;
  projectionIndex: number;
}

export type ComponentLinkResolution =
  | {
      status: "resolved";
      componentId: string;
      main: CodeLayerNode;
      references: CodeLayerNode[];
      source: CodeLayerSource;
    }
  | {
      status: "missing-main";
      componentId: string;
      references: CodeLayerNode[];
    }
  | {
      status: "ambiguous-main";
      componentId: string;
      mains: CodeLayerNode[];
      references: CodeLayerNode[];
    }
  | {
      status: "source-mismatch";
      componentId: string;
      main: CodeLayerNode;
      references: CodeLayerNode[];
    };

export interface ComponentLinkAnalysis {
  components: ComponentLinkResolution[];
  invalidNodes: Array<{
    node: CodeLayerNode;
    reason: "empty-identity" | "both-main-and-reference";
  }>;
}

function identityValue(node: CodeLayerNode, attribute: string): string | null {
  const value = node.dataAttributes[attribute];
  return value !== undefined && value.trim().length > 0 ? value : null;
}

function hasIdentityAttribute(node: CodeLayerNode, attribute: string): boolean {
  return Object.prototype.hasOwnProperty.call(node.dataAttributes, attribute);
}

function sameComponentSourceScope(
  left: CodeLayerSource,
  right: CodeLayerSource,
): boolean {
  if (left.kind !== right.kind || !left.fileId || !right.fileId) {
    return false;
  }
  if (left.kind === "design-file") {
    return Boolean(
      left.designId && right.designId && left.designId === right.designId,
    );
  }
  return (
    left.fileId === right.fileId &&
    !(left.designId && right.designId && left.designId !== right.designId)
  );
}

function sameDocument(left: LocatedNode, right: LocatedNode): boolean {
  return (
    left.projectionIndex === right.projectionIndex ||
    sameComponentSourceScope(left.source, right.source)
  );
}

export function analyzeComponentLinks(
  projections: readonly CodeLayerProjection[],
): ComponentLinkAnalysis {
  const mains = new Map<string, LocatedNode[]>();
  const references = new Map<string, LocatedNode[]>();
  const invalidNodes: ComponentLinkAnalysis["invalidNodes"] = [];

  projections.forEach((projection, projectionIndex) => {
    for (const node of projection.nodes) {
      const rawId = node.dataAttributes[COMPONENT_ID_ATTR];
      const rawRef = node.dataAttributes[COMPONENT_REF_ATTR];
      const hasId = rawId !== undefined;
      const hasRef = rawRef !== undefined;
      if (!hasId && !hasRef) continue;

      const componentId =
        rawId !== undefined && rawId.trim().length > 0 ? rawId : null;
      const componentRef =
        rawRef !== undefined && rawRef.trim().length > 0 ? rawRef : null;
      if (hasId && hasRef) {
        invalidNodes.push({ node, reason: "both-main-and-reference" });
        continue;
      }
      if (!componentId && !componentRef) {
        invalidNodes.push({ node, reason: "empty-identity" });
        continue;
      }

      const key = componentId ?? componentRef;
      if (!key) continue;
      const located = { node, source: projection.source, projectionIndex };
      const collection = componentId ? mains : references;
      const entries = collection.get(key) ?? [];
      entries.push(located);
      collection.set(key, entries);
    }
  });

  const componentIds = new Set([...mains.keys(), ...references.keys()]);
  const components: ComponentLinkResolution[] = [];
  for (const componentId of [...componentIds].sort()) {
    const componentMains = mains.get(componentId) ?? [];
    const componentReferences = references.get(componentId) ?? [];
    const referenceNodes = componentReferences.map(({ node }) => node);

    if (componentMains.length > 1) {
      components.push({
        status: "ambiguous-main",
        componentId,
        mains: componentMains.map(({ node }) => node),
        references: referenceNodes,
      });
      continue;
    }
    const main = componentMains[0];
    if (!main) {
      components.push({
        status: "missing-main",
        componentId,
        references: referenceNodes,
      });
      continue;
    }
    if (
      componentReferences.some((reference) => !sameDocument(main, reference))
    ) {
      components.push({
        status: "source-mismatch",
        componentId,
        main: main.node,
        references: referenceNodes,
      });
      continue;
    }
    components.push({
      status: "resolved",
      componentId,
      main: main.node,
      references: referenceNodes,
      source: main.source,
    });
  }

  return { components, invalidNodes };
}

export type ComponentLinkMaterialization =
  | { status: "materialized"; content: string; rootNodeId: string }
  | { status: "source-mismatch" }
  | { status: "invalid-canonical-main" }
  | { status: "ambiguous-canonical-main" }
  | { status: "missing-source-node-id"; nodeId?: string }
  | { status: "ambiguous-source-node-id"; nodeId: string }
  | { status: "clone-root-mismatch" }
  | { status: "incomplete-clone-map"; nodeId?: string }
  | { status: "unsupported-nested-link"; nodeId: string }
  | { status: "missing-source-span"; nodeId: string };

interface MaterializeComponentLinkInput {
  mainProjection: CodeLayerProjection;
  projections?: readonly CodeLayerProjection[];
  mainNode: CodeLayerNode;
  targetSource: CodeLayerSource;
  cloneHtml: string;
  nodeIdMap: ReadonlyMap<string, string>;
}

function descendantsOf(
  root: CodeLayerNode,
  nodesById: ReadonlyMap<string, CodeLayerNode>,
): CodeLayerNode[] | null {
  const result: CodeLayerNode[] = [];
  const visited = new Set<string>();
  const visit = (node: CodeLayerNode): boolean => {
    if (visited.has(node.id)) return false;
    visited.add(node.id);
    result.push(node);
    for (const childId of node.children) {
      const child = nodesById.get(childId);
      if (!child || !visit(child)) return false;
    }
    return true;
  };
  return visit(root) ? result : null;
}

export function componentSubtreeForProjection(
  root: CodeLayerNode,
  projection: CodeLayerProjection,
): CodeLayerNode[] | null {
  return descendantsOf(
    root,
    new Map(projection.nodes.map((node) => [node.id, node] as const)),
  );
}

function validateNestedReference(
  reference: CodeLayerNode,
  referenceProjection: CodeLayerProjection,
  projections: readonly CodeLayerProjection[],
  outerMain: CodeLayerNode,
): { status: "valid"; descendants: CodeLayerNode[] } | null {
  const componentId = identityValue(reference, COMPONENT_REF_ATTR);
  if (!componentId || hasIdentityAttribute(reference, COMPONENT_ID_ATTR)) {
    return null;
  }
  const resolution = analyzeComponentLinks(projections).components.find(
    (entry) => entry.componentId === componentId,
  );
  if (
    !resolution ||
    resolution.status !== "resolved" ||
    resolution.main.id === outerMain.id ||
    !resolution.references.some((node) => node === reference)
  ) {
    return null;
  }

  const nestedSourceNodeId = identityValue(
    reference,
    COMPONENT_SOURCE_NODE_ID_ATTR,
  );
  const innerMainNodeId = identityValue(resolution.main, NODE_ID_ATTR);
  if (
    hasIdentityAttribute(reference, COMPONENT_SOURCE_NODE_ID_ATTR) &&
    nestedSourceNodeId !== innerMainNodeId
  ) {
    return null;
  }

  const mainProjection = projections.find((projection) =>
    projection.nodes.includes(resolution.main),
  );
  if (!mainProjection) return null;
  const mainNodesById = new Map(
    mainProjection.nodes.map((node) => [node.id, node] as const),
  );
  const referenceNodesById = new Map(
    referenceProjection.nodes.map((node) => [node.id, node] as const),
  );
  const mainSubtree = descendantsOf(resolution.main, mainNodesById);
  const referenceSubtree = descendantsOf(reference, referenceNodesById);
  if (
    !mainSubtree ||
    !referenceSubtree ||
    mainSubtree.length !== referenceSubtree.length
  ) {
    return null;
  }

  const sourceIds = new Map<string, CodeLayerNode>();
  for (const node of mainSubtree) {
    if (
      node !== resolution.main &&
      hasIdentityAttribute(node, COMPONENT_REF_ATTR)
    ) {
      return null;
    }
    const sourceId = identityValue(node, NODE_ID_ATTR);
    if (
      !sourceId ||
      mainProjection.nodes.filter(
        (candidate) => identityValue(candidate, NODE_ID_ATTR) === sourceId,
      ).length !== 1 ||
      sourceIds.has(sourceId)
    ) {
      return null;
    }
    sourceIds.set(sourceId, node);
  }

  const referenceBySourceId = new Map<string, CodeLayerNode>();
  for (const node of referenceSubtree) {
    if (node !== reference && hasIdentityAttribute(node, COMPONENT_REF_ATTR)) {
      return null;
    }
    const sourceId =
      node === reference
        ? identityValue(resolution.main, NODE_ID_ATTR)
        : identityValue(node, COMPONENT_SOURCE_NODE_ID_ATTR);
    const mainNode = sourceId ? sourceIds.get(sourceId) : undefined;
    if (
      !sourceId ||
      !mainNode ||
      mainNode.tag !== node.tag ||
      referenceBySourceId.has(sourceId)
    ) {
      return null;
    }
    referenceBySourceId.set(sourceId, node);
  }
  if (referenceBySourceId.size !== sourceIds.size) return null;

  for (const [sourceId, mainNode] of sourceIds) {
    const referenceNode = referenceBySourceId.get(sourceId);
    if (!referenceNode) return null;
    if (mainNode !== resolution.main) {
      const mainParent = mainNode.parentId
        ? mainNodesById.get(mainNode.parentId)
        : undefined;
      const referenceParent = referenceNode.parentId
        ? referenceNodesById.get(referenceNode.parentId)
        : undefined;
      const expectedParentId = mainParent
        ? identityValue(mainParent, NODE_ID_ATTR)
        : null;
      const actualParentId = referenceParent
        ? referenceParent.id === reference.id
          ? identityValue(resolution.main, NODE_ID_ATTR)
          : identityValue(referenceParent, COMPONENT_SOURCE_NODE_ID_ATTR)
        : null;
      if (expectedParentId !== actualParentId) return null;
    }
    const expectedChildren = mainNode.children.map((childId) => {
      const child = mainNodesById.get(childId);
      return child ? identityValue(child, NODE_ID_ATTR) : null;
    });
    const actualChildren = referenceNode.children.map((childId) => {
      const child = referenceNodesById.get(childId);
      return child ? identityValue(child, COMPONENT_SOURCE_NODE_ID_ATTR) : null;
    });
    if (
      expectedChildren.length !== actualChildren.length ||
      expectedChildren.some(
        (childId, index) => !childId || childId !== actualChildren[index],
      )
    ) {
      return null;
    }
  }
  return {
    status: "valid",
    descendants: referenceSubtree.slice(1),
  };
}

function atomicComponentSubtree(
  root: CodeLayerNode,
  nodesById: Map<string, CodeLayerNode>,
): { nodes: CodeLayerNode[]; nestedRoots: CodeLayerNode[] } | null {
  const subtree = descendantsOf(root, nodesById);
  if (!subtree) return null;
  const nestedRoots = subtree.slice(1).filter((node) => {
    if (
      !hasIdentityAttribute(node, COMPONENT_ID_ATTR) &&
      !hasIdentityAttribute(node, COMPONENT_REF_ATTR)
    ) {
      return false;
    }
    let parentId = node.parentId;
    const seen = new Set<string>();
    while (parentId && parentId !== root.id && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = nodesById.get(parentId);
      if (!parent) return false;
      if (
        hasIdentityAttribute(parent, COMPONENT_ID_ATTR) ||
        hasIdentityAttribute(parent, COMPONENT_REF_ATTR)
      ) {
        return false;
      }
      parentId = parent.parentId;
    }
    return true;
  });
  const nestedRootIds = new Set(nestedRoots.map((node) => node.id));
  const nodes = subtree.filter((node) => {
    let parentId = node.parentId;
    const seen = new Set<string>();
    while (parentId && parentId !== root.id && !seen.has(parentId)) {
      if (nestedRootIds.has(parentId)) return false;
      seen.add(parentId);
      const parent = nodesById.get(parentId);
      if (!parent) return false;
      parentId = parent.parentId;
    }
    return true;
  });
  return { nodes, nestedRoots };
}

export function materializeComponentLink({
  mainProjection,
  projections = [mainProjection],
  mainNode,
  targetSource,
  cloneHtml,
  nodeIdMap,
}: MaterializeComponentLinkInput): ComponentLinkMaterialization {
  if (!sameComponentSourceScope(mainProjection.source, targetSource)) {
    return { status: "source-mismatch" };
  }
  if (
    projections.some(
      (projection) =>
        !sameComponentSourceScope(mainProjection.source, projection.source),
    )
  ) {
    return { status: "source-mismatch" };
  }

  const componentId = identityValue(mainNode, COMPONENT_ID_ATTR);
  if (!componentId || hasIdentityAttribute(mainNode, COMPONENT_REF_ATTR)) {
    return { status: "invalid-canonical-main" };
  }
  const canonicalMains = mainProjection.nodes.filter(
    (node) => identityValue(node, COMPONENT_ID_ATTR) === componentId,
  );
  if (canonicalMains.length > 1) {
    return { status: "ambiguous-canonical-main" };
  }
  const canonicalMain = canonicalMains[0];
  if (
    !canonicalMain ||
    canonicalMain.id !== mainNode.id ||
    canonicalMain.source?.openStart !== mainNode.source?.openStart
  ) {
    return { status: "invalid-canonical-main" };
  }

  const mainNodeId = identityValue(mainNode, NODE_ID_ATTR);
  if (!mainNodeId) {
    return { status: "missing-source-node-id", nodeId: mainNode.id };
  }
  const mainNodesById = new Map(
    mainProjection.nodes.map((node) => [node.id, node] as const),
  );
  const mainSubtree = descendantsOf(mainNode, mainNodesById);
  if (!mainSubtree) {
    return { status: "incomplete-clone-map", nodeId: mainNode.id };
  }

  const nestedDescendantIds = new Set<string>();
  for (const node of mainSubtree.slice(1)) {
    if (nestedDescendantIds.has(node.id)) continue;
    if (hasIdentityAttribute(node, COMPONENT_ID_ATTR)) {
      return { status: "unsupported-nested-link", nodeId: node.id };
    }
    if (hasIdentityAttribute(node, COMPONENT_REF_ATTR)) {
      const nested = validateNestedReference(
        node,
        mainProjection,
        projections,
        mainNode,
      );
      if (
        !nested ||
        nested.descendants.some((descendant) =>
          nestedDescendantIds.has(descendant.id),
        )
      ) {
        return { status: "unsupported-nested-link", nodeId: node.id };
      }
      nested.descendants.forEach((descendant) =>
        nestedDescendantIds.add(descendant.id),
      );
    } else if (hasIdentityAttribute(node, COMPONENT_SOURCE_NODE_ID_ATTR)) {
      return { status: "unsupported-nested-link", nodeId: node.id };
    }
  }

  const sourceIdCounts = new Map<string, number>();
  for (const node of mainProjection.nodes) {
    const nodeId = identityValue(node, NODE_ID_ATTR);
    if (nodeId)
      sourceIdCounts.set(nodeId, (sourceIdCounts.get(nodeId) ?? 0) + 1);
  }
  const sourceSubtreeIds = new Set<string>();
  for (const node of mainSubtree) {
    const nodeId = identityValue(node, NODE_ID_ATTR);
    if (!nodeId) return { status: "missing-source-node-id", nodeId: node.id };
    if (sourceIdCounts.get(nodeId) !== 1 || sourceSubtreeIds.has(nodeId)) {
      return { status: "ambiguous-source-node-id", nodeId };
    }
    sourceSubtreeIds.add(nodeId);
  }

  const cloneProjection = buildCodeLayerProjection(cloneHtml, {
    source: mainProjection.source,
  });
  if (cloneProjection.rootNodeIds.length !== 1) {
    return { status: "clone-root-mismatch" };
  }
  const cloneRoot = cloneProjection.nodes.find(
    (node) => node.id === cloneProjection.rootNodeIds[0],
  );
  if (
    !cloneRoot ||
    identityValue(cloneRoot, COMPONENT_ID_ATTR) !== componentId
  ) {
    return { status: "clone-root-mismatch" };
  }

  const cloneRootNodeId = identityValue(cloneRoot, NODE_ID_ATTR);
  if (!cloneRootNodeId || nodeIdMap.get(mainNodeId) !== cloneRootNodeId) {
    return { status: "incomplete-clone-map", nodeId: mainNodeId };
  }
  const cloneNodesById = new Map(
    cloneProjection.nodes.map((node) => [node.id, node] as const),
  );
  const cloneSubtree = descendantsOf(cloneRoot, cloneNodesById);
  if (!cloneSubtree || cloneSubtree.length !== mainSubtree.length) {
    return { status: "incomplete-clone-map" };
  }
  const reverseCloneIds = new Map<string, string>();
  for (const [sourceId, cloneId] of nodeIdMap) {
    if (!sourceId || !cloneId || reverseCloneIds.has(cloneId)) {
      return { status: "incomplete-clone-map", nodeId: sourceId || undefined };
    }
    reverseCloneIds.set(cloneId, sourceId);
  }

  const cloneByStableId = new Map<string, CodeLayerNode>();
  for (const node of cloneSubtree) {
    const nodeId = identityValue(node, NODE_ID_ATTR);
    if (!nodeId || cloneByStableId.has(nodeId)) {
      return { status: "incomplete-clone-map", nodeId: node.id };
    }
    cloneByStableId.set(nodeId, node);
  }

  for (const sourceNode of mainSubtree.slice(1)) {
    const sourceNodeId = identityValue(sourceNode, NODE_ID_ATTR);
    const cloneNodeId = sourceNodeId ? nodeIdMap.get(sourceNodeId) : undefined;
    const cloneNode = cloneNodeId
      ? cloneByStableId.get(cloneNodeId)
      : undefined;
    if (!sourceNodeId || !cloneNode) {
      return { status: "incomplete-clone-map", nodeId: sourceNode.id };
    }
    for (const attribute of [
      COMPONENT_ID_ATTR,
      COMPONENT_REF_ATTR,
      COMPONENT_SOURCE_NODE_ID_ATTR,
    ]) {
      if (
        sourceNode.dataAttributes[attribute] !==
        cloneNode.dataAttributes[attribute]
      ) {
        return { status: "unsupported-nested-link", nodeId: sourceNode.id };
      }
    }
  }

  const updates = new Map<string, Map<string, string | null>>();
  const rootUpdates = new Map<string, string | null>([
    [COMPONENT_ID_ATTR, null],
    [COMPONENT_REF_ATTR, componentId],
  ]);
  updates.set(cloneRoot.id, rootUpdates);

  for (const sourceNode of mainSubtree) {
    const sourceNodeId = identityValue(sourceNode, NODE_ID_ATTR);
    if (!sourceNodeId) {
      return { status: "missing-source-node-id", nodeId: sourceNode.id };
    }
    const cloneNodeId = nodeIdMap.get(sourceNodeId);
    if (!cloneNodeId || cloneNodeId === sourceNodeId) {
      return { status: "incomplete-clone-map", nodeId: sourceNodeId };
    }
    const cloneNode = cloneByStableId.get(cloneNodeId);
    if (!cloneNode || reverseCloneIds.get(cloneNodeId) !== sourceNodeId) {
      return { status: "incomplete-clone-map", nodeId: sourceNodeId };
    }
    if (cloneNode.tag !== sourceNode.tag) {
      return { status: "incomplete-clone-map", nodeId: sourceNodeId };
    }
    if (
      sourceNode.id === mainNode.id ||
      nestedDescendantIds.has(sourceNode.id)
    ) {
      continue;
    }

    const parentNode = sourceNode.parentId
      ? mainNodesById.get(sourceNode.parentId)
      : undefined;
    const cloneParentId = cloneNode.parentId
      ? cloneNodesById.get(cloneNode.parentId)
      : undefined;
    const parentStableId = parentNode
      ? identityValue(parentNode, NODE_ID_ATTR)
      : null;
    if (
      parentStableId &&
      (!cloneParentId ||
        nodeIdMap.get(parentStableId) !==
          identityValue(cloneParentId, NODE_ID_ATTR))
    ) {
      return { status: "incomplete-clone-map", nodeId: sourceNodeId };
    }
    const nodeUpdates = new Map<string, string | null>([
      [COMPONENT_SOURCE_NODE_ID_ATTR, sourceNodeId],
    ]);
    if (hasIdentityAttribute(sourceNode, COMPONENT_REF_ATTR)) {
      nodeUpdates.set(COMPONENT_OVERRIDES_ATTR, null);
    }
    updates.set(cloneNode.id, nodeUpdates);
  }

  const attributeUpdates: Array<{
    node: CodeLayerNode;
    attributes: Record<string, string | null>;
  }> = [];
  for (const node of cloneSubtree) {
    const nodeUpdates = updates.get(node.id);
    if (!nodeUpdates) continue;
    if (!node.source) return { status: "missing-source-span", nodeId: node.id };
    attributeUpdates.push({
      node,
      attributes: Object.fromEntries(nodeUpdates),
    });
  }
  const content = patchCodeLayerNodeAttributes(cloneHtml, attributeUpdates);
  if (content === null || attributeUpdates.length !== updates.size) {
    return { status: "missing-source-span", nodeId: cloneRoot.id };
  }
  return { status: "materialized", content, rootNodeId: cloneRootNodeId };
}

export interface ComponentSourceDocument {
  source: CodeLayerSource;
  content: string;
}

export interface ComponentNodeHandle {
  fileId: string;
  nodeId: string;
}

export type ComponentPropertyEdit =
  | { kind: "style"; property: string; value: string | null }
  | { kind: "textContent"; value: string }
  | { kind: "attribute"; attribute: string; value: string }
  | { kind: "layerName"; value: string };

export interface ComponentSourceChange {
  fileId: string;
  source: CodeLayerSource;
  before: string;
  after: string;
}

export type ComponentPropertyTransformResult =
  | {
      status: "updated";
      componentId: string;
      changes: ComponentSourceChange[];
    }
  | {
      status:
        | "missing-file"
        | "ambiguous-file"
        | "source-mismatch"
        | "missing-node"
        | "ambiguous-node"
        | "missing-main"
        | "ambiguous-main"
        | "invalid-link"
        | "not-linked"
        | "missing-source-node-id"
        | "ambiguous-source-node-id"
        | "incomplete-instance"
        | "unsupported-nested-link"
        | "unsupported-edit"
        | "edit-refused"
        | "invalid-override-metadata"
        | "unsupported-reset-value";
      componentId?: string;
      fileId?: string;
      nodeId?: string;
      message?: string;
    };

export type ComponentStructureTransformResult =
  ComponentPropertyTransformResult;

interface ComponentOverride {
  sourceNodeId: string;
  property: string;
}

interface ComponentDocumentProjection {
  document: ComponentSourceDocument;
  projection: CodeLayerProjection;
}

interface ComponentNodePair {
  sourceNodeId: string;
  main: CodeLayerNode;
  instance: CodeLayerNode;
  nestedComponentNodeId?: string;
}

const LAYER_NAME_ATTR = "data-agent-native-layer-name";

function stylePropertyName(property: string): string {
  return property
    .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
    .toLowerCase();
}

function propertyKey(edit: ComponentPropertyEdit): string {
  if (edit.kind === "style") return `style:${stylePropertyName(edit.property)}`;
  if (edit.kind === "textContent") return "textContent";
  if (edit.kind === "attribute") return `attribute:${edit.attribute}`;
  return `attribute:${LAYER_NAME_ATTR}`;
}

function isUninheritedRootPlacementEdit(
  node: CodeLayerNode,
  componentRoot: CodeLayerNode,
  edit: ComponentPropertyEdit,
): boolean {
  return (
    node.id === componentRoot.id &&
    edit.kind === "style" &&
    ["left", "top", "rotate", "transform"].includes(
      stylePropertyName(edit.property),
    )
  );
}

function editIntent(
  edit: ComponentPropertyEdit,
  nodeId: string,
  selector: string,
): Parameters<typeof applyVisualEdit>[1] | null {
  const target = { nodeId, selector };
  if (edit.kind === "style") {
    if (edit.value === null) {
      return {
        kind: "style",
        operation: "remove",
        target,
        property: edit.property,
      };
    }
    return {
      kind: "style",
      target,
      property: edit.property,
      value: edit.value,
    };
  }
  if (edit.kind === "textContent") {
    return { kind: "textContent", target, value: edit.value };
  }
  if (edit.kind === "attribute") {
    return {
      kind: "attribute",
      target,
      name: edit.attribute,
      value: edit.value,
    };
  }
  return {
    kind: "attribute",
    target,
    name: LAYER_NAME_ATTR,
    value: edit.value,
  };
}

function readInheritedValue(
  document: ComponentSourceDocument,
  node: CodeLayerNode,
  edit: ComponentPropertyEdit,
): string | null {
  if (edit.kind === "style") {
    return node.style[stylePropertyName(edit.property)] ?? null;
  }
  if (edit.kind === "textContent") {
    return readCodeLayerNodeTextContent(document.content, node);
  }
  if (edit.kind === "attribute") {
    const value =
      node.dataAttributes[edit.attribute] ?? node.attributes[edit.attribute];
    return typeof value === "string" ? value : null;
  }
  return (
    resolveLayerNameAttribute((attribute) => {
      const value =
        node.dataAttributes[attribute] ?? node.attributes[attribute];
      return typeof value === "string" ? value : null;
    })?.value ?? null
  );
}

function readOverrides(node: CodeLayerNode): ComponentOverride[] | null {
  const raw = node.dataAttributes[COMPONENT_OVERRIDES_ATTR];
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    // coercion-ok: malformed metadata returns a typed null sentinel; callers reject it before any linked edits or resets write.
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const values: ComponentOverride[] = [];
  for (const entry of parsed) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.sourceNodeId !== "string" ||
      !entry.sourceNodeId.trim() ||
      typeof entry.property !== "string" ||
      !entry.property
    ) {
      return null;
    }
    values.push({
      sourceNodeId: entry.sourceNodeId,
      property: entry.property,
    });
  }
  return values;
}

function writeOverrides(
  content: string,
  source: CodeLayerSource,
  node: CodeLayerNode,
  overrides: readonly ComponentOverride[],
): string | null {
  return patchCodeLayerNodeAttributes(content, [
    {
      node,
      attributes: {
        [COMPONENT_OVERRIDES_ATTR]: overrides.length
          ? encodeURIComponent(
              JSON.stringify(
                [...overrides].sort(
                  (left, right) =>
                    left.sourceNodeId.localeCompare(right.sourceNodeId) ||
                    left.property.localeCompare(right.property),
                ),
              ),
            )
          : null,
      },
    },
  ]);
}

function updateOverride(
  overrides: readonly ComponentOverride[],
  next: ComponentOverride,
): ComponentOverride[] {
  const index = overrides.findIndex(
    (entry) =>
      entry.sourceNodeId === next.sourceNodeId &&
      entry.property === next.property,
  );
  if (index === -1) return [...overrides, next];
  return overrides.map((entry, at) => (at === index ? next : entry));
}

function projectionForDocuments(
  documents: readonly ComponentSourceDocument[],
  targetFileId: string,
):
  | { status: "ready"; values: ComponentDocumentProjection[] }
  | { status: "missing-file" | "ambiguous-file" | "source-mismatch" } {
  const ids = new Set<string>();
  for (const document of documents) {
    const { source } = document;
    if (
      source.kind !== "design-file" ||
      !source.fileId ||
      !source.designId ||
      ids.has(source.fileId)
    ) {
      return {
        status: ids.has(source.fileId ?? "")
          ? "ambiguous-file"
          : "source-mismatch",
      };
    }
    ids.add(source.fileId);
  }
  const targetMatches = documents.filter(
    (document) => document.source.fileId === targetFileId,
  );
  if (!targetMatches.length) return { status: "missing-file" };
  if (targetMatches.length > 1) return { status: "ambiguous-file" };
  const designId = targetMatches[0]?.source.designId;
  if (
    !designId ||
    documents.some((document) => document.source.designId !== designId)
  ) {
    return { status: "source-mismatch" };
  }
  return {
    status: "ready",
    values: documents.map((document) => ({
      document,
      projection: buildCodeLayerProjection(document.content, {
        source: document.source,
      }),
    })),
  };
}

function uniqueNodeByDurableId(
  projection: CodeLayerProjection,
  nodeId: string,
):
  | { status: "resolved"; node: CodeLayerNode }
  | { status: "missing-node" | "ambiguous-node" } {
  const matches = projection.nodes.filter(
    (node) => node.dataAttributes[NODE_ID_ATTR] === nodeId,
  );
  if (!matches.length) return { status: "missing-node" };
  if (matches.length !== 1 || !matches[0]) return { status: "ambiguous-node" };
  return { status: "resolved", node: matches[0] };
}

function nearestAncestorComponentMain(
  node: CodeLayerNode,
  projection: CodeLayerProjection,
): CodeLayerNode | null {
  const nodesById = new Map(projection.nodes.map((entry) => [entry.id, entry]));
  let current = node.parentId ? nodesById.get(node.parentId) : undefined;
  while (current) {
    if (hasIdentityAttribute(current, COMPONENT_ID_ATTR)) return current;
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return null;
}

function nearestAncestorComponentRoot(
  node: CodeLayerNode,
  projection: CodeLayerProjection,
): CodeLayerNode | null {
  const nodesById = new Map(projection.nodes.map((entry) => [entry.id, entry]));
  let current = node.parentId ? nodesById.get(node.parentId) : undefined;
  while (current) {
    if (
      hasIdentityAttribute(current, COMPONENT_ID_ATTR) ||
      hasIdentityAttribute(current, COMPONENT_REF_ATTR)
    ) {
      return current;
    }
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return null;
}

function hasOverride(
  node: CodeLayerNode,
  sourceNodeId: string,
  property: string,
): boolean | null {
  const overrides = readOverrides(node);
  if (!overrides) return null;
  return overrides.some(
    (entry) =>
      entry.sourceNodeId === sourceNodeId && entry.property === property,
  );
}

function hasNestedParentOverride(
  nestedReference: CodeLayerNode,
  sourceNodeId: string,
  property: string,
  documents: readonly ComponentDocumentProjection[],
): boolean | null {
  const initialDocument = documentForNode(documents, nestedReference);
  if (!initialDocument) return null;
  let projection = initialDocument.projection;
  let nestedRoot = nearestComponentRoot(nestedReference, projection);
  if (!nestedRoot) return null;

  const nodeOverride = hasOverride(nestedReference, sourceNodeId, property);
  if (nodeOverride !== false) return nodeOverride;

  const ownOverride = hasOverride(nestedRoot, sourceNodeId, property);
  if (ownOverride !== false) return ownOverride;

  let owner = nearestAncestorComponentRoot(nestedRoot, projection);
  while (owner) {
    if (hasIdentityAttribute(owner, COMPONENT_ID_ATTR)) return false;
    const ownerId = identityValue(owner, COMPONENT_REF_ATTR);
    if (!ownerId) return null;
    const ownerResolution = componentResolution(
      documents.map((entry) => entry.projection),
      ownerId,
    );
    if (ownerResolution.status !== "resolved") return null;
    const ownerDocument = documentForNode(
      documents,
      ownerResolution.value.main,
    );
    if (!ownerDocument) return null;
    const outerSourceNodeId = identityValue(
      nestedRoot,
      COMPONENT_SOURCE_NODE_ID_ATTR,
    );
    if (!outerSourceNodeId) return null;
    const ownerNestedRoot = ownerDocument.projection.nodes.find(
      (node) => identityValue(node, NODE_ID_ATTR) === outerSourceNodeId,
    );
    if (!ownerNestedRoot) return null;
    const inheritedOverride = hasOverride(
      ownerNestedRoot,
      sourceNodeId,
      property,
    );
    if (inheritedOverride !== false) return inheritedOverride;
    nestedRoot = ownerNestedRoot;
    projection = ownerDocument.projection;
    owner = nearestAncestorComponentRoot(nestedRoot, projection);
  }
  return false;
}

function inheritedParentNodeForNestedInstance(
  instance: CodeLayerNode,
  instanceDocument: ComponentDocumentProjection,
  documents: readonly ComponentDocumentProjection[],
):
  | {
      status: "found";
      document: ComponentDocumentProjection;
      node: CodeLayerNode;
    }
  | { status: "none" }
  | { status: "invalid" } {
  const nestedRoot = nearestComponentRoot(
    instance,
    instanceDocument.projection,
  );
  if (
    !nestedRoot ||
    !hasIdentityAttribute(nestedRoot, COMPONENT_REF_ATTR) ||
    hasIdentityAttribute(nestedRoot, COMPONENT_ID_ATTR)
  ) {
    return { status: "none" };
  }
  const parentRoot = nearestAncestorComponentRoot(
    nestedRoot,
    instanceDocument.projection,
  );
  if (!parentRoot || hasIdentityAttribute(parentRoot, COMPONENT_ID_ATTR)) {
    return { status: "none" };
  }
  const parentId = identityValue(parentRoot, COMPONENT_REF_ATTR);
  const nestedSourceId = identityValue(
    nestedRoot,
    COMPONENT_SOURCE_NODE_ID_ATTR,
  );
  if (!parentId || !nestedSourceId) return { status: "invalid" };
  const parentResolution = componentResolution(
    documents.map((entry) => entry.projection),
    parentId,
  );
  if (parentResolution.status !== "resolved") return { status: "invalid" };
  const parentDocument = documentForNode(
    documents,
    parentResolution.value.main,
  );
  if (!parentDocument) return { status: "invalid" };
  const parentNestedRoot = parentDocument.projection.nodes.find(
    (node) => identityValue(node, NODE_ID_ATTR) === nestedSourceId,
  );
  if (!parentNestedRoot) return { status: "invalid" };
  if (instance.id === nestedRoot.id) {
    return {
      status: "found",
      document: parentDocument,
      node: parentNestedRoot,
    };
  }
  const nestedSourceIdOfInstance = identityValue(
    instance,
    COMPONENT_SOURCE_NODE_ID_ATTR,
  );
  if (!nestedSourceIdOfInstance) return { status: "invalid" };
  const parentNodeMatches = parentDocument.projection.nodes.filter(
    (node) =>
      node.parentId &&
      node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] ===
        nestedSourceIdOfInstance,
  );
  const parentNode = parentNodeMatches.filter((node) => {
    let current: CodeLayerNode | undefined = node;
    const nodesById = new Map(
      parentDocument.projection.nodes.map((entry) => [entry.id, entry]),
    );
    while (current && current.id !== parentNestedRoot.id) {
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return current?.id === parentNestedRoot.id;
  });
  if (parentNode.length !== 1) return { status: "invalid" };
  return { status: "found", document: parentDocument, node: parentNode[0]! };
}
function componentResolution(
  projections: readonly CodeLayerProjection[],
  componentId: string,
):
  | {
      status: "resolved";
      value: Extract<ComponentLinkResolution, { status: "resolved" }>;
    }
  | {
      status:
        | "missing-main"
        | "ambiguous-main"
        | "source-mismatch"
        | "invalid-link";
    } {
  const analysis = analyzeComponentLinks(projections);
  if (
    analysis.invalidNodes.some(
      ({ node }) =>
        node.dataAttributes[COMPONENT_ID_ATTR] === componentId ||
        node.dataAttributes[COMPONENT_REF_ATTR] === componentId,
    )
  ) {
    return { status: "invalid-link" };
  }
  const result = analysis.components.find(
    (entry) => entry.componentId === componentId,
  );
  if (!result) return { status: "missing-main" };
  return result.status === "resolved"
    ? { status: "resolved", value: result }
    : { status: result.status };
}

function documentForNode(
  documents: readonly ComponentDocumentProjection[],
  node: CodeLayerNode,
): ComponentDocumentProjection | null {
  const matches = documents.filter((entry) =>
    entry.projection.nodes.includes(node),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function componentPairs(
  main: CodeLayerNode,
  mainDocument: ComponentDocumentProjection,
  references: readonly CodeLayerNode[],
  documents: readonly ComponentDocumentProjection[],
):
  | {
      status: "ready";
      byReference: Array<{
        document: ComponentDocumentProjection;
        pairs: ComponentNodePair[];
      }>;
    }
  | {
      status:
        | "missing-source-node-id"
        | "ambiguous-source-node-id"
        | "incomplete-instance"
        | "unsupported-nested-link";
    } {
  const mainByProjectionId = new Map(
    mainDocument.projection.nodes.map((node) => [node.id, node] as const),
  );
  const mainTree = atomicComponentSubtree(main, mainByProjectionId);
  if (!mainTree) return { status: "incomplete-instance" };
  if (
    mainTree.nestedRoots.some(
      (node) =>
        !hasIdentityAttribute(node, COMPONENT_REF_ATTR) ||
        hasIdentityAttribute(node, COMPONENT_ID_ATTR),
    )
  ) {
    return { status: "unsupported-nested-link" };
  }
  const allProjections = documents.map((entry) => entry.projection);
  const nestedMainNodeIds = new Map<string, string>();
  for (const nestedRoot of mainTree.nestedRoots) {
    const nestedId = identityValue(nestedRoot, COMPONENT_REF_ATTR);
    if (
      !validateNestedReference(
        nestedRoot,
        mainDocument.projection,
        allProjections,
        main,
      )
    ) {
      return { status: "unsupported-nested-link" };
    }
    const nestedResolution = nestedId
      ? componentResolution(allProjections, nestedId)
      : null;
    const nestedMainNodeId =
      nestedResolution?.status === "resolved"
        ? identityValue(nestedResolution.value.main, NODE_ID_ATTR)
        : null;
    if (!nestedMainNodeId) return { status: "unsupported-nested-link" };
    nestedMainNodeIds.set(nestedRoot.id, nestedMainNodeId);
  }
  const mainSubtree = mainTree.nodes;
  const sourceIds = new Map<string, CodeLayerNode>();
  for (const node of mainSubtree) {
    const sourceNodeId = identityValue(node, NODE_ID_ATTR);
    if (!sourceNodeId) return { status: "missing-source-node-id" };
    if (sourceIds.has(sourceNodeId))
      return { status: "ambiguous-source-node-id" };
    sourceIds.set(sourceNodeId, node);
  }

  const byReference: Array<{
    document: ComponentDocumentProjection;
    pairs: ComponentNodePair[];
  }> = [];
  for (const reference of references) {
    const document = documentForNode(documents, reference);
    if (!document) return { status: "incomplete-instance" };
    const instanceByProjectionId = new Map(
      document.projection.nodes.map((node) => [node.id, node] as const),
    );
    const instanceTree = atomicComponentSubtree(
      reference,
      instanceByProjectionId,
    );
    if (!instanceTree) return { status: "incomplete-instance" };
    if (
      instanceTree.nestedRoots.some(
        (node) =>
          !hasIdentityAttribute(node, COMPONENT_REF_ATTR) ||
          hasIdentityAttribute(node, COMPONENT_ID_ATTR),
      )
    ) {
      return { status: "unsupported-nested-link" };
    }
    const instanceSubtree = instanceTree.nodes;
    const pairs: ComponentNodePair[] = [];
    for (const [sourceNodeId, mainNode] of sourceIds) {
      let instanceNode: CodeLayerNode | undefined;
      if (mainNode.id === main.id) {
        instanceNode = reference;
      } else {
        const matches = instanceSubtree.filter(
          (node) =>
            node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] === sourceNodeId,
        );
        if (matches.length > 1) return { status: "ambiguous-source-node-id" };
        instanceNode = matches[0];
      }
      if (!instanceNode || instanceNode.tag !== mainNode.tag) {
        return { status: "incomplete-instance" };
      }
      if (mainNode.id !== main.id) {
        const mainParent = mainNode.parentId
          ? mainByProjectionId.get(mainNode.parentId)
          : undefined;
        const instanceParent = instanceNode.parentId
          ? instanceByProjectionId.get(instanceNode.parentId)
          : undefined;
        const parentSourceNodeId = mainParent
          ? identityValue(mainParent, NODE_ID_ATTR)
          : null;
        const instanceParentSourceNodeId = instanceParent
          ? instanceParent.id === reference.id
            ? identityValue(main, NODE_ID_ATTR)
            : instanceParent.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]
          : null;
        if (parentSourceNodeId !== instanceParentSourceNodeId) {
          return { status: "incomplete-instance" };
        }
      }
      pairs.push({
        sourceNodeId,
        main: mainNode,
        instance: instanceNode,
        ...(nestedMainNodeIds.has(mainNode.id)
          ? { nestedComponentNodeId: nestedMainNodeIds.get(mainNode.id) }
          : {}),
      });
    }
    const directPairs = [...pairs];
    if (
      directPairs.length !== mainSubtree.length ||
      instanceSubtree.length !== directPairs.length
    ) {
      return { status: "incomplete-instance" };
    }
    if (
      mainTree.nestedRoots.length !== instanceTree.nestedRoots.length ||
      mainTree.nestedRoots.some((mainNestedRoot) => {
        const sourceNodeId = identityValue(mainNestedRoot, NODE_ID_ATTR);
        const nestedReferenceId = identityValue(
          mainNestedRoot,
          COMPONENT_REF_ATTR,
        );
        const matches = instanceTree.nestedRoots.filter(
          (instanceNestedRoot) =>
            instanceNestedRoot.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] ===
            sourceNodeId,
        );
        return (
          !sourceNodeId ||
          matches.length !== 1 ||
          identityValue(matches[0]!, COMPONENT_REF_ATTR) !== nestedReferenceId
        );
      })
    ) {
      return { status: "unsupported-nested-link" };
    }
    for (const mainNestedRoot of mainTree.nestedRoots) {
      const outerSourceNodeId = identityValue(mainNestedRoot, NODE_ID_ATTR);
      const nestedComponentRootId = nestedMainNodeIds.get(mainNestedRoot.id);
      const instanceNestedRoot = outerSourceNodeId
        ? instanceTree.nestedRoots.find(
            (node) =>
              node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] ===
                outerSourceNodeId &&
              identityValue(node, COMPONENT_REF_ATTR) ===
                identityValue(mainNestedRoot, COMPONENT_REF_ATTR),
          )
        : undefined;
      const mainNestedSubtree = descendantsOf(
        mainNestedRoot,
        mainByProjectionId,
      );
      const instanceNestedSubtree = instanceNestedRoot
        ? descendantsOf(instanceNestedRoot, instanceByProjectionId)
        : null;
      if (
        !outerSourceNodeId ||
        !nestedComponentRootId ||
        !instanceNestedRoot ||
        !mainNestedSubtree ||
        !instanceNestedSubtree ||
        mainNestedSubtree.length !== instanceNestedSubtree.length ||
        mainNestedSubtree
          .slice(1)
          .some(
            (node) =>
              hasIdentityAttribute(node, COMPONENT_ID_ATTR) ||
              hasIdentityAttribute(node, COMPONENT_REF_ATTR),
          )
      ) {
        return { status: "unsupported-nested-link" };
      }
      const nestedSourceIds = new Set<string>();
      for (let index = 1; index < mainNestedSubtree.length; index += 1) {
        const mainNode = mainNestedSubtree[index];
        const instanceNode = instanceNestedSubtree[index];
        const nestedSourceNodeId = mainNode
          ? identityValue(mainNode, COMPONENT_SOURCE_NODE_ID_ATTR)
          : null;
        const instanceSourceNodeId = instanceNode
          ? identityValue(instanceNode, COMPONENT_SOURCE_NODE_ID_ATTR)
          : null;
        const childParentId = mainNode?.parentId
          ? mainByProjectionId.get(mainNode.parentId)
          : undefined;
        const instanceParentId = instanceNode?.parentId
          ? instanceByProjectionId.get(instanceNode.parentId)
          : undefined;
        const expectedParentSourceId = childParentId
          ? childParentId === mainNestedRoot
            ? nestedComponentRootId
            : identityValue(childParentId, COMPONENT_SOURCE_NODE_ID_ATTR)
          : null;
        const actualParentSourceId = instanceParentId
          ? instanceParentId === instanceNestedRoot
            ? nestedComponentRootId
            : identityValue(instanceParentId, COMPONENT_SOURCE_NODE_ID_ATTR)
          : null;
        if (
          !mainNode ||
          !instanceNode ||
          mainNode.tag !== instanceNode.tag ||
          mainNode.children.length !== instanceNode.children.length ||
          !nestedSourceNodeId ||
          nestedSourceNodeId !== instanceSourceNodeId ||
          nestedSourceIds.has(nestedSourceNodeId) ||
          expectedParentSourceId !== actualParentSourceId
        ) {
          return { status: "incomplete-instance" };
        }
        nestedSourceIds.add(nestedSourceNodeId);
        pairs.push({
          sourceNodeId: `nested:${outerSourceNodeId}:${nestedSourceNodeId}`,
          main: mainNode,
          instance: instanceNode,
          nestedComponentNodeId: nestedSourceNodeId,
        });
      }
    }
    const pairBySourceId = new Map(
      directPairs.map((pair) => [pair.sourceNodeId, pair]),
    );
    for (const pair of directPairs) {
      if (mainTree.nestedRoots.some((node) => node.id === pair.main.id)) {
        continue;
      }
      const expectedChildren = pair.main.children.map((childId) => {
        const child = mainByProjectionId.get(childId);
        return child ? identityValue(child, NODE_ID_ATTR) : null;
      });
      const actualChildren = pair.instance.children.map((childId) => {
        const child = instanceByProjectionId.get(childId);
        return child?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] ?? null;
      });
      if (
        expectedChildren.some(
          (nodeId) => !nodeId || !pairBySourceId.has(nodeId),
        ) ||
        expectedChildren.length !== actualChildren.length ||
        expectedChildren.some(
          (nodeId, index) => nodeId !== actualChildren[index],
        )
      ) {
        return { status: "incomplete-instance" };
      }
    }
    byReference.push({ document, pairs });
  }
  return { status: "ready", byReference };
}

interface ComponentStructureTree {
  nodes: CodeLayerNode[];
  bySourceId: Map<string, CodeLayerNode>;
  nestedBySourceId: Map<string, CodeLayerNode>;
}

type ComponentStructureFailureStatus = Exclude<
  ComponentPropertyTransformResult["status"],
  "updated"
>;

function componentStructureTree(
  root: CodeLayerNode,
  projection: CodeLayerProjection,
):
  | { status: "ready"; value: ComponentStructureTree }
  | { status: ComponentStructureFailureStatus } {
  const nodesById = new Map(
    projection.nodes.map((node) => [node.id, node] as const),
  );
  const atomic = atomicComponentSubtree(root, nodesById);
  if (!atomic) return { status: "incomplete-instance" };

  const sourceIdCounts = new Map<string, number>();
  for (const node of projection.nodes) {
    const sourceId = identityValue(node, NODE_ID_ATTR);
    if (sourceId) {
      sourceIdCounts.set(sourceId, (sourceIdCounts.get(sourceId) ?? 0) + 1);
    }
  }

  const bySourceId = new Map<string, CodeLayerNode>();
  for (const node of atomic.nodes) {
    const sourceId = identityValue(node, NODE_ID_ATTR);
    if (
      !sourceId ||
      sourceIdCounts.get(sourceId) !== 1 ||
      bySourceId.has(sourceId)
    ) {
      return {
        status: sourceId
          ? "ambiguous-source-node-id"
          : "missing-source-node-id",
      };
    }
    bySourceId.set(sourceId, node);
  }

  const nestedBySourceId = new Map<string, CodeLayerNode>();
  for (const nestedRoot of atomic.nestedRoots) {
    const sourceId = identityValue(nestedRoot, NODE_ID_ATTR);
    if (
      !sourceId ||
      !identityValue(nestedRoot, COMPONENT_REF_ATTR) ||
      hasIdentityAttribute(nestedRoot, COMPONENT_ID_ATTR) ||
      nestedBySourceId.has(sourceId)
    ) {
      return { status: "unsupported-nested-link" };
    }
    nestedBySourceId.set(sourceId, nestedRoot);
  }

  return {
    status: "ready",
    value: { nodes: atomic.nodes, bySourceId, nestedBySourceId },
  };
}

function sourceMarkup(content: string, node: CodeLayerNode): string | null {
  const span = node.source;
  if (
    !span ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > content.length
  ) {
    return null;
  }
  return content.slice(span.start, span.end);
}

interface RenderedComponentChild {
  sourceNodeId: string;
  content: string;
  idMap: Map<string, string>;
}

function renderComponentChildren(
  content: string,
  sourceContent: string,
  container: CodeLayerNode,
  sourceNodesById: ReadonlyMap<string, CodeLayerNode>,
  children: readonly RenderedComponentChild[],
): string | null {
  const span = container.source;
  if (!span) return null;
  if (
    span.start < 0 ||
    span.end <= span.start ||
    span.end > sourceContent.length ||
    span.end - span.start !== content.length
  ) {
    return null;
  }
  if (span.contentStart === undefined || span.contentEnd === undefined) {
    return children.length === 0 ? content : null;
  }
  if (
    span.contentStart < span.openEnd ||
    span.contentEnd < span.contentStart ||
    span.contentEnd > sourceContent.length
  ) {
    return null;
  }

  const localContentStart = span.contentStart - span.start;
  const localContentEnd = span.contentEnd - span.start;
  if (
    localContentStart < 0 ||
    localContentEnd < localContentStart ||
    localContentEnd > content.length
  ) {
    return null;
  }

  const directChildren: CodeLayerNode[] = [];
  let previousEnd = span.contentStart;
  for (const childId of container.children) {
    const child = sourceNodesById.get(childId);
    if (!child?.source) return null;
    const childStart = child.source.start;
    const childEnd = child.source.end;
    if (
      childStart < span.contentStart ||
      childEnd <= childStart ||
      childEnd > span.contentEnd ||
      childStart < previousEnd
    ) {
      return null;
    }
    directChildren.push(child);
    previousEnd = childEnd;
  }

  const gaps: string[] = [];
  let cursor = span.contentStart;
  for (const child of directChildren) {
    const childStart = child.source?.start;
    const childEnd = child.source?.end;
    if (childStart === undefined || childEnd === undefined) return null;
    gaps.push(sourceContent.slice(cursor, childStart));
    cursor = childEnd;
  }
  gaps.push(sourceContent.slice(cursor, span.contentEnd));

  const seenChildren = new Set<string>();
  for (const child of children) {
    if (seenChildren.has(child.sourceNodeId)) return null;
    seenChildren.add(child.sourceNodeId);
  }

  const hasOldSlots = directChildren.length > 0;
  const middleGaps = hasOldSlots ? gaps.slice(1, -1) : [];
  const prefix = gaps[0] ?? "";
  const suffix = hasOldSlots ? (gaps[gaps.length - 1] ?? "") : "";
  const renderedSourceIds = new Set(
    children.map((child) => child.sourceNodeId),
  );
  const originalSourceIds: string[] = [];
  for (const child of directChildren) {
    const sourceNodeId =
      identityValue(child, COMPONENT_SOURCE_NODE_ID_ATTR) ??
      identityValue(child, NODE_ID_ATTR);
    if (!sourceNodeId) return null;
    originalSourceIds.push(sourceNodeId);
  }
  const gapsBeforeSourceId = new Map<string, string>();
  let trailingGaps = "";
  let nextRenderedSourceId: string | undefined;
  for (let index = middleGaps.length - 1; index >= 0; index -= 1) {
    const candidateSourceId = originalSourceIds[index + 1];
    if (candidateSourceId && renderedSourceIds.has(candidateSourceId)) {
      nextRenderedSourceId = candidateSourceId;
    }
    const gap = middleGaps[index] ?? "";
    if (nextRenderedSourceId) {
      gapsBeforeSourceId.set(
        nextRenderedSourceId,
        `${gap}${gapsBeforeSourceId.get(nextRenderedSourceId) ?? ""}`,
      );
    } else {
      trailingGaps = `${gap}${trailingGaps}`;
    }
  }
  let rebuilt = prefix;
  for (const child of children) {
    rebuilt += gapsBeforeSourceId.get(child.sourceNodeId) ?? "";
    rebuilt += child.content;
  }
  rebuilt += trailingGaps;
  rebuilt += suffix;

  return (
    content.slice(0, localContentStart) +
    rebuilt +
    content.slice(localContentEnd)
  );
}

function relativeSourceNode(
  node: CodeLayerNode,
  baseStart: number,
): CodeLayerNode {
  const source = node.source;
  if (!source) return node;
  return {
    ...node,
    source: {
      ...source,
      start: source.start - baseStart,
      end: source.end - baseStart,
      openStart: source.openStart - baseStart,
      openEnd: source.openEnd - baseStart,
      contentStart:
        source.contentStart === undefined
          ? undefined
          : source.contentStart - baseStart,
      contentEnd:
        source.contentEnd === undefined
          ? undefined
          : source.contentEnd - baseStart,
      closeStart:
        source.closeStart === undefined
          ? undefined
          : source.closeStart - baseStart,
      closeEnd:
        source.closeEnd === undefined ? undefined : source.closeEnd - baseStart,
    },
  };
}

const COMPONENT_SPACE_IDREF_ATTRIBUTES = new Set([
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  "headers",
]);
const COMPONENT_SINGLE_IDREF_ATTRIBUTES = new Set(["for", "form", "list"]);
const COMPONENT_FRAGMENT_IDREF_ATTRIBUTES = new Set(["href", "xlink:href"]);

interface ComponentMarkupElement {
  tagName?: string;
  attrs?: Array<{
    name: string;
    value: string;
    prefix?: string;
  }>;
  childNodes?: unknown[];
  content?: { childNodes?: unknown[] };
  sourceCodeLocation?: {
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
  };
}

interface ComponentMarkupReplacement {
  start: number;
  end: number;
  value: string;
}

function componentMarkupElements(content: string): ComponentMarkupElement[] {
  const elements: ComponentMarkupElement[] = [];
  const visit = (node: unknown) => {
    const element = node as ComponentMarkupElement;
    if (typeof element.tagName === "string") elements.push(element);
    for (const child of [
      ...(element.childNodes ?? []),
      ...(element.content?.childNodes ?? []),
    ]) {
      visit(child);
    }
  };
  visit(parseFragment(content, { sourceCodeLocationInfo: true }));
  return elements;
}

function componentMarkupAttributeName(attribute: {
  name: string;
  prefix?: string;
}): string {
  return (attribute.prefix ? `${attribute.prefix}:` : "") + attribute.name;
}

function componentMarkupAttributeLocation(
  element: ComponentMarkupElement,
  name: string,
): { startOffset: number; endOffset: number } | undefined {
  const attributes = element.sourceCodeLocation?.attrs;
  return attributes?.[name] ?? attributes?.[name.toLowerCase()];
}

function escapeComponentAttributeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rewriteComponentIdReferences(
  value: string,
  attributeName: string,
  idMap: ReadonlyMap<string, string>,
): string {
  if (COMPONENT_SPACE_IDREF_ATTRIBUTES.has(attributeName)) {
    const ids = value.trim() ? value.trim().split(/\s+/) : [];
    const mapped = ids.map((id) => idMap.get(id) ?? id);
    return mapped.some((id, index) => id !== ids[index])
      ? mapped.join(" ")
      : value;
  }
  if (COMPONENT_SINGLE_IDREF_ATTRIBUTES.has(attributeName)) {
    return idMap.get(value) ?? value;
  }
  if (COMPONENT_FRAGMENT_IDREF_ATTRIBUTES.has(attributeName)) {
    if (!value.startsWith("#")) return value;
    const replacement = idMap.get(value.slice(1));
    return replacement ? `#${replacement}` : value;
  }
  if (value.includes("url(")) {
    const rewritten = value.replace(
      /url\(\s*(["']?)#([^\s)'";]+)\1\s*\)/g,
      (match, quote: string, id: string) => {
        const replacement = idMap.get(id);
        return replacement ? `url(${quote}#${replacement}${quote})` : match;
      },
    );
    if (rewritten !== value) return rewritten;
  }
  if (attributeName === "begin" || attributeName === "end") {
    const parts = value.split(";");
    let changed = false;
    const rewritten = parts
      .map((part) => {
        const trimmed = part.trim();
        const separator = trimmed.indexOf(".");
        if (separator <= 0) return part;
        const replacement = idMap.get(trimmed.slice(0, separator));
        if (!replacement) return part;
        changed = true;
        const start = part.indexOf(trimmed);
        return (
          part.slice(0, start) +
          replacement +
          trimmed.slice(separator) +
          part.slice(start + trimmed.length)
        );
      })
      .join(";");
    return changed ? rewritten : value;
  }
  return value;
}

function rewriteComponentMarkupIds(
  content: string,
  inheritedIdMap: ReadonlyMap<string, string>,
  createId?: (sourceId: string) => string,
): { content: string; idMap: Map<string, string> } | null {
  const idMap = new Map(inheritedIdMap);
  const elements = componentMarkupElements(content);
  const authoredIds = elements.flatMap((element) =>
    (element.attrs ?? [])
      .filter(
        (attribute) => attribute.name.toLowerCase() === "id" && attribute.value,
      )
      .map((attribute) => attribute.value),
  );
  if (new Set(authoredIds).size !== authoredIds.length) return null;
  const replacements: ComponentMarkupReplacement[] = [];

  for (const element of elements) {
    for (const attribute of element.attrs ?? []) {
      if (attribute.name.toLowerCase() !== "id" || !attribute.value) continue;
      if (!createId) continue;
      const nextId = createId(attribute.value);
      idMap.set(attribute.value, nextId);
      const name = componentMarkupAttributeName(attribute);
      const location = componentMarkupAttributeLocation(element, name);
      if (!location) return null;
      replacements.push({
        start: location.startOffset,
        end: location.endOffset,
        value: `${name}="${escapeComponentAttributeValue(nextId)}"`,
      });
    }
  }

  for (const element of elements) {
    for (const attribute of element.attrs ?? []) {
      const name = componentMarkupAttributeName(attribute);
      const lowerName = name.toLowerCase();
      if (lowerName === "id" && createId) continue;
      const nextValue = rewriteComponentIdReferences(
        attribute.value,
        lowerName,
        idMap,
      );
      if (nextValue === attribute.value) continue;
      const location = componentMarkupAttributeLocation(element, name);
      if (!location) return null;
      replacements.push({
        start: location.startOffset,
        end: location.endOffset,
        value: `${name}="${escapeComponentAttributeValue(nextValue)}"`,
      });
    }
  }

  const uniqueReplacements = [
    ...new Map(
      replacements.map((replacement) => [replacement.start, replacement]),
    ).values(),
  ];
  let rewritten = content;
  for (const replacement of uniqueReplacements.sort(
    (left, right) => right.start - left.start,
  )) {
    rewritten =
      rewritten.slice(0, replacement.start) +
      replacement.value +
      rewritten.slice(replacement.end);
  }
  return { content: rewritten, idMap };
}

function componentMarkupIds(content: string): Set<string> {
  const ids = new Set<string>();
  for (const element of componentMarkupElements(content)) {
    for (const attribute of element.attrs ?? []) {
      if (attribute.name.toLowerCase() === "id" && attribute.value) {
        ids.add(attribute.value);
      }
    }
  }
  return ids;
}

function componentMarkupIdList(content: string): string[] {
  return componentMarkupElements(content).flatMap((element) =>
    (element.attrs ?? [])
      .filter(
        (attribute) => attribute.name.toLowerCase() === "id" && attribute.value,
      )
      .map((attribute) => attribute.value),
  );
}

function componentMarkupAuthoredIdMap(
  sourceContent: string,
  sourceNode: CodeLayerNode,
  targetContent: string,
  targetNode: CodeLayerNode,
): Map<string, string> | null {
  const sourceMarkupContent = sourceMarkup(sourceContent, sourceNode);
  const targetMarkupContent = sourceMarkup(targetContent, targetNode);
  if (sourceMarkupContent === null || targetMarkupContent === null) {
    return null;
  }
  const sourceIds = componentMarkupIdList(sourceMarkupContent);
  const targetIds = componentMarkupIdList(targetMarkupContent);
  if (
    sourceIds.length !== targetIds.length ||
    new Set(sourceIds).size !== sourceIds.length ||
    new Set(targetIds).size !== targetIds.length
  ) {
    return null;
  }
  const idMap = new Map<string, string>();
  for (let index = 0; index < sourceIds.length; index += 1) {
    const sourceId = sourceIds[index];
    const targetId = targetIds[index];
    if (sourceId && targetId && sourceId !== targetId) {
      idMap.set(sourceId, targetId);
    }
  }
  return idMap;
}

function componentChildPlaceholders(
  sourceContent: string,
  children: readonly RenderedComponentChild[],
): string[] {
  const usedContent = [
    sourceContent,
    ...children.map((child) => child.content),
  ];
  return children.map((_, index) => {
    let attempt = 0;
    let placeholder = `an-protected-component-child-${index}`;
    while (usedContent.some((content) => content.includes(placeholder))) {
      attempt += 1;
      placeholder = `an-protected-component-child-${index}-${attempt}`;
    }
    usedContent.push(placeholder);
    return placeholder;
  });
}

function nextComponentInstanceNodeId(
  fileId: string,
  sourceNodeId: string,
  usedIds: Set<string>,
): string {
  const base =
    "an-instance-" +
    (fileId + ":" + sourceNodeId).replace(/[^A-Za-z0-9_.:-]/g, "-");
  let value = base;
  let suffix = 1;
  while (usedIds.has(value)) {
    value = base + ":" + suffix;
    suffix += 1;
  }
  usedIds.add(value);
  return value;
}

function nextComponentAuthoredId(
  fileId: string,
  sourceNodeId: string,
  authoredId: string,
  usedIds: Set<string>,
): string {
  const base = (
    "an-instance-" +
    fileId +
    ":" +
    sourceNodeId +
    ":id:" +
    authoredId
  ).replace(/[^A-Za-z0-9_.:-]/g, "-");
  let value = base;
  let suffix = 1;
  while (usedIds.has(value)) {
    value = base + ":" + suffix;
    suffix += 1;
  }
  usedIds.add(value);
  return value;
}

interface ComponentStructureReferenceContext {
  source: CodeLayerSource;
  newMainContent: string;
  newMainNodesById: ReadonlyMap<string, CodeLayerNode>;
  oldMainTree: ComponentStructureTree;
  newMainTree: ComponentStructureTree;
  oldMainContent: string;
  oldDocument: ComponentSourceDocument;
  oldInstanceBySourceId: ReadonlyMap<string, CodeLayerNode>;
  oldInstanceNodesById: ReadonlyMap<string, CodeLayerNode>;
  usedInstanceNodeIds: Set<string>;
  visiting: Set<string>;
}

function renderNewNestedComponentNode(
  node: CodeLayerNode,
  context: ComponentStructureReferenceContext,
):
  | { status: "ready"; content: string; idMap: Map<string, string> }
  | { status: ComponentStructureFailureStatus } {
  const sourceNodeId = identityValue(node, NODE_ID_ATTR);
  const span = node.source;
  if (!sourceNodeId || !span) return { status: "incomplete-instance" };
  if (
    !identityValue(node, COMPONENT_REF_ATTR) ||
    hasIdentityAttribute(node, COMPONENT_ID_ATTR)
  ) {
    return { status: "unsupported-nested-link" };
  }
  const subtree = descendantsOf(node, context.newMainNodesById);
  const nodeContent = sourceMarkup(context.newMainContent, node);
  if (!subtree || nodeContent === null) {
    return { status: "incomplete-instance" };
  }
  if (
    subtree
      .slice(1)
      .some(
        (descendant) =>
          hasIdentityAttribute(descendant, COMPONENT_ID_ATTR) ||
          hasIdentityAttribute(descendant, COMPONENT_REF_ATTR),
      )
  ) {
    return { status: "unsupported-nested-link" };
  }

  const updates: Array<{
    node: CodeLayerNode;
    attributes: Record<string, string | null>;
  }> = [];
  for (const descendant of subtree) {
    const descendantSourceNodeId = identityValue(descendant, NODE_ID_ATTR);
    if (!descendantSourceNodeId || !descendant.source) {
      return { status: "missing-source-node-id" };
    }
    if (
      descendant.id !== node.id &&
      !identityValue(descendant, COMPONENT_SOURCE_NODE_ID_ATTR)
    ) {
      return { status: "missing-source-node-id" };
    }
    updates.push({
      node: relativeSourceNode(descendant, span.start),
      attributes: {
        [NODE_ID_ATTR]: nextComponentInstanceNodeId(
          context.source.fileId ?? "document",
          descendantSourceNodeId,
          context.usedInstanceNodeIds,
        ),
        ...(descendant.id === node.id
          ? { [COMPONENT_SOURCE_NODE_ID_ATTR]: sourceNodeId }
          : {}),
      },
    });
  }
  const patched = patchCodeLayerNodeAttributes(nodeContent, updates);
  if (patched === null) return { status: "incomplete-instance" };
  const rewritten = rewriteComponentMarkupIds(
    patched,
    new Map(),
    (authoredId) =>
      nextComponentAuthoredId(
        context.source.fileId ?? "document",
        sourceNodeId,
        authoredId,
        context.usedInstanceNodeIds,
      ),
  );
  if (rewritten === null) return { status: "incomplete-instance" };
  return {
    status: "ready",
    content: rewritten.content,
    idMap: rewritten.idMap,
  };
}

function renderComponentStructureNode(
  node: CodeLayerNode,
  context: ComponentStructureReferenceContext,
):
  | { status: "ready"; content: string; idMap: Map<string, string> }
  | { status: ComponentStructureFailureStatus } {
  const sourceNodeId = identityValue(node, NODE_ID_ATTR);
  if (!sourceNodeId || context.visiting.has(sourceNodeId)) {
    return { status: "incomplete-instance" };
  }
  context.visiting.add(sourceNodeId);

  try {
    if (context.newMainTree.nestedBySourceId.has(sourceNodeId)) {
      const instanceNode = context.oldInstanceBySourceId.get(sourceNodeId);
      if (!instanceNode) {
        return renderNewNestedComponentNode(node, context);
      }
      const content = sourceMarkup(context.oldDocument.content, instanceNode);
      const mainNode = context.oldMainTree.bySourceId.get(sourceNodeId);
      const idMap =
        mainNode && instanceNode
          ? componentMarkupAuthoredIdMap(
              context.oldMainContent,
              mainNode,
              context.oldDocument.content,
              instanceNode,
            )
          : new Map<string, string>();
      if (idMap === null) return { status: "incomplete-instance" };
      return content === null
        ? { status: "unsupported-nested-link" }
        : { status: "ready", content, idMap };
    }

    const oldMainNode = context.oldMainTree.bySourceId.get(sourceNodeId);
    const oldInstanceNode = context.oldInstanceBySourceId.get(sourceNodeId);
    const isExisting = Boolean(oldMainNode);
    if (isExisting !== Boolean(oldInstanceNode)) {
      return { status: "incomplete-instance" };
    }

    const sourceContainer = isExisting ? oldInstanceNode! : node;
    const sourceContent = isExisting
      ? context.oldDocument.content
      : context.newMainContent;
    const nodeContent = sourceMarkup(sourceContent, sourceContainer);
    if (nodeContent === null) return { status: "incomplete-instance" };

    const sourceNodesById = isExisting
      ? context.oldInstanceNodesById
      : context.newMainNodesById;
    const renderedChildren: RenderedComponentChild[] = [];
    for (const childId of node.children) {
      const child = context.newMainNodesById.get(childId);
      if (!child) return { status: "incomplete-instance" };
      const rendered = renderComponentStructureNode(child, context);
      if (rendered.status !== "ready") return rendered;
      const childSourceNodeId = identityValue(child, NODE_ID_ATTR);
      if (!childSourceNodeId) return { status: "missing-source-node-id" };
      renderedChildren.push({
        sourceNodeId: childSourceNodeId,
        content: rendered.content,
        idMap: rendered.idMap,
      });
    }

    const childIdMap =
      isExisting && oldMainNode && oldInstanceNode
        ? componentMarkupAuthoredIdMap(
            context.oldMainContent,
            oldMainNode,
            context.oldDocument.content,
            oldInstanceNode,
          )
        : new Map<string, string>();
    if (childIdMap === null) return { status: "incomplete-instance" };
    for (const child of renderedChildren) {
      for (const [sourceId, instanceId] of child.idMap) {
        const prior = childIdMap.get(sourceId);
        if (prior && prior !== instanceId) {
          return { status: "ambiguous-source-node-id" };
        }
        childIdMap.set(sourceId, instanceId);
      }
    }
    const placeholders = componentChildPlaceholders(
      nodeContent,
      renderedChildren,
    );
    const rendered = renderComponentChildren(
      nodeContent,
      sourceContent,
      sourceContainer,
      sourceNodesById,
      renderedChildren.map((child, index) => ({
        ...child,
        content: placeholders[index]!,
      })),
    );
    if (rendered === null) return { status: "incomplete-instance" };
    let markup = rendered;
    if (!isExisting) {
      if (
        hasIdentityAttribute(node, COMPONENT_ID_ATTR) ||
        hasIdentityAttribute(node, COMPONENT_REF_ATTR)
      ) {
        return { status: "unsupported-nested-link" };
      }
      const instanceNodeId = nextComponentInstanceNodeId(
        context.source.fileId ?? "document",
        sourceNodeId,
        context.usedInstanceNodeIds,
      );
      const patched = patchCodeLayerNodeAttributes(markup, [
        {
          node: relativeSourceNode(node, node.source?.start ?? 0),
          attributes: {
            [NODE_ID_ATTR]: instanceNodeId,
            [COMPONENT_SOURCE_NODE_ID_ATTR]: sourceNodeId,
            [COMPONENT_ID_ATTR]: null,
            [COMPONENT_REF_ATTR]: null,
            [COMPONENT_OVERRIDES_ATTR]: null,
          },
        },
      ]);
      if (patched === null) return { status: "incomplete-instance" };
      markup = patched;
    }
    const rewritten = rewriteComponentMarkupIds(
      markup,
      childIdMap,
      isExisting
        ? undefined
        : (authoredId) =>
            nextComponentAuthoredId(
              context.source.fileId ?? "document",
              sourceNodeId,
              authoredId,
              context.usedInstanceNodeIds,
            ),
    );
    if (rewritten === null) return { status: "incomplete-instance" };
    let content = rewritten.content;
    const normalizedChildren: RenderedComponentChild[] = [];
    for (const child of renderedChildren) {
      const normalized = rewriteComponentMarkupIds(
        child.content,
        rewritten.idMap,
      );
      if (normalized === null) return { status: "incomplete-instance" };
      normalizedChildren.push({
        sourceNodeId: child.sourceNodeId,
        content: normalized.content,
        idMap: child.idMap,
      });
    }
    for (const [index, placeholder] of placeholders.entries()) {
      const child = normalizedChildren[index];
      if (!child || !content.includes(placeholder)) {
        return { status: "incomplete-instance" };
      }
      content = content.split(placeholder).join(child.content);
    }
    return { status: "ready", content, idMap: rewritten.idMap };
  } finally {
    context.visiting.delete(sourceNodeId);
  }
}

function referenceNodeForSource(
  projection: CodeLayerProjection,
  sourceNodeId: string,
  mainRootSourceNodeId: string,
  referenceRootNodeId: string,
):
  | { status: "resolved"; node: CodeLayerNode }
  | { status: ComponentStructureFailureStatus } {
  if (sourceNodeId === mainRootSourceNodeId) {
    const root = uniqueNodeByDurableId(projection, referenceRootNodeId);
    return root.status === "resolved" ? root : { status: root.status };
  }
  const matches = projection.nodes.filter(
    (node) =>
      node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] === sourceNodeId,
  );
  if (matches.length === 0) return { status: "missing-source-node-id" };
  return matches.length === 1 && matches[0]
    ? { status: "resolved", node: matches[0] }
    : { status: "ambiguous-source-node-id" };
}

function applyStructureValueEdit(
  content: string,
  source: CodeLayerSource,
  node: CodeLayerNode,
  edit: ComponentPropertyEdit,
):
  | { status: "applied"; content: string }
  | { status: ComponentStructureFailureStatus; message?: string } {
  const intent = editIntent(edit, node.id, node.selector);
  if (!intent) return { status: "unsupported-edit" };
  const result = applyVisualEdit(content, intent, { source });
  if (result.result.status !== "applied") {
    return { status: "edit-refused", message: result.result.message };
  }
  return { status: "applied", content: result.content };
}

const STRUCTURE_INSTANCE_ATTRIBUTES = new Set([
  "id",
  NODE_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  "data-agent-native-hidden",
  "data-agent-native-locked",
]);

function canSyncStructureAttribute(name: string): boolean {
  const lowerName = name.toLowerCase();
  return !STRUCTURE_INSTANCE_ATTRIBUTES.has(lowerName) && lowerName !== "style";
}

function structureAttributeValue(
  value: string | true | undefined,
): string | null {
  if (value === undefined) return null;
  return value === true ? "" : value;
}

function syncInheritedStructureValues(args: {
  content: string;
  source: CodeLayerSource;
  mainRootSourceNodeId: string;
  referenceRootNodeId: string;
  oldMainTree: ComponentStructureTree;
  newMainTree: ComponentStructureTree;
  oldMainContent: string;
  newMainContent: string;
}):
  | { status: "ready"; content: string }
  | { status: ComponentStructureFailureStatus; message?: string } {
  let content = args.content;

  for (const sourceNodeId of [...args.newMainTree.bySourceId.keys()].sort()) {
    const oldMainNode = args.oldMainTree.bySourceId.get(sourceNodeId);
    const newMainNode = args.newMainTree.bySourceId.get(sourceNodeId);
    if (!oldMainNode || !newMainNode) continue;
    if (
      args.oldMainTree.nestedBySourceId.has(sourceNodeId) ||
      args.newMainTree.nestedBySourceId.has(sourceNodeId)
    ) {
      continue;
    }

    const projection = buildCodeLayerProjection(content, {
      source: args.source,
    });
    const current = referenceNodeForSource(
      projection,
      sourceNodeId,
      args.mainRootSourceNodeId,
      args.referenceRootNodeId,
    );
    if (current.status !== "resolved") return current;
    const overrides = readOverrides(current.node);
    if (!overrides) return { status: "invalid-override-metadata" };

    const attributes: Record<string, string | null> = {};
    const attributeNames = new Set([
      ...Object.keys(oldMainNode.attributes),
      ...Object.keys(oldMainNode.dataAttributes),
      ...Object.keys(newMainNode.attributes),
      ...Object.keys(newMainNode.dataAttributes),
    ]);
    for (const name of [...attributeNames].sort()) {
      if (!canSyncStructureAttribute(name)) continue;
      const before =
        oldMainNode.dataAttributes[name] ?? oldMainNode.attributes[name];
      const after =
        newMainNode.dataAttributes[name] ?? newMainNode.attributes[name];
      if (before === after) continue;
      if (
        overrides.some(
          (entry) =>
            entry.sourceNodeId === sourceNodeId &&
            entry.property === "attribute:" + name,
        )
      ) {
        continue;
      }
      attributes[name] = structureAttributeValue(after);
    }
    if (Object.keys(attributes).length > 0) {
      const patched = patchCodeLayerNodeAttributes(content, [
        { node: current.node, attributes },
      ]);
      if (patched === null) return { status: "incomplete-instance" };
      content = patched;
    }

    const styleProperties = new Set([
      ...Object.keys(oldMainNode.style),
      ...Object.keys(newMainNode.style),
    ]);
    for (const property of [...styleProperties].sort()) {
      const before = oldMainNode.style[property];
      const after = newMainNode.style[property];
      const normalizedProperty = stylePropertyName(property);
      if (
        before === after ||
        (sourceNodeId === args.mainRootSourceNodeId &&
          ["left", "top", "rotate", "transform"].includes(normalizedProperty))
      ) {
        continue;
      }
      if (
        overrides.some(
          (entry) =>
            entry.sourceNodeId === sourceNodeId &&
            entry.property === "style:" + normalizedProperty,
        )
      ) {
        continue;
      }
      const applied = applyStructureValueEdit(
        content,
        args.source,
        current.node,
        { kind: "style", property, value: after ?? null },
      );
      if (applied.status !== "applied") return applied;
      content = applied.content;
    }

    const beforeText = readCodeLayerNodeTextContent(
      args.oldMainContent,
      oldMainNode,
    );
    const afterText = readCodeLayerNodeTextContent(
      args.newMainContent,
      newMainNode,
    );
    if (
      beforeText !== null &&
      afterText !== null &&
      beforeText !== afterText &&
      !overrides.some(
        (entry) =>
          entry.sourceNodeId === sourceNodeId &&
          entry.property === "textContent",
      )
    ) {
      const applied = applyStructureValueEdit(
        content,
        args.source,
        current.node,
        { kind: "textContent", value: afterText },
      );
      if (applied.status !== "applied") return applied;
      content = applied.content;
    }
  }

  return { status: "ready", content };
}

interface ComponentStructureReplacement {
  span: { start: number; end: number } | null;
  content: string;
}

export function applyComponentStructureEdit(args: {
  documents: readonly ComponentSourceDocument[];
  target: ComponentNodeHandle;
  mainBefore: string;
  mainAfter: string;
}): ComponentStructureTransformResult {
  const prepared = projectionForDocuments(args.documents, args.target.fileId);
  if (prepared.status !== "ready") return { status: prepared.status };
  const targetDocument = prepared.values.find(
    ({ document }) => document.source.fileId === args.target.fileId,
  );
  if (!targetDocument) {
    return { status: "missing-file", fileId: args.target.fileId };
  }
  if (targetDocument.document.content !== args.mainBefore) {
    return {
      status: "edit-refused",
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
      message: "main-before-snapshot-mismatch",
    };
  }

  const targetResult = uniqueNodeByDurableId(
    targetDocument.projection,
    args.target.nodeId,
  );
  if (targetResult.status !== "resolved") {
    return {
      status: targetResult.status,
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  }
  const selectedRoot = nearestComponentRoot(
    targetResult.node,
    targetDocument.projection,
  );
  if (!selectedRoot) {
    return {
      status: "not-linked",
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  }
  const mainRoot = hasIdentityAttribute(selectedRoot, COMPONENT_REF_ATTR)
    ? nearestAncestorComponentMain(selectedRoot, targetDocument.projection)
    : selectedRoot;
  if (!mainRoot || !hasIdentityAttribute(mainRoot, COMPONENT_ID_ATTR)) {
    return {
      status: "unsupported-nested-link",
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  }

  const componentId = identityValue(mainRoot, COMPONENT_ID_ATTR);
  const mainRootSourceNodeId = identityValue(mainRoot, NODE_ID_ATTR);
  if (!componentId || !mainRootSourceNodeId) {
    return { status: "invalid-link", fileId: args.target.fileId };
  }

  const projections = prepared.values.map(({ projection }) => projection);
  const resolved = componentResolution(projections, componentId);
  if (resolved.status !== "resolved") {
    return {
      status: resolved.status,
      componentId,
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  }
  if (resolved.value.main.id !== mainRoot.id) {
    return { status: "incomplete-instance", componentId };
  }
  const mainDocument = documentForNode(prepared.values, mainRoot);
  if (
    !mainDocument ||
    mainDocument.document.source.fileId !== args.target.fileId
  ) {
    return { status: "incomplete-instance", componentId };
  }

  const oldTree = componentStructureTree(mainRoot, mainDocument.projection);
  if (oldTree.status !== "ready")
    return { status: oldTree.status, componentId };
  const targetSourceNodeId = identityValue(targetResult.node, NODE_ID_ATTR);
  if (!targetSourceNodeId) {
    return { status: "missing-source-node-id", componentId };
  }
  if (!oldTree.value.bySourceId.has(targetSourceNodeId)) {
    return { status: "unsupported-nested-link", componentId };
  }
  if (oldTree.value.nestedBySourceId.has(targetSourceNodeId)) {
    return { status: "unsupported-nested-link", componentId };
  }

  const pairResult = componentPairs(
    mainRoot,
    mainDocument,
    resolved.value.references,
    prepared.values,
  );
  if (pairResult.status !== "ready") {
    return { status: pairResult.status, componentId };
  }
  for (const reference of pairResult.byReference) {
    for (const pair of reference.pairs) {
      if (
        oldTree.value.bySourceId.has(pair.sourceNodeId) &&
        !readOverrides(pair.instance)
      ) {
        return { status: "invalid-override-metadata", componentId };
      }
    }
  }

  const mainSpan = mainRoot.source;
  if (
    !mainSpan ||
    mainSpan.start < 0 ||
    mainSpan.end <= mainSpan.start ||
    mainSpan.end > args.mainBefore.length
  ) {
    return {
      status: "edit-refused",
      componentId,
      message: "structure-edit-outside-main-root",
    };
  }
  const mainBeforePrefix = args.mainBefore.slice(0, mainSpan.start);
  const mainBeforeSuffix = args.mainBefore.slice(mainSpan.end);
  if (
    !args.mainAfter.startsWith(mainBeforePrefix) ||
    !args.mainAfter.endsWith(mainBeforeSuffix) ||
    args.mainAfter.length < mainBeforePrefix.length + mainBeforeSuffix.length
  ) {
    return {
      status: "edit-refused",
      componentId,
      message: "structure-edit-outside-main-root",
    };
  }

  const afterDocuments = args.documents.map((document) =>
    document.source.fileId === args.target.fileId
      ? { ...document, content: args.mainAfter }
      : document,
  );
  const afterPrepared = projectionForDocuments(
    afterDocuments,
    args.target.fileId,
  );
  if (afterPrepared.status !== "ready") {
    return { status: afterPrepared.status, componentId };
  }
  const afterMainDocument = afterPrepared.values.find(
    ({ document }) => document.source.fileId === args.target.fileId,
  );
  if (!afterMainDocument) return { status: "missing-file", componentId };
  const afterRootResult = uniqueNodeByDurableId(
    afterMainDocument.projection,
    mainRootSourceNodeId,
  );
  if (afterRootResult.status !== "resolved") {
    return { status: afterRootResult.status, componentId };
  }
  const afterRoot = afterRootResult.node;
  const afterSpan = afterRoot.source;
  if (
    afterRoot.tag !== mainRoot.tag ||
    identityValue(afterRoot, COMPONENT_ID_ATTR) !== componentId ||
    hasIdentityAttribute(afterRoot, COMPONENT_REF_ATTR) ||
    !afterSpan ||
    afterSpan.start !== mainBeforePrefix.length ||
    afterSpan.end !== args.mainAfter.length - mainBeforeSuffix.length ||
    args.mainAfter.slice(0, afterSpan.start) !== mainBeforePrefix ||
    args.mainAfter.slice(afterSpan.end) !== mainBeforeSuffix
  ) {
    return {
      status: "edit-refused",
      componentId,
      message: "structure-edit-outside-main-root",
    };
  }

  const afterResolved = componentResolution(
    afterPrepared.values.map(({ projection }) => projection),
    componentId,
  );
  if (
    afterResolved.status !== "resolved" ||
    afterResolved.value.main.id !== afterRoot.id
  ) {
    return {
      status:
        afterResolved.status === "resolved"
          ? "incomplete-instance"
          : afterResolved.status,
      componentId,
    };
  }

  const newTree = componentStructureTree(
    afterRoot,
    afterMainDocument.projection,
  );
  if (newTree.status !== "ready")
    return { status: newTree.status, componentId };
  const afterNodesById = new Map(
    afterMainDocument.projection.nodes.map((node) => [node.id, node] as const),
  );
  for (const [sourceNodeId, newNestedRoot] of newTree.value.nestedBySourceId) {
    const nestedReferenceId = identityValue(newNestedRoot, COMPONENT_REF_ATTR);
    const nestedResolution = nestedReferenceId
      ? componentResolution(
          afterPrepared.values.map(({ projection }) => projection),
          nestedReferenceId,
        )
      : null;
    const nestedSubtree = descendantsOf(newNestedRoot, afterNodesById);
    if (
      !nestedReferenceId ||
      nestedResolution?.status !== "resolved" ||
      !validateNestedReference(
        newNestedRoot,
        afterMainDocument.projection,
        afterPrepared.values.map(({ projection }) => projection),
        afterRoot,
      ) ||
      !nestedSubtree ||
      nestedSubtree
        .slice(1)
        .some(
          (node) =>
            hasIdentityAttribute(node, COMPONENT_ID_ATTR) ||
            hasIdentityAttribute(node, COMPONENT_REF_ATTR),
        )
    ) {
      return { status: "unsupported-nested-link", componentId };
    }
    const oldNestedRoot = oldTree.value.nestedBySourceId.get(sourceNodeId);
    if (
      oldNestedRoot &&
      identityValue(oldNestedRoot, COMPONENT_REF_ATTR) !== nestedReferenceId
    ) {
      return { status: "unsupported-nested-link", componentId };
    }
  }
  for (const [sourceNodeId, oldNestedRoot] of oldTree.value.nestedBySourceId) {
    const newNestedRoot = newTree.value.nestedBySourceId.get(sourceNodeId);
    if (!newNestedRoot) continue;
    const oldMarkup = sourceMarkup(
      mainDocument.document.content,
      oldNestedRoot,
    );
    const newMarkup = sourceMarkup(
      afterMainDocument.document.content,
      newNestedRoot,
    );
    if (oldMarkup === null || newMarkup === null || oldMarkup !== newMarkup) {
      return { status: "unsupported-nested-link", componentId };
    }
  }
  for (const [sourceNodeId, oldNode] of oldTree.value.bySourceId) {
    const next = newTree.value.bySourceId.get(sourceNodeId);
    if (next && next.tag !== oldNode.tag) {
      return { status: "incomplete-instance", componentId };
    }
  }

  const original = new Map(
    prepared.values.map(({ document }) => [
      document.source.fileId ?? "",
      document.content,
    ]),
  );
  const documentsByFileId = new Map(
    prepared.values.map(({ document }) => [
      document.source.fileId ?? "",
      document,
    ]),
  );
  const replacementsByFileId = new Map<
    string,
    ComponentStructureReplacement[]
  >();
  const reservedInstanceNodeIdsByFileId = new Map<string, Set<string>>();

  for (const reference of pairResult.byReference) {
    const referenceRoot = reference.pairs.find(
      ({ sourceNodeId }) => sourceNodeId === mainRootSourceNodeId,
    )?.instance;
    if (!referenceRoot) {
      return { status: "incomplete-instance", componentId };
    }
    const referenceRootNodeId = identityValue(referenceRoot, NODE_ID_ATTR);
    if (!referenceRootNodeId || !referenceRoot.source) {
      return { status: "incomplete-instance", componentId };
    }

    const oldInstanceBySourceId = new Map<string, CodeLayerNode>();
    for (const pair of reference.pairs) {
      if (oldTree.value.bySourceId.has(pair.sourceNodeId)) {
        oldInstanceBySourceId.set(pair.sourceNodeId, pair.instance);
      }
    }
    const fileId = reference.document.document.source.fileId!;
    let usedInstanceNodeIds = reservedInstanceNodeIdsByFileId.get(fileId);
    if (!usedInstanceNodeIds) {
      usedInstanceNodeIds = new Set<string>();
      const reservationDocument =
        fileId === args.target.fileId ? afterMainDocument : reference.document;
      for (const node of reservationDocument.projection.nodes) {
        const durableId = identityValue(node, NODE_ID_ATTR);
        if (durableId) usedInstanceNodeIds.add(durableId);
      }
      for (const authoredId of componentMarkupIds(
        reservationDocument.document.content,
      )) {
        usedInstanceNodeIds.add(authoredId);
      }
      reservedInstanceNodeIdsByFileId.set(fileId, usedInstanceNodeIds);
    }

    const context: ComponentStructureReferenceContext = {
      source: reference.document.document.source,
      newMainContent: afterMainDocument.document.content,
      newMainNodesById: new Map(
        afterMainDocument.projection.nodes.map((node) => [node.id, node]),
      ),
      oldMainTree: oldTree.value,
      newMainTree: newTree.value,
      oldMainContent: mainDocument.document.content,
      oldDocument: reference.document.document,
      oldInstanceBySourceId,
      oldInstanceNodesById: new Map(
        reference.document.projection.nodes.map((node) => [node.id, node]),
      ),
      usedInstanceNodeIds,
      visiting: new Set(),
    };
    const rendered = renderComponentStructureNode(afterRoot, context);
    if (rendered.status !== "ready") {
      return { status: rendered.status, componentId };
    }
    const synced = syncInheritedStructureValues({
      content: rendered.content,
      source: reference.document.document.source,
      mainRootSourceNodeId,
      referenceRootNodeId,
      oldMainTree: oldTree.value,
      newMainTree: newTree.value,
      oldMainContent: mainDocument.document.content,
      newMainContent: afterMainDocument.document.content,
    });
    if (synced.status !== "ready") {
      return { status: synced.status, componentId };
    }

    const entries = replacementsByFileId.get(fileId) ?? [];
    entries.push({
      span: referenceRoot.source,
      content: synced.content,
    });
    replacementsByFileId.set(fileId, entries);
  }

  for (const [fileId, entries] of replacementsByFileId) {
    const document = documentsByFileId.get(fileId);
    if (!document) return { status: "incomplete-instance", componentId };
    const sorted = [...entries].sort(
      (left, right) => (left.span?.start ?? 0) - (right.span?.start ?? 0),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!.span;
      const current = sorted[index]!.span;
      if (!previous || !current || previous.end > current.start) {
        return { status: "incomplete-instance", componentId };
      }
    }
    if (
      fileId === args.target.fileId &&
      entries.some(({ span }) => {
        if (!span) return true;
        return span.start < mainSpan.end && mainSpan.start < span.end;
      })
    ) {
      return { status: "incomplete-instance", componentId };
    }
  }

  const updated = new Map(original);
  updated.set(args.target.fileId, args.mainAfter);
  for (const [fileId, entries] of replacementsByFileId) {
    let content = updated.get(fileId);
    if (content === undefined)
      return { status: "incomplete-instance", componentId };
    const mainDelta =
      fileId === args.target.fileId
        ? args.mainAfter.length - args.mainBefore.length
        : 0;
    for (const replacement of [...entries].sort(
      (left, right) => (right.span?.start ?? 0) - (left.span?.start ?? 0),
    )) {
      const span = replacement.span;
      if (!span) return { status: "incomplete-instance", componentId };
      const shift =
        fileId === args.target.fileId && mainSpan.start < span.start
          ? mainDelta
          : 0;
      const start = span.start + shift;
      const end = span.end + shift;
      if (start < 0 || end <= start || end > content.length) {
        return { status: "incomplete-instance", componentId };
      }
      content =
        content.slice(0, start) + replacement.content + content.slice(end);
    }
    updated.set(fileId, content);
  }

  for (const [fileId, content] of updated) {
    if (content !== original.get(fileId)) {
      updated.set(fileId, ensureGroupRuntime(content));
    }
  }

  return {
    status: "updated",
    componentId,
    changes: resultChanges(prepared.values, original, updated),
  };
}

export function isValidComponentReferenceSubtree(args: {
  documents: readonly ComponentSourceDocument[];
  componentId: string;
  referenceFileId: string;
  referenceNodeId: string;
}): boolean {
  const prepared = projectionForDocuments(args.documents, args.referenceFileId);
  if (prepared.status !== "ready") return false;
  const referenceDocument = prepared.values.find(
    ({ document }) => document.source.fileId === args.referenceFileId,
  );
  if (!referenceDocument) return false;
  const referenceResult = uniqueNodeByDurableId(
    referenceDocument.projection,
    args.referenceNodeId,
  );
  if (referenceResult.status !== "resolved") return false;
  const reference = referenceResult.node;
  if (
    identityValue(reference, COMPONENT_REF_ATTR) !== args.componentId ||
    hasIdentityAttribute(reference, COMPONENT_ID_ATTR)
  ) {
    return false;
  }
  const resolution = componentResolution(
    prepared.values.map((entry) => entry.projection),
    args.componentId,
  );
  if (
    resolution.status !== "resolved" ||
    !resolution.value.references.includes(reference)
  ) {
    return false;
  }
  const mainDocument = documentForNode(prepared.values, resolution.value.main);
  if (!mainDocument) return false;
  const pairing = componentPairs(
    resolution.value.main,
    mainDocument,
    [reference],
    prepared.values,
  );
  if (pairing.status !== "ready" || pairing.byReference.length !== 1) {
    return false;
  }
  const referencePairs = pairing.byReference[0];
  if (
    referencePairs?.document.document.source.fileId !== args.referenceFileId ||
    !referencePairs.pairs.some(
      ({ main, instance }) =>
        main.id === resolution.value.main.id && instance.id === reference.id,
    )
  ) {
    return false;
  }
  return referencePairs.pairs.every(({ main, instance }) => {
    const mainId = identityValue(main, NODE_ID_ATTR);
    const instanceId = identityValue(instance, NODE_ID_ATTR);
    return (
      mainId !== null &&
      instanceId !== null &&
      uniqueNodeByDurableId(mainDocument.projection, mainId).status ===
        "resolved" &&
      uniqueNodeByDurableId(referenceDocument.projection, instanceId).status ===
        "resolved"
    );
  });
}

function applyEditToNode(
  content: string,
  source: CodeLayerSource,
  node: CodeLayerNode,
  edit: ComponentPropertyEdit,
):
  | { status: "applied"; content: string }
  | { status: "unsupported-edit" | "edit-refused"; message?: string } {
  if (edit.kind === "layerName" && node.tag === "") {
    return { status: "unsupported-edit" };
  }
  if (edit.kind === "style" && !edit.property.trim()) {
    return { status: "unsupported-edit" };
  }
  const durableId = identityValue(node, NODE_ID_ATTR);
  if (!durableId) return { status: "unsupported-edit" };
  const intent = editIntent(edit, durableId, node.selector);
  if (!intent) return { status: "unsupported-edit" };
  const result = applyVisualEdit(content, intent, { source });
  if (result.result.status !== "applied") {
    return { status: "edit-refused", message: result.result.message };
  }
  return { status: "applied", content: result.content };
}

function resultChanges(
  documents: readonly ComponentDocumentProjection[],
  original: ReadonlyMap<string, string>,
  updated: ReadonlyMap<string, string>,
): ComponentSourceChange[] {
  return documents.flatMap(({ document }) => {
    const fileId = document.source.fileId ?? "";
    const before = original.get(fileId);
    const after = updated.get(fileId) ?? before;
    return before === undefined || after === undefined || before === after
      ? []
      : [
          {
            fileId,
            source: document.source,
            before,
            after,
          },
        ];
  });
}

export function applyComponentPropertyEdit(args: {
  documents: readonly ComponentSourceDocument[];
  target: ComponentNodeHandle;
  edit: ComponentPropertyEdit;
}): ComponentPropertyTransformResult {
  const prepared = projectionForDocuments(args.documents, args.target.fileId);
  if (prepared.status !== "ready") return { status: prepared.status };
  const targetDocument = prepared.values.find(
    (entry) => entry.document.source.fileId === args.target.fileId,
  );
  if (!targetDocument)
    return { status: "missing-file", fileId: args.target.fileId };
  const targetResult = uniqueNodeByDurableId(
    targetDocument.projection,
    args.target.nodeId,
  );
  if (targetResult.status !== "resolved") {
    return {
      status: targetResult.status,
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  }
  const selectedComponentRoot = nearestComponentRoot(
    targetResult.node,
    targetDocument.projection,
  );
  if (!selectedComponentRoot)
    return {
      status: "not-linked",
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  const parentMainRoot = hasIdentityAttribute(
    selectedComponentRoot,
    COMPONENT_REF_ATTR,
  )
    ? nearestAncestorComponentMain(
        selectedComponentRoot,
        targetDocument.projection,
      )
    : null;
  const componentRoot = parentMainRoot ?? selectedComponentRoot;
  const hasMainId = hasIdentityAttribute(componentRoot, COMPONENT_ID_ATTR);
  const hasReferenceId = hasIdentityAttribute(
    componentRoot,
    COMPONENT_REF_ATTR,
  );
  if (hasMainId === hasReferenceId)
    return {
      status: "invalid-link",
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  const componentId = identityValue(
    componentRoot,
    hasMainId ? COMPONENT_ID_ATTR : COMPONENT_REF_ATTR,
  );
  if (!componentId)
    return {
      status: "invalid-link",
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  let nestedOverrideSourceNodeId: string | null = null;
  if (parentMainRoot) {
    const nestedComponentId = identityValue(
      selectedComponentRoot,
      COMPONENT_REF_ATTR,
    );
    const nestedResolution = nestedComponentId
      ? componentResolution(
          prepared.values.map((entry) => entry.projection),
          nestedComponentId,
        )
      : null;
    nestedOverrideSourceNodeId =
      targetResult.node.id === selectedComponentRoot.id
        ? nestedResolution?.status === "resolved"
          ? identityValue(nestedResolution.value.main, NODE_ID_ATTR)
          : null
        : identityValue(targetResult.node, COMPONENT_SOURCE_NODE_ID_ATTR);
    if (!nestedOverrideSourceNodeId) {
      return { status: "missing-source-node-id", componentId };
    }
  }
  const resolved = componentResolution(
    prepared.values.map((entry) => entry.projection),
    componentId,
  );
  if (resolved.status !== "resolved")
    return {
      status: resolved.status,
      fileId: args.target.fileId,
      nodeId: args.target.nodeId,
    };
  const mainDocument = documentForNode(prepared.values, resolved.value.main);
  if (!mainDocument) return { status: "incomplete-instance", componentId };
  const pairResult = componentPairs(
    resolved.value.main,
    mainDocument,
    resolved.value.references,
    prepared.values,
  );
  if (pairResult.status !== "ready")
    return { status: pairResult.status, componentId };
  const original = new Map(
    prepared.values.map(({ document }) => [
      document.source.fileId ?? "",
      document.content,
    ]),
  );
  const updated = new Map<string, string>();
  const editKey = propertyKey(args.edit);

  if (hasReferenceId) {
    const reference = pairResult.byReference.find(
      ({ document, pairs }) =>
        document.document.source.fileId === args.target.fileId &&
        pairs.some(
          ({ main, instance }) =>
            main.id === resolved.value.main.id &&
            instance.id === componentRoot.id,
        ),
    );
    if (!reference) return { status: "incomplete-instance", componentId };
    const targetPair = reference.pairs.find(
      ({ instance }) => instance.id === targetResult.node.id,
    );
    if (!targetPair) return { status: "incomplete-instance", componentId };
    const existingOverrides = readOverrides(targetPair.instance);
    if (!existingOverrides)
      return { status: "invalid-override-metadata", componentId };
    const applied = applyEditToNode(
      reference.document.document.content,
      reference.document.document.source,
      targetPair.instance,
      args.edit,
    );
    if (applied.status !== "applied")
      return { status: applied.status, message: applied.message, componentId };
    const updatedProjection = buildCodeLayerProjection(applied.content, {
      source: reference.document.document.source,
    });
    const updatedTarget = uniqueNodeByDurableId(
      updatedProjection,
      args.target.nodeId,
    );
    if (updatedTarget.status !== "resolved")
      return { status: updatedTarget.status, componentId };
    const overrides = isUninheritedRootPlacementEdit(
      targetPair.instance,
      componentRoot,
      args.edit,
    )
      ? existingOverrides.filter(
          (entry) =>
            entry.sourceNodeId !== targetPair.sourceNodeId ||
            entry.property !== editKey,
        )
      : updateOverride(existingOverrides, {
          sourceNodeId: targetPair.sourceNodeId,
          property: editKey,
        });
    const content = writeOverrides(
      applied.content,
      reference.document.document.source,
      updatedTarget.node,
      overrides,
    );
    if (content === null) return { status: "incomplete-instance", componentId };
    updated.set(reference.document.document.source.fileId ?? "", content);
  } else {
    const mainDurableId = identityValue(targetResult.node, NODE_ID_ATTR);
    if (!mainDurableId)
      return { status: "missing-source-node-id", componentId };
    const mainPair = pairResult.byReference.length
      ? pairResult.byReference[0]?.pairs.find(
          ({ main }) => main.id === targetResult.node.id,
        )
      : undefined;
    if (pairResult.byReference.length && !mainPair) {
      return { status: "incomplete-instance", componentId };
    }
    const appliedMain = applyEditToNode(
      mainDocument.document.content,
      mainDocument.document.source,
      targetResult.node,
      args.edit,
    );
    if (appliedMain.status !== "applied")
      return {
        status: appliedMain.status,
        message: appliedMain.message,
        componentId,
      };
    let mainContent = appliedMain.content;
    if (parentMainRoot) {
      const projection = buildCodeLayerProjection(mainContent, {
        source: mainDocument.document.source,
      });
      const nestedRoot = uniqueNodeByDurableId(
        projection,
        identityValue(selectedComponentRoot, NODE_ID_ATTR) ?? "",
      );
      if (nestedRoot.status !== "resolved")
        return { status: nestedRoot.status, componentId };
      const overrides = readOverrides(nestedRoot.node);
      if (!overrides)
        return { status: "invalid-override-metadata", componentId };
      const annotated = writeOverrides(
        mainContent,
        mainDocument.document.source,
        nestedRoot.node,
        updateOverride(overrides, {
          sourceNodeId: nestedOverrideSourceNodeId!,
          property: editKey,
        }),
      );
      if (annotated === null)
        return { status: "incomplete-instance", componentId };
      mainContent = annotated;
    }
    updated.set(mainDocument.document.source.fileId ?? "", mainContent);
    for (const reference of pairResult.byReference) {
      const pair = reference.pairs.find(
        ({ main }) => main.id === targetResult.node.id,
      );
      if (!pair) return { status: "incomplete-instance", componentId };
      if (
        isUninheritedRootPlacementEdit(
          pair.main,
          resolved.value.main,
          args.edit,
        )
      ) {
        continue;
      }
      const overrideNode = pair.nestedComponentNodeId
        ? nearestComponentRoot(pair.instance, reference.document.projection)
        : pair.instance;
      if (!overrideNode) return { status: "incomplete-instance", componentId };
      const overrides = readOverrides(overrideNode);
      const instanceOverrides = readOverrides(pair.instance);
      if (!overrides || !instanceOverrides)
        return { status: "invalid-override-metadata", componentId };
      const overrideSourceNodeId =
        pair.nestedComponentNodeId ?? pair.sourceNodeId;
      const priorOverride = [...overrides, ...instanceOverrides].some(
        (entry) =>
          entry.sourceNodeId === overrideSourceNodeId &&
          entry.property === editKey,
      );
      if (!parentMainRoot) {
        const parentRoot = nearestAncestorComponentRoot(
          overrideNode,
          reference.document.projection,
        );
        if (parentRoot) {
          const inheritedOverride = hasNestedParentOverride(
            overrideNode,
            pair.sourceNodeId,
            editKey,
            prepared.values,
          );
          if (inheritedOverride === null)
            return { status: "invalid-override-metadata", componentId };
          if (inheritedOverride) continue;
        }
      }
      const referenceFileId = reference.document.document.source.fileId ?? "";
      const referenceContent =
        updated.get(referenceFileId) ?? reference.document.document.content;
      if (priorOverride) continue;
      const applied = applyEditToNode(
        referenceContent,
        reference.document.document.source,
        pair.instance,
        args.edit,
      );
      if (applied.status !== "applied")
        return {
          status: applied.status,
          message: applied.message,
          componentId,
        };
      updated.set(referenceFileId, applied.content);
    }
  }

  return {
    status: "updated",
    componentId,
    changes: resultChanges(prepared.values, original, updated),
  };
}

export interface ComponentStyleTarget {
  fileId: string;
  nodeId: string;
  styles: Record<string, string>;
}

export function applyComponentStructureIntent(args: {
  content: string;
  intent: EditIntent;
  source: CodeLayerSource;
}) {
  const intent =
    args.intent.kind === "style" &&
    (args.intent.operation ?? "set") === "remove"
      ? {
          kind: "style" as const,
          operation: "remove" as const,
          target: args.intent.target,
          property: args.intent.property,
        }
      : args.intent.kind === "style"
        ? {
            kind: "style" as const,
            operation: "set" as const,
            target: args.intent.target,
            property: args.intent.property,
            value: "value" in args.intent ? args.intent.value : "",
          }
        : args.intent;
  return applyVisualEdit(args.content, intent, {
    source: args.source,
    allowMainComponentStructure: true,
  });
}

export function applyComponentStyleTargetsEdit(args: {
  documents: readonly ComponentSourceDocument[];
  targets: readonly ComponentStyleTarget[];
}): ComponentPropertyTransformResult {
  let currentDocuments = [...args.documents];
  let componentId = "";
  for (const target of args.targets) {
    const targetDocument = currentDocuments.find(
      (document) => document.source.fileId === target.fileId,
    );
    if (!targetDocument) {
      return { status: "missing-file", fileId: target.fileId };
    }
    const projection = buildCodeLayerProjection(targetDocument.content, {
      source: targetDocument.source,
    });
    const node = projection.nodes.find((candidate) =>
      componentNodeIdMatches(candidate, target.nodeId),
    );
    if (!node) {
      return {
        status: "missing-node",
        fileId: target.fileId,
        nodeId: target.nodeId,
      };
    }
    const linked = nearestComponentRoot(node, projection) !== null;
    for (const [property, value] of Object.entries(target.styles)) {
      if (linked) {
        const next = applyComponentPropertyEdit({
          documents: currentDocuments,
          target: { fileId: target.fileId, nodeId: target.nodeId },
          edit: { kind: "style", property, value },
        });
        if (next.status !== "updated") return next;
        componentId = next.componentId;
        const changesByFileId = new Map(
          next.changes.map((change) => [change.fileId, change.after]),
        );
        currentDocuments = currentDocuments.map((document) => ({
          ...document,
          content:
            changesByFileId.get(document.source.fileId ?? "") ??
            document.content,
        }));
        continue;
      }
      const targetSource = currentDocuments.find(
        (document) => document.source.fileId === target.fileId,
      )!;
      const patch = applyVisualEdit(
        targetSource.content,
        {
          kind: "style",
          target: { nodeId: target.nodeId },
          property,
          value,
        },
        { source: targetSource.source },
      );
      if (patch.result.status !== "applied") {
        return {
          status: "edit-refused",
          fileId: target.fileId,
          nodeId: target.nodeId,
          message: patch.result.message,
        };
      }
      currentDocuments = currentDocuments.map((document) =>
        document.source.fileId === target.fileId
          ? { ...document, content: patch.content }
          : document,
      );
    }
  }
  if (!componentId) {
    return {
      status: "not-linked",
      fileId: args.targets[0]?.fileId,
      nodeId: args.targets[0]?.nodeId,
    };
  }
  const original = new Map(
    args.documents.map((document) => [
      document.source.fileId ?? "",
      document.content,
    ]),
  );
  return {
    status: "updated",
    componentId,
    changes: currentDocuments.flatMap((document) => {
      const fileId = document.source.fileId ?? "";
      const before = original.get(fileId);
      return before === undefined || before === document.content
        ? []
        : [
            {
              fileId,
              source: document.source,
              before,
              after: document.content,
            },
          ];
    }),
  };
}

export function resetComponentInstanceOverrides(args: {
  documents: readonly ComponentSourceDocument[];
  instance: ComponentNodeHandle;
}): ComponentPropertyTransformResult {
  const prepared = projectionForDocuments(args.documents, args.instance.fileId);
  if (prepared.status !== "ready") return { status: prepared.status };
  const instanceDocument = prepared.values.find(
    (entry) => entry.document.source.fileId === args.instance.fileId,
  );
  if (!instanceDocument)
    return { status: "missing-file", fileId: args.instance.fileId };
  const instanceResult = uniqueNodeByDurableId(
    instanceDocument.projection,
    args.instance.nodeId,
  );
  if (instanceResult.status !== "resolved")
    return {
      status: instanceResult.status,
      fileId: args.instance.fileId,
      nodeId: args.instance.nodeId,
    };
  const root = nearestComponentRoot(
    instanceResult.node,
    instanceDocument.projection,
  );
  if (
    !root ||
    !hasIdentityAttribute(root, COMPONENT_REF_ATTR) ||
    hasIdentityAttribute(root, COMPONENT_ID_ATTR)
  ) {
    return {
      status: "not-linked",
      fileId: args.instance.fileId,
      nodeId: args.instance.nodeId,
    };
  }
  const componentId = identityValue(root, COMPONENT_REF_ATTR);
  if (!componentId)
    return {
      status: "invalid-link",
      fileId: args.instance.fileId,
      nodeId: args.instance.nodeId,
    };
  const resolved = componentResolution(
    prepared.values.map((entry) => entry.projection),
    componentId,
  );
  if (resolved.status !== "resolved")
    return { status: resolved.status, componentId };
  const mainDocument = documentForNode(prepared.values, resolved.value.main);
  if (!mainDocument) return { status: "incomplete-instance", componentId };
  const pairResult = componentPairs(
    resolved.value.main,
    mainDocument,
    resolved.value.references,
    prepared.values,
  );
  if (pairResult.status !== "ready")
    return { status: pairResult.status, componentId };
  const reference = pairResult.byReference.find(
    ({ document, pairs }) =>
      document.document.source.fileId === args.instance.fileId &&
      pairs.some(
        ({ main, instance }) =>
          main.id === resolved.value.main.id && instance.id === root.id,
      ),
  );
  if (!reference)
    return {
      status: "incomplete-instance",
      componentId,
      message: "reset-reference-not-found",
    };
  const original = new Map(
    prepared.values.map(({ document }) => [
      document.source.fileId ?? "",
      document.content,
    ]),
  );

  const updated = new Map<string, string>();
  let currentContent = reference.document.document.content;
  for (const pair of reference.pairs) {
    const currentProjection = buildCodeLayerProjection(currentContent, {
      source: reference.document.document.source,
    });
    const currentNodeResult = uniqueNodeByDurableId(
      currentProjection,
      identityValue(pair.instance, NODE_ID_ATTR) ?? "",
    );
    if (currentNodeResult.status !== "resolved")
      return { status: currentNodeResult.status, componentId };
    const overrides = readOverrides(currentNodeResult.node);
    if (!overrides) return { status: "invalid-override-metadata", componentId };
    const reset = overrides.filter(
      (entry) => entry.sourceNodeId === pair.sourceNodeId,
    );
    if (!reset.length) continue;
    const remaining = overrides.filter(
      (entry) => entry.sourceNodeId !== pair.sourceNodeId,
    );
    let targetNode = currentNodeResult.node;
    for (const override of reset) {
      const propertyEdit: ComponentPropertyEdit | null =
        override.property === "textContent"
          ? { kind: "textContent", value: "" }
          : override.property.startsWith("style:")
            ? {
                kind: "style",
                property: override.property.slice("style:".length),
                value: "",
              }
            : override.property === `attribute:${LAYER_NAME_ATTR}`
              ? { kind: "layerName", value: "" }
              : override.property.startsWith("attribute:")
                ? {
                    kind: "attribute",
                    attribute: override.property.slice("attribute:".length),
                    value: "",
                  }
                : null;
      if (!propertyEdit)
        return {
          status: "unsupported-reset-value",
          componentId,
          nodeId: pair.sourceNodeId,
        };
      if (
        isUninheritedRootPlacementEdit(
          currentNodeResult.node,
          root,
          propertyEdit,
        )
      ) {
        continue;
      }
      const nestedParent = inheritedParentNodeForNestedInstance(
        currentNodeResult.node,
        { ...reference.document, projection: currentProjection },
        prepared.values,
      );
      if (nestedParent.status === "invalid")
        return {
          status: "incomplete-instance",
          componentId,
          message: "nested parent source is incomplete",
        };
      const inheritedSource =
        nestedParent.status === "found"
          ? nestedParent
          : { document: mainDocument, node: pair.main };
      const inheritedValue = readInheritedValue(
        inheritedSource.document.document,
        inheritedSource.node,
        propertyEdit,
      );
      if (inheritedValue === null && propertyEdit.kind !== "style")
        return {
          status: "unsupported-reset-value",
          componentId,
          nodeId: pair.sourceNodeId,
        };
      const resetEdit: ComponentPropertyEdit =
        propertyEdit.kind === "style"
          ? { ...propertyEdit, value: inheritedValue }
          : { ...propertyEdit, value: inheritedValue ?? "" };
      const applied = applyEditToNode(
        currentContent,
        reference.document.document.source,
        targetNode,
        resetEdit,
      );
      if (applied.status !== "applied")
        return {
          status: applied.status,
          message: applied.message,
          componentId,
        };
      currentContent = applied.content;
      const nextProjection = buildCodeLayerProjection(currentContent, {
        source: reference.document.document.source,
      });
      const nextNode = uniqueNodeByDurableId(
        nextProjection,
        identityValue(pair.instance, NODE_ID_ATTR) ?? "",
      );
      if (nextNode.status !== "resolved")
        return { status: nextNode.status, componentId };
      targetNode = nextNode.node;
    }
    const serialized = writeOverrides(
      currentContent,
      reference.document.document.source,
      targetNode,
      remaining,
    );
    if (serialized === null)
      return {
        status: "incomplete-instance",
        componentId,
        message: "reset-override-serialization-failed",
      };
    currentContent = serialized;
  }
  updated.set(reference.document.document.source.fileId ?? "", currentContent);
  return {
    status: "updated",
    componentId,
    changes: resultChanges(prepared.values, original, updated),
  };
}
