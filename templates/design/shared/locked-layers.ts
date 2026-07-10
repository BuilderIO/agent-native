import { buildCodeLayerProjection } from "./code-layer.js";

export interface LockedLayerSnapshot {
  id: string;
  label: string;
  source: string;
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
    if (nextSource !== snapshot.source) changed.push(snapshot.label);
  }

  if (changed.length > 0) {
    const names = Array.from(new Set(changed)).slice(0, 5).join(", ");
    throw new Error(
      `This edit changes locked layer${changed.length === 1 ? "" : "s"}: ${names}. ` +
        "Preserve locked layers exactly, or ask the user to unlock them first.",
    );
  }
}
