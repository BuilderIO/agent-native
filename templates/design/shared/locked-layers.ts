import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "./code-layer.js";

export interface LockedLayerSnapshot {
  id: string;
  label: string;
  source: string;
  ancestorIds: string[];
  parentId: string | null;
  siblingIndex: number;
  previousSiblingId: string | null;
  nextSiblingId: string | null;
}

function durableNodeIdentity(node: CodeLayerNode): string {
  const stableId = node.dataAttributes["data-agent-native-node-id"];
  if (stableId) return `node:${stableId}`;
  const htmlId = node.attributes.id;
  if (typeof htmlId === "string" && htmlId.length > 0) return `id:${htmlId}`;
  return node.id;
}

function lockedLayerPlacement(
  projection: CodeLayerProjection,
  node: CodeLayerNode,
): Omit<LockedLayerSnapshot, "id" | "label" | "source"> {
  const nodesById = new Map(
    projection.nodes.map((candidate) => [candidate.id, candidate]),
  );
  const ancestors: CodeLayerNode[] = [];
  let parent = node.parentId ? nodesById.get(node.parentId) : undefined;
  while (parent) {
    ancestors.unshift(parent);
    parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
  }

  const siblingIds = node.parentId
    ? (nodesById.get(node.parentId)?.children ?? [])
    : projection.rootNodeIds;
  const siblingIndex = siblingIds.indexOf(node.id);
  const previousSibling =
    siblingIndex > 0 ? nodesById.get(siblingIds[siblingIndex - 1]!) : undefined;
  const nextSibling =
    siblingIndex >= 0 && siblingIndex < siblingIds.length - 1
      ? nodesById.get(siblingIds[siblingIndex + 1]!)
      : undefined;

  return {
    ancestorIds: ancestors.map(durableNodeIdentity),
    parentId:
      ancestors.length > 0
        ? durableNodeIdentity(ancestors[ancestors.length - 1]!)
        : null,
    siblingIndex,
    previousSiblingId: previousSibling
      ? durableNodeIdentity(previousSibling)
      : null,
    nextSiblingId: nextSibling ? durableNodeIdentity(nextSibling) : null,
  };
}

/**
 * Capture the exact source subtree for every durably locked Design layer.
 * Stable node ids are stamped before files are persisted, so the same layer
 * can be found after an agent proposes an updated document.
 */
export function lockedLayerSnapshots(html: string): LockedLayerSnapshot[] {
  const projection = buildCodeLayerProjection(html);
  return projection.nodes.flatMap((node) => {
    if (
      node.dataAttributes["data-agent-native-locked"] !== "true" ||
      !node.source
    ) {
      return [];
    }
    return [
      {
        id: node.id,
        label: node.layerName,
        source: html.slice(node.source.start, node.source.end),
        ...lockedLayerPlacement(projection, node),
      },
    ];
  });
}

export function countLockedLayers(html: string): number {
  return lockedLayerSnapshots(html).length;
}

export function countLockedLayersAcrossFiles(
  files: readonly { content?: string | null }[],
): number {
  return files.reduce(
    (count, file) =>
      count +
      (typeof file.content === "string" ? countLockedLayers(file.content) : 0),
    0,
  );
}

/**
 * Locked layers are immutable for agent-authored whole-file or text edits.
 * The human editor can still unlock a layer through its dedicated layer
 * control; that direct UI path does not call this guard.
 */
export function assertLockedLayersPreserved(
  before: string,
  after: string,
): void {
  const locked = lockedLayerSnapshots(before);
  if (locked.length === 0) return;

  const nextProjection = buildCodeLayerProjection(after);
  const nextById = new Map(nextProjection.nodes.map((node) => [node.id, node]));
  const changed: string[] = [];

  for (const snapshot of locked) {
    const next = nextById.get(snapshot.id);
    if (!next?.source) {
      changed.push(snapshot.label);
      continue;
    }
    const nextSource = after.slice(next.source.start, next.source.end);
    const nextPlacement = lockedLayerPlacement(nextProjection, next);
    if (
      nextSource !== snapshot.source ||
      nextPlacement.parentId !== snapshot.parentId ||
      nextPlacement.siblingIndex !== snapshot.siblingIndex ||
      nextPlacement.previousSiblingId !== snapshot.previousSiblingId ||
      nextPlacement.nextSiblingId !== snapshot.nextSiblingId ||
      nextPlacement.ancestorIds.length !== snapshot.ancestorIds.length ||
      nextPlacement.ancestorIds.some(
        (ancestorId, index) => ancestorId !== snapshot.ancestorIds[index],
      )
    ) {
      changed.push(snapshot.label);
    }
  }

  if (changed.length > 0) {
    const names = Array.from(new Set(changed)).slice(0, 5).join(", ");
    throw new Error(
      `This edit changes locked layer${changed.length === 1 ? "" : "s"}: ${names}. ` +
        "Preserve locked layers exactly, or ask the user to unlock them first.",
    );
  }
}
