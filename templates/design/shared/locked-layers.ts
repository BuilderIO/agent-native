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
  /** Null when nothing tells this node apart from another one. */
  token: string | null;
  ancestorTokens: (string | null)[];
  siblingTokens: (string | null)[];
}

function explicitIdentity(node: CodeLayerNode): string | null {
  const stableId = node.dataAttributes["data-agent-native-node-id"];
  if (stableId) return `node:${stableId}`;
  const htmlId = node.attributes.id;
  if (typeof htmlId === "string" && htmlId.length > 0) return `id:${htmlId}`;
  return null;
}

function signature(node: CodeLayerNode): string {
  return `sig:${node.tag}|${node.classes.join(".")}`;
}

function countBy<T>(items: readonly T[], key: (item: T) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * One identity per node, or null when nothing distinguishes it. Never derive
 * it from a byte offset: unrelated edits move offsets, and a node that merely
 * moved keeps its markup.
 */
function buildTokens(
  projection: CodeLayerProjection,
): Map<string, string | null> {
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const globalCounts = countBy(projection.nodes, explicitIdentity);
  const tokens = new Map<string, string | null>();

  const assignSiblingGroup = (childIds: readonly string[]) => {
    const group = childIds.flatMap((id) => {
      const node = nodesById.get(id);
      return node ? [node] : [];
    });
    const signatureCounts = countBy(group, (node) =>
      explicitIdentity(node) ? null : signature(node),
    );
    for (const node of group) {
      const explicit = explicitIdentity(node);
      if (explicit) {
        tokens.set(node.id, globalCounts.get(explicit) === 1 ? explicit : null);
        continue;
      }
      const sig = signature(node);
      tokens.set(node.id, signatureCounts.get(sig) === 1 ? sig : null);
    }
  };

  assignSiblingGroup(projection.rootNodeIds);
  for (const node of projection.nodes) assignSiblingGroup(node.children);
  return tokens;
}

function lockedLayerPlacement(
  projection: CodeLayerProjection,
  tokens: Map<string, string | null>,
  node: CodeLayerNode,
): Pick<LockedLayerSnapshot, "token" | "ancestorTokens" | "siblingTokens"> {
  const nodesById = new Map(
    projection.nodes.map((candidate) => [candidate.id, candidate]),
  );
  const ancestorTokens: (string | null)[] = [];
  let parent = node.parentId ? nodesById.get(node.parentId) : undefined;
  while (parent) {
    ancestorTokens.unshift(tokens.get(parent.id) ?? null);
    parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
  }

  const siblingIds = node.parentId
    ? (nodesById.get(node.parentId)?.children ?? [])
    : projection.rootNodeIds;

  return {
    token: tokens.get(node.id) ?? null,
    ancestorTokens,
    siblingTokens: siblingIds.map((id) => tokens.get(id) ?? null),
  };
}

function lockedNodes(projection: CodeLayerProjection): CodeLayerNode[] {
  return projection.nodes.filter(
    (node) => node.dataAttributes[LOCKED_ATTRIBUTE] === "true" && node.source,
  );
}

/** Position among the siblings both documents can name, self included. */
function orderAmongSharedSiblings(
  side: Pick<LockedLayerSnapshot, "token" | "siblingTokens">,
  other: Pick<LockedLayerSnapshot, "siblingTokens">,
): number {
  const shared = new Set(other.siblingTokens.filter((token) => token !== null));
  return side.siblingTokens
    .filter((token) => token !== null && shared.has(token))
    .indexOf(side.token);
}

/**
 * Capture the exact source subtree for every durably locked Design layer.
 * Stable node ids are stamped before files are persisted, so the same layer
 * can be found after an agent proposes an updated document.
 */
export function lockedLayerSnapshots(html: string): LockedLayerSnapshot[] {
  const projection = buildCodeLayerProjection(html);
  const tokens = buildTokens(projection);
  return lockedNodes(projection).map((node) => ({
    id: node.id,
    label: node.layerName,
    source: html.slice(node.source!.start, node.source!.end),
    ...lockedLayerPlacement(projection, tokens, node),
  }));
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

function namesFor(labels: readonly string[]): string {
  return Array.from(new Set(labels)).slice(0, 5).join(", ");
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function unverifiable(labels: string[]): Error {
  return new Error(
    `Cannot verify locked layer${plural(labels.length)}: ${namesFor(labels)}. ` +
      "The layer, its parent, or a sibling has no unique " +
      "data-agent-native-node-id, so this edit cannot be checked. Re-read the " +
      "file and keep its stamped ids.",
  );
}

/**
 * Locked layers are agent-immutable in BOTH directions: re-adding the flag
 * undoes the human's unlock and re-blocks the agent forever. Ambiguous
 * identity never passes. The human editor's layer control writes as
 * `caller: "frontend"` and does not reach this guard.
 */
export function assertLockedLayersPreserved(
  before: string,
  after: string,
): void {
  // Both sides need projecting to compare lock sets, and most designs carry no
  // locked layer. Keep that case off the parser on every guarded write.
  if (!before.includes(LOCKED_ATTRIBUTE) && !after.includes(LOCKED_ATTRIBUTE)) {
    return;
  }

  const afterProjection = buildCodeLayerProjection(after);
  const afterTokens = buildTokens(afterProjection);
  const locked = lockedLayerSnapshots(before);
  const nowLocked = lockedNodes(afterProjection).map((node) => ({
    node,
    token: afterTokens.get(node.id) ?? null,
  }));

  const nameless = [
    ...locked
      .filter((snapshot) => snapshot.token === null)
      .map((snapshot) => snapshot.label),
    ...nowLocked
      .filter((entry) => entry.token === null)
      .map((entry) => entry.node.layerName),
  ];
  if (nameless.length > 0) throw unverifiable(nameless);

  const lockedBeforeTokens = new Set(locked.map((snapshot) => snapshot.token!));
  const added = nowLocked.filter(
    (entry) => !lockedBeforeTokens.has(entry.token!),
  );
  if (added.length > 0) {
    throw new Error(
      `This edit locks layer${plural(added.length)} the editor had unlocked: ` +
        `${namesFor(added.map((entry) => entry.node.layerName))}. ` +
        "Only the human editor sets data-agent-native-locked. Re-read the " +
        "file and rebuild the edit from its current content.",
    );
  }

  const afterByToken = new Map(nowLocked.map((entry) => [entry.token!, entry]));
  const changed: string[] = [];
  const unchecked: string[] = [];

  for (const snapshot of locked) {
    const next = afterByToken.get(snapshot.token!);
    if (!next) {
      changed.push(snapshot.label);
      continue;
    }
    if (
      after.slice(next.node.source!.start, next.node.source!.end) !==
      snapshot.source
    ) {
      changed.push(snapshot.label);
      continue;
    }
    const placement = lockedLayerPlacement(
      afterProjection,
      afterTokens,
      next.node,
    );
    // A null anchor on the BEFORE side could be hiding the move we are looking
    // for. Nulls only in AFTER are newly inserted siblings.
    if (
      snapshot.ancestorTokens.includes(null) ||
      placement.ancestorTokens.includes(null) ||
      snapshot.siblingTokens.includes(null)
    ) {
      unchecked.push(snapshot.label);
      continue;
    }
    if (
      placement.ancestorTokens.length !== snapshot.ancestorTokens.length ||
      placement.ancestorTokens.some(
        (token, index) => token !== snapshot.ancestorTokens[index],
      ) ||
      orderAmongSharedSiblings(snapshot, placement) !==
        orderAmongSharedSiblings(placement, snapshot)
    ) {
      changed.push(snapshot.label);
    }
  }

  if (changed.length > 0) {
    throw new Error(
      `This edit changes locked layer${plural(changed.length)}: ${namesFor(changed)}. ` +
        "Preserve locked layers exactly, or ask the user to unlock them first.",
    );
  }
  if (unchecked.length > 0) throw unverifiable(unchecked);
}
