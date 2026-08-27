import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "./code-layer.js";

const LOCKED_ATTRIBUTE = "data-agent-native-locked";

export interface LockedLayerSnapshot {
  id: string;
  label: string;
  source: string;
  ancestorIds: string[];
  parentId: string | null;
  /** Durable identities of every sibling, in document order, including self. */
  siblingIds: string[];
  selfId: string;
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

  const siblingIds = (
    node.parentId
      ? (nodesById.get(node.parentId)?.children ?? [])
      : projection.rootNodeIds
  ).flatMap((siblingId) => {
    const sibling = nodesById.get(siblingId);
    return sibling ? [durableNodeIdentity(sibling)] : [];
  });

  return {
    ancestorIds: ancestors.map(durableNodeIdentity),
    parentId:
      ancestors.length > 0
        ? durableNodeIdentity(ancestors[ancestors.length - 1]!)
        : null,
    siblingIds,
    selfId: durableNodeIdentity(node),
  };
}

/**
 * Order among the siblings present on BOTH sides. A raw position would make
 * any insert earlier in the parent read as "the locked layer moved".
 */
function orderAmongSurvivingSiblings(
  siblingIds: string[],
  selfId: string,
  otherSiblingIds: readonly string[],
): number {
  const shared = new Set(otherSiblingIds);
  return siblingIds.filter((id) => shared.has(id)).indexOf(selfId);
}

/**
 * Capture the exact source subtree for every durably locked Design layer.
 * Stable node ids are stamped before files are persisted, so the same layer
 * can be found after an agent proposes an updated document.
 */
export function lockedLayerSnapshots(html: string): LockedLayerSnapshot[] {
  const projection = buildCodeLayerProjection(html);
  return projection.nodes.flatMap((node) => {
    if (node.dataAttributes[LOCKED_ATTRIBUTE] !== "true" || !node.source) {
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

function namesFor(labels: string[]): string {
  return Array.from(new Set(labels)).slice(0, 5).join(", ");
}

/**
 * Locked layers are immutable for agent-authored whole-file or text edits, in
 * BOTH directions: an agent that re-adds the flag undoes the human's unlock
 * and re-blocks itself forever. The human editor's own layer control writes as
 * `caller: "frontend"`, which does not reach this guard.
 */
export function assertLockedLayersPreserved(
  before: string,
  after: string,
): void {
  // Comparing lock sets needs BOTH sides projected, and most designs carry no
  // locked layer. Keep that case off the parser on every guarded write.
  if (!before.includes(LOCKED_ATTRIBUTE) && !after.includes(LOCKED_ATTRIBUTE)) {
    return;
  }
  const locked = lockedLayerSnapshots(before);
  const nextProjection = buildCodeLayerProjection(after);
  const lockedBeforeIds = new Set(locked.map((snapshot) => snapshot.id));
  const nowLocked = nextProjection.nodes.filter(
    (node) =>
      node.dataAttributes[LOCKED_ATTRIBUTE] === "true" &&
      !lockedBeforeIds.has(node.id),
  );
  if (nowLocked.length > 0) {
    throw new Error(
      `This edit locks layer${nowLocked.length === 1 ? "" : "s"} the editor had unlocked: ` +
        `${namesFor(nowLocked.map((node) => node.layerName))}. ` +
        "Only the human editor sets data-agent-native-locked. Re-read the " +
        "file and rebuild the edit from its current content.",
    );
  }
  if (locked.length === 0) return;

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
      nextPlacement.selfId !== snapshot.selfId ||
      orderAmongSurvivingSiblings(
        nextPlacement.siblingIds,
        nextPlacement.selfId,
        snapshot.siblingIds,
      ) !==
        orderAmongSurvivingSiblings(
          snapshot.siblingIds,
          snapshot.selfId,
          nextPlacement.siblingIds,
        ) ||
      nextPlacement.ancestorIds.length !== snapshot.ancestorIds.length ||
      nextPlacement.ancestorIds.some(
        (ancestorId, index) => ancestorId !== snapshot.ancestorIds[index],
      )
    ) {
      changed.push(snapshot.label);
    }
  }

  if (changed.length > 0) {
    throw new Error(
      `This edit changes locked layer${changed.length === 1 ? "" : "s"}: ${namesFor(changed)}. ` +
        "Preserve locked layers exactly, or ask the user to unlock them first.",
    );
  }
}
