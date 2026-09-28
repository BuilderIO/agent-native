import type {
  CodeLayerNode,
  CodeLayerProjection,
  CodeLayerSource,
  CodeLayerTreeNode,
  MoveNodeEditIntent,
} from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  elementInfoFromCodeLayerNode,
  findCodeLayerSiblingOrder,
  preferredCodeLayerSelector,
} from "@/pages/design-editor/code-layer-state";
import type { ResponsiveEditScope } from "@/pages/design-editor/command-types";
import { applyScopedVisualStyleEdit } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import {
  dispatchLinkedComponentStructure,
  type ApplyLinkedComponentEdit,
} from "./linked-component-structure";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

type ChangeSelectedZIndexMode = "forward" | "front" | "backward" | "back";

export type ChangeSelectedZIndexResult =
  | { status: "applied" }
  | { status: "queued" }
  | { status: "unchanged" }
  | { status: "refused"; reason: ZOrderRefusal };

export type ZOrderRefusal =
  | "selection"
  | "runtime-only"
  | "repeat-anchor"
  | "linked-component"
  | "responsive-scope"
  | "patch"
  | "publication";

interface CodeLayerOwner {
  fileId: string;
  node: CodeLayerNode;
  tree: CodeLayerTreeNode[];
  runtimeOnly: boolean;
}

export interface ChangeSelectedZIndexArgs {
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  activeBreakpointUpperBoundPx?: number | null;
  activeBreakpointWidthStateRef?: RefObject<number | undefined>;
  activeFile: DesignFile;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
  codeLayerOwnerByNodeIdRef: RefObject<Map<string, CodeLayerOwner>>;
  commitVisualStyles: (
    selector: string,
    styles: Record<string, string>,
    options?: {
      runtimeApplied?: boolean;
      elementInfo?: ElementInfo;
      originalStyles?: Record<string, string>;
    },
  ) => void;
  getFreshActiveContent: () => string;
  invalidateRenderedElementInfo?: () => void;
  renderedElementInfoByLayerKeyRef?: RefObject<Map<string, ElementInfo>>;
  reportRefusal?: (reason: ZOrderRefusal) => void;
  responsiveEditScopeRef?: RefObject<ResponsiveEditScope>;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
}

interface InFlowZIndexContext {
  parentId?: string;
  siblingFloor: number;
  siblingPaintLevels: number[];
  hasPositionedDescendant: boolean;
}

interface TargetPlan {
  context: InFlowZIndexContext;
  info: ElementInfo;
  node: CodeLayerNode;
  position: string;
  reorder: boolean;
  siblingOrder: ReturnType<typeof findCodeLayerSiblingOrder>;
}

interface StyleWrite {
  nodeId: string;
  property: string;
  value: string;
}

function durableNodeId(node: CodeLayerNode): string {
  return node.dataAttributes["data-agent-native-node-id"] ?? node.id;
}

function nodeMatchesId(node: CodeLayerNode, id: string): boolean {
  return (
    node.id === id ||
    durableNodeId(node) === id ||
    node.dataAttributes["data-code-layer-id"] === id ||
    node.dataAttributes["data-layer-id"] === id
  );
}

function nodeForId(
  projection: CodeLayerProjection,
  id: string,
  owner?: CodeLayerOwner,
): CodeLayerNode | undefined {
  const ownerDurableId = owner?.node ? durableNodeId(owner.node) : undefined;
  return projection.nodes.find(
    (node) =>
      nodeMatchesId(node, id) ||
      (ownerDurableId !== undefined && durableNodeId(node) === ownerDurableId),
  );
}

function selectorMatchesNode(
  selector: string | undefined,
  node: CodeLayerNode,
): boolean {
  const normalized = selector?.trim();
  if (!normalized) return false;
  return [
    preferredCodeLayerSelector(node),
    node.selector,
    node.path,
    `[data-agent-native-node-id="${node.id}"]`,
    `[data-code-layer-id="${node.id}"]`,
    `[data-layer-id="${node.id}"]`,
    ...node.selectors,
  ].some((candidate) => candidate === normalized);
}

