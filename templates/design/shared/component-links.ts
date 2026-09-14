export { linkedComponentRootForNode } from "./component-model";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
  readCodeLayerNodeTextContent,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerSource,
} from "./code-layer";
import {
  linkedComponentRootForNode as nearestComponentRoot,
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "./component-model";

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

/** Resolve canonical mains and explicit refs by opaque ID, never by name. */
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
  /** Old durable node ID -> the ID assigned by prepareClonedHtmlLayer. */
  nodeIdMap: ReadonlyMap<string, string>;
}

function descendantsOf(
  root: CodeLayerNode,
  nodesById: Map<string, CodeLayerNode>,
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
  if (
    !componentId ||
    hasIdentityAttribute(reference, COMPONENT_ID_ATTR) ||
    hasIdentityAttribute(reference, COMPONENT_SOURCE_NODE_ID_ATTR)
  ) {
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

/**
 * Convert a clone of a canonical main into an explicitly linked instance.
 * The caller supplies the clone helper's durable-ID map; this function never
 * guesses a descendant correspondence from names, tags, or source order.
 */
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
  const value = node.dataAttributes[LAYER_NAME_ATTR];
  return value === undefined ? null : value;
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

/** Apply a supported property edit to a main or one linked instance. */
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

/** Reset every supported override on one linked instance to its latest main value. */
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