function measuredRenderedInfoForNode(
  node: CodeLayerNode,
  fileId: string,
  selectedElement: ElementInfo | null,
  renderedElementInfoByLayerKeyRef?: RefObject<Map<string, ElementInfo>>,
): ElementInfo | undefined {
  const rendered = renderedElementInfoByLayerKeyRef?.current;
  const stableId = durableNodeId(node);
  const fromMap =
    rendered?.get(`${fileId}:${node.id}`) ??
    rendered?.get(`${fileId}:${stableId}`) ??
    rendered?.get(node.id) ??
    rendered?.get(stableId);
  if (fromMap) return fromMap;
  if (renderedElementInfoByLayerKeyRef) return undefined;

  const selectedMatches =
    selectedElement &&
    (selectedElement.sourceLayerIdentity?.nodeId === node.id ||
      selectedElement.sourceId === node.id ||
      selectedElement.sourceId === stableId ||
      selectorMatchesNode(selectedElement.selector, node));
  return selectedMatches ? selectedElement : undefined;
}

function renderedInfoForNode(
  node: CodeLayerNode,
  fileId: string,
  selectedElement: ElementInfo | null,
  renderedElementInfoByLayerKeyRef?: RefObject<Map<string, ElementInfo>>,
): ElementInfo {
  return (
    measuredRenderedInfoForNode(
      node,
      fileId,
      selectedElement,
      renderedElementInfoByLayerKeyRef,
    ) ?? elementInfoFromCodeLayerNode(node)
  );
}

function renderedPosition(info: ElementInfo, node: CodeLayerNode): string {
  return (
    info.computedStyles.position?.trim().toLowerCase() ||
    info.inlineStyles?.position?.trim().toLowerCase() ||
    node.layout.position?.trim().toLowerCase() ||
    node.style.position?.trim().toLowerCase() ||
    "static"
  );
}

function renderedZIndex(info: ElementInfo, node: CodeLayerNode): number {
  const computedValue = info.computedStyles.zIndex?.trim().toLowerCase();
  if (computedValue === "auto") return 0;
  const computed = Number.parseInt(computedValue ?? "", 10);
  if (Number.isFinite(computed)) return computed;
  const source = Number.parseInt(node.style["z-index"] ?? "", 10);
  return Number.isFinite(source) ? source : 0;
}

function zIndexParticipatesInPaint(
  info: ElementInfo,
  node: CodeLayerNode,
): boolean {
  return (
    renderedPosition(info, node) !== "static" ||
    /flex|grid/.test(renderedParentDisplay(info, node))
  );
}

function hasExplicitZIndex(info: ElementInfo, node: CodeLayerNode): boolean {
  const computed = info.computedStyles.zIndex?.trim().toLowerCase();
  if (computed)
    return computed !== "auto" && zIndexParticipatesInPaint(info, node);
  const authored = node.style["z-index"]?.trim().toLowerCase();
  if (!authored || authored === "auto") return false;
  return zIndexParticipatesInPaint(info, node);
}

function renderedParentDisplay(info: ElementInfo, node: CodeLayerNode): string {
  return (
    info.parentDisplay ??
    info.parentLayout?.display ??
    node.layout.parentDisplay ??
    ""
  ).toLowerCase();
}

function inFlowZIndexContext(
  projection: CodeLayerProjection,
  targetId: string,
  fileId: string,
  selectedElement: ElementInfo | null,
  renderedElementInfoByLayerKeyRef?: RefObject<Map<string, ElementInfo>>,
): InFlowZIndexContext {
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const siblingOrder = findCodeLayerSiblingOrder(
    buildCodeLayerTree(projection),
    targetId,
  );

  let siblingFloor = 0;
  const siblingPaintLevels = [0];
  for (const siblingId of siblingOrder?.siblingIds ?? []) {
    if (siblingId === targetId) continue;
    const sibling = byId.get(siblingId);
    if (!sibling) continue;
    const info = renderedInfoForNode(
      sibling,
      fileId,
      selectedElement,
      renderedElementInfoByLayerKeyRef,
    );
    const computedValue = info.computedStyles.zIndex?.trim().toLowerCase();
    const computed = Number.parseInt(computedValue ?? "", 10);
    const declared =
      computedValue === "auto"
        ? Number.NaN
        : Number.isFinite(computed)
          ? computed
          : Number.parseInt(sibling.style["z-index"] ?? "", 10);
    if (zIndexParticipatesInPaint(info, sibling) && Number.isFinite(declared)) {
      siblingFloor = Math.min(siblingFloor, declared);
      siblingPaintLevels.push(declared);
    }
  }

  let hasPositionedDescendant = false;
  const pending = [...(byId.get(targetId)?.children ?? [])];
  while (pending.length > 0) {
    const node = byId.get(pending.pop()!);
    if (!node) continue;
    const info = renderedInfoForNode(
      node,
      fileId,
      selectedElement,
      renderedElementInfoByLayerKeyRef,
    );
    const position = renderedPosition(info, node);
    if (position === "absolute" || position === "fixed") {
      hasPositionedDescendant = true;
      break;
    }
    if (position !== "static") continue;
    pending.push(...node.children);
  }

  return {
    parentId: siblingOrder?.parentId ?? undefined,
    siblingFloor,
    siblingPaintLevels,
    hasPositionedDescendant,
  };
}

function isFlowLayoutTarget(info: ElementInfo, node: CodeLayerNode): boolean {
  return /flex|grid/.test(renderedParentDisplay(info, node));
}

function finalSiblingOrder(
  siblingIds: string[],
  selectedIds: Set<string>,
  mode: ChangeSelectedZIndexMode,
): string[] {
  if (selectedIds.size === 0) return siblingIds;
  const selected = siblingIds.filter((id) => selectedIds.has(id));
  const unselected = siblingIds.filter((id) => !selectedIds.has(id));
  if (mode === "front") return [...unselected, ...selected];
  if (mode === "back") return [...selected, ...unselected];

  const order = [...siblingIds];
  if (mode === "forward") {
    for (let index = order.length - 2; index >= 0; index -= 1) {
      if (
        selectedIds.has(order[index]!) &&
        !selectedIds.has(order[index + 1]!)
      ) {
        [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
      }
    }
  } else {
    for (let index = 1; index < order.length; index += 1) {
      if (
        selectedIds.has(order[index]!) &&
        !selectedIds.has(order[index - 1]!)
      ) {
        [order[index - 1], order[index]] = [order[index]!, order[index - 1]!];
      }
    }
  }
  return order;
}

function moveIntentsForOrder(
  currentOrder: string[],
  desiredOrder: string[],
  movingIds: Set<string>,
): MoveNodeEditIntent[] {
  const working = [...currentOrder];
  const intents: MoveNodeEditIntent[] = [];
  for (const targetId of desiredOrder.filter((id) => movingIds.has(id))) {
    const currentIndex = working.indexOf(targetId);
    if (currentIndex < 0) continue;
    working.splice(currentIndex, 1);
    const desiredIndex = desiredOrder.indexOf(targetId);
    const previousDesiredId =
      desiredIndex > 0 ? desiredOrder[desiredIndex - 1] : undefined;
    const anchorIndex = previousDesiredId
      ? working.indexOf(previousDesiredId)
      : 0;
    if (anchorIndex < 0) {
      working.splice(currentIndex, 0, targetId);
      continue;
    }
    const insertionIndex = previousDesiredId ? anchorIndex + 1 : 0;
    if (currentIndex !== insertionIndex) {
      const anchor = previousDesiredId ? previousDesiredId : working[0];
      if (anchor && anchor !== targetId) {
        intents.push({
          kind: "moveNode",
          target: { nodeId: targetId },
          anchor: { nodeId: anchor },
          placement: previousDesiredId ? "after" : "before",
        });
      }
    }
    working.splice(insertionIndex, 0, targetId);
  }
  return intents;
}

function ancestorSelectionConflict(
  targets: CodeLayerNode[],
  byId: Map<string, CodeLayerNode>,
): boolean {
  const selected = new Set(targets.map((node) => node.id));
  return targets.some((node) => {
    let parentId = node.parentId;
    while (parentId) {
      if (selected.has(parentId)) return true;
      parentId = byId.get(parentId)?.parentId;
    }
    return false;
  });
}

function findNodeByDurableId(
  projection: CodeLayerProjection,
  id: string,
): CodeLayerNode | undefined {
  return projection.nodes.find(
    (node) => durableNodeId(node) === id || node.id === id,
  );
}

function intentTouchesLinkedComponentInternals(
  intent: MoveNodeEditIntent,
  projection: CodeLayerProjection,
): boolean {
  const targetId = intent.target.nodeId;
  if (!targetId) return false;
  const target = findNodeByDurableId(projection, targetId);
  const root = target && linkedComponentRootForNode(target, projection);
  return Boolean(root && root.id !== target.id);
}

function applyStyleWrites(
  content: string,
  projection: CodeLayerProjection,
  writes: StyleWrite[],
  source: CodeLayerSource,
  upperBoundPx: number | null,
  lowerBoundPx: number | null,
): { content: string; projection: CodeLayerProjection } | null {
  let nextContent = content;
  let nextProjection = projection;
  for (const write of writes) {
    const node = findNodeByDurableId(nextProjection, write.nodeId);
    if (!node) return null;
    const patch = applyScopedVisualStyleEdit({
      content: nextContent,
      target: { nodeId: node.id },
      property: write.property,
      value: write.value,
      source,
      upperBoundPx,
      lowerBoundPx,
    });
    if (patch.result.status !== "applied") return null;
    nextContent = patch.content;
    nextProjection = patch.projection;
  }
  return { content: nextContent, projection: nextProjection };
}

function selectedElementMatchesNode(
  selectedElement: ElementInfo | null,
  node: CodeLayerNode,
): boolean {
  return Boolean(
    selectedElement &&
    (selectedElement.sourceLayerIdentity?.nodeId === node.id ||
      selectedElement.sourceId === node.id ||
      selectedElement.sourceId === durableNodeId(node) ||
      selectorMatchesNode(selectedElement.selector, node)),
  );
}

function legacyStyleFallback(
  args: ChangeSelectedZIndexArgs,
  mode: ChangeSelectedZIndexMode,
): ChangeSelectedZIndexResult {
  const {
    commitVisualStyles,
    invalidateRenderedElementInfo,
    renderedElementInfoByLayerKeyRef,
    selectedElement,
  } = args;
  if (!selectedElement?.selector) return { status: "unchanged" };
  const current = Number.parseInt(
    selectedElement.computedStyles.zIndex || "",
    10,
  );
  const base = Number.isFinite(current) ? current : 0;
  const next =
    mode === "front"
      ? 999
      : mode === "back"
        ? Math.min(base, -1)
        : mode === "forward"
          ? base + 1
          : base - 1;
  commitVisualStyles(
    selectedElement.selector,
    {
      position:
        selectedElement.computedStyles.position === "static"
          ? "relative"
          : selectedElement.computedStyles.position || "relative",
      zIndex: String(Math.max(0, next)),
    },
    { elementInfo: selectedElement },
  );
  invalidateRenderedElementInfo?.();
  if (!invalidateRenderedElementInfo)
    renderedElementInfoByLayerKeyRef?.current.clear();
  return { status: "applied" };
}

function clearRenderedElementInfo(args: ChangeSelectedZIndexArgs): void {
  if (args.invalidateRenderedElementInfo) {
    args.invalidateRenderedElementInfo();
    return;
  }
  args.renderedElementInfoByLayerKeyRef?.current.clear();
}

export function runChangeSelectedZIndex(
  args: ChangeSelectedZIndexArgs,
  mode: ChangeSelectedZIndexMode,
): ChangeSelectedZIndexResult {
  const {
    activeBreakpointUpperBoundPx = null,
    activeBreakpointWidthStateRef,
    activeFile,
    applyLinkedComponentEdit,
    applyLocalContentUpdate,
    canEditDesign,
    codeLayerOwnerByNodeIdRef,
    commitVisualStyles,
    getFreshActiveContent,
    renderedElementInfoByLayerKeyRef,
    reportRefusal,
    responsiveEditScopeRef,
    selectedElement,
    selectedLayerIdsState,
    setSelectedElement,
  } = args;
  const refuse = (reason: ZOrderRefusal): ChangeSelectedZIndexResult => {
    reportRefusal?.(reason);
    return { status: "refused", reason };
  };

  if (!canEditDesign) return { status: "unchanged" };
  if (!activeFile) return refuse("selection");
  if (selectedLayerIdsState.length === 0) {
    return legacyStyleFallback(args, mode);
  }

  const baseContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  const initialProjection = buildCodeLayerProjection(baseContent, { source });
  const byId = new Map(initialProjection.nodes.map((node) => [node.id, node]));
  const owners = codeLayerOwnerByNodeIdRef.current;
  const lowerBoundPx =
    responsiveEditScopeRef?.current === "only"
      ? (activeBreakpointWidthStateRef?.current ?? null)
      : null;
  const hasResponsiveBounds =
    activeBreakpointUpperBoundPx !== null || lowerBoundPx !== null;
  const targets: TargetPlan[] = [];

  for (const selectedId of selectedLayerIdsState) {
    const owner = owners.get(selectedId);
    if (!owner || owner.fileId !== activeFile.id) return refuse("selection");
    if (owner.runtimeOnly) return refuse("runtime-only");
    const node = nodeForId(initialProjection, selectedId, owner);
    if (!node) return refuse("selection");
    if (node.repeatXFor || owner.node?.repeatXFor)
      return refuse("repeat-anchor");
    const info = measuredRenderedInfoForNode(
      node,
      activeFile.id,
      selectedElement,
      renderedElementInfoByLayerKeyRef,
    );
    if (!info) return refuse("selection");
    const position = renderedPosition(info, node);
    const siblingOrder = findCodeLayerSiblingOrder(
      buildCodeLayerTree(initialProjection),
      node.id,
    );
    const context = inFlowZIndexContext(
      initialProjection,
      node.id,
      activeFile.id,
      selectedElement,
      renderedElementInfoByLayerKeyRef,
    );
    const flowLayout = isFlowLayoutTarget(info, node);
    const hasReorderableSibling = (siblingOrder?.siblingIds.length ?? 0) > 1;
    const currentPaintLevel = renderedZIndex(info, node);
    const hasHigherPaintSibling = context.siblingPaintLevels.some(
      (level) => level > currentPaintLevel,
    );
    const reorder =
      !hasResponsiveBounds &&
      hasReorderableSibling &&
      !hasExplicitZIndex(info, node) &&
      !hasHigherPaintSibling &&
      (position === "absolute" ||
        position === "fixed" ||
        flowLayout ||
        (position === "static" && context.hasPositionedDescendant));
    targets.push({ context, info, node, position, reorder, siblingOrder });
  }

  if (
    ancestorSelectionConflict(
      targets.map((target) => target.node),
      byId,
    )
  ) {
    return refuse("selection");
  }

  const intents: MoveNodeEditIntent[] = [];
  const grouped = new Map<string, TargetPlan[]>();
  for (const target of targets) {
    if (!target.reorder || !target.siblingOrder) continue;
    const key = target.siblingOrder.parentId ?? "__root__";
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    const siblingIds = group[0]!.siblingOrder!.siblingIds;
    const movingIds = new Set(group.map((target) => target.node.id));
    const desired = finalSiblingOrder(siblingIds, movingIds, mode);
    intents.push(...moveIntentsForOrder(siblingIds, desired, movingIds));
  }

  const styles: StyleWrite[] = [];
  const isolatedParents = new Set<string>();
  for (const target of targets) {
    if (target.reorder) continue;
    const current = renderedZIndex(target.info, target.node);
    const higherSiblingLevel = target.context.siblingPaintLevels
      .filter((level) => level > current)
      .sort((a, b) => a - b)[0];
    const lowerSiblingLevel = target.context.siblingPaintLevels
      .filter((level) => level < current)
      .sort((a, b) => b - a)[0];
    const next =
      mode === "front"
        ? Math.max(current, ...target.context.siblingPaintLevels) + 1
        : mode === "back"
          ? Math.min(current, target.context.siblingFloor - 1)
          : mode === "forward"
            ? (higherSiblingLevel ?? current) + 1
            : (lowerSiblingLevel ?? current) - 1;
    const parentId = target.context.parentId;
    const safeNext = next < 0 && !parentId ? 0 : next;
    if (next < 0 && parentId && !isolatedParents.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) return refuse("selection");
      styles.push({
        nodeId: durableNodeId(parent),
        property: "isolation",
        value: "isolate",
      });
      isolatedParents.add(parentId);
    }
    styles.push({
      nodeId: durableNodeId(target.node),
      property: "position",
      value:
        target.position === "static"
          ? "relative"
          : target.position || "relative",
    });
    styles.push({
      nodeId: durableNodeId(target.node),
      property: "z-index",
      value: String(safeNext),
    });
  }

  const linkedRoots = new Set<string>();
  for (const target of targets) {
    const linkedRoot = linkedComponentRootForNode(
      target.node,
      initialProjection,
    );
    if (linkedRoot) linkedRoots.add(linkedRoot.id);
  }

  if (linkedRoots.size > 0 && styles.length > 0) {
    if (hasResponsiveBounds) return refuse("responsive-scope");
    if (targets.length > 1 || intents.length > 0 || styles.length > 2) {
      return refuse("linked-component");
    }
    if (
      selectedElement &&
      selectedElementMatchesNode(selectedElement, targets[0]!.node)
    ) {
      commitVisualStyles(
        preferredCodeLayerSelector(targets[0]!.node),
        Object.fromEntries(
          styles
            .filter((write) => write.nodeId === durableNodeId(targets[0]!.node))
            .map((write) => [
              write.property === "z-index" ? "zIndex" : write.property,
              write.value,
            ]),
        ),
        { elementInfo: targets[0]!.info },
      );
      clearRenderedElementInfo(args);
      return { status: "applied" };
    }
    return refuse("linked-component");
  }

  if (intents.length === 0 && styles.length > 0 && targets.length === 1) {
    const target = targets[0]!;
    const parentIsolation = styles.some(
      (write) =>
        write.property === "isolation" &&
        write.nodeId !== durableNodeId(target.node),
    );
    if (
      !parentIsolation &&
      selectedElementMatchesNode(selectedElement, target.node)
    ) {
      commitVisualStyles(
        preferredCodeLayerSelector(target.node),
        Object.fromEntries(
          styles.map((write) => [
            write.property === "z-index" ? "zIndex" : write.property,
            write.value,
          ]),
        ),
        { elementInfo: target.info },
      );
      clearRenderedElementInfo(args);
      return { status: "applied" };
    }
  }

  for (const intent of intents) {
    const targetId = intent.target.nodeId;
    const anchorId = intent.anchor.nodeId;
    if (!targetId || !anchorId) return refuse("patch");
    const targetNode = findNodeByDurableId(initialProjection, targetId);
    const anchorNode = findNodeByDurableId(initialProjection, anchorId);
    if (
      !targetNode ||
      !anchorNode ||
      targetNode.repeatXFor ||
      anchorNode.repeatXFor ||
      owners.get(targetId)?.runtimeOnly ||
      owners.get(anchorId)?.runtimeOnly
    ) {
      return refuse("repeat-anchor");
    }
  }

  const linkedInternalIntents = intents.filter((intent) =>
    intentTouchesLinkedComponentInternals(intent, initialProjection),
  );
  if (linkedInternalIntents.length > 0) {
    const linkedStructure = dispatchLinkedComponentStructure({
      content: baseContent,
      source,
      intents,
      applyLinkedComponentEdit,
    });
    if (linkedStructure) {
      clearRenderedElementInfo(args);
      return { status: "queued" };
    }
    return refuse("linked-component");
  }

  let nextContent = baseContent;
  let nextProjection = initialProjection;
  for (const intent of intents) {
    const patch = applyVisualEdit(nextContent, intent, { source });
    if (patch.result.status !== "applied") return refuse("patch");
    nextContent = patch.content;
    nextProjection = patch.projection;
  }

  if (styles.length > 0) {
    const patchedStyles = applyStyleWrites(
      nextContent,
      nextProjection,
      styles,
      source,
      activeBreakpointUpperBoundPx,
      lowerBoundPx,
    );
    if (!patchedStyles) return refuse("patch");
    nextContent = patchedStyles.content;
    nextProjection = patchedStyles.projection;
  }
  if (nextContent === baseContent) return { status: "unchanged" };

  const publication = applyLocalContentUpdate(nextContent, {
    forcePreviewFullDocument: true,
  });
  if (publication.status !== "accepted") return refuse("publication");
  clearRenderedElementInfo(args);

  const primaryId = selectedLayerIdsState[selectedLayerIdsState.length - 1]!;
  const originalPrimary = nodeForId(
    initialProjection,
    primaryId,
    owners.get(primaryId),
  );
  const primaryNode = originalPrimary
    ? nextProjection.nodes.find(
        (node) => durableNodeId(node) === durableNodeId(originalPrimary),
      )
    : undefined;
  const acceptedProjection = projectAcceptedSource(
    publication,
    nextProjection.source,
  );
  const acceptedNode = mapAcceptedSelectionNode(
    publication,
    acceptedProjection,
    primaryNode,
  );
  if (acceptedNode) {
    setSelectedElement(elementInfoFromCodeLayerNode(acceptedNode));
  }
  return { status: "applied" };
}
