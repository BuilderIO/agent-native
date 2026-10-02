import type { CodeLayerProjection } from "@shared/code-layer";

const LAYER_STATE_SCOPE_SEPARATOR = "\u001f";

export function scopedLayerStateId(screenId: string, layerId: string): string {
  return layerId === screenId
    ? screenId
    : `${screenId}${LAYER_STATE_SCOPE_SEPARATOR}${layerId}`;
}

export function layerStateIdsForScreen(
  stateIds: ReadonlySet<string>,
  screenId: string,
): Set<string> {
  const prefix = `${screenId}${LAYER_STATE_SCOPE_SEPARATOR}`;
  const result = new Set<string>();
  if (stateIds.has(screenId)) result.add(screenId);
  stateIds.forEach((id) => {
    if (id.startsWith(prefix)) result.add(id.slice(prefix.length));
  });
  return result;
}

export function hasScopedLayerState(
  stateIds: ReadonlySet<string>,
  screenId: string,
  layerId: string,
): boolean {
  return stateIds.has(scopedLayerStateId(screenId, layerId));
}

export interface SourceLayerStateIds {
  locked: string[];
  hidden: string[];
  all: ReadonlySet<string>;
}

const sourceLayerStateIdsByProjection = new WeakMap<
  CodeLayerProjection,
  { fileId: string; ids: SourceLayerStateIds }
>();

// Cached per projection object, so an edit re-scans only the edited screen.
export function sourceLayerStateIds(
  fileId: string,
  projection: CodeLayerProjection,
): SourceLayerStateIds {
  const cached = sourceLayerStateIdsByProjection.get(projection);
  if (cached?.fileId === fileId) return cached.ids;
  const locked: string[] = [];
  const hidden: string[] = [];
  const all = new Set<string>();
  for (const node of projection.nodes) {
    const id = scopedLayerStateId(fileId, node.id);
    all.add(id);
    if (node.dataAttributes["data-agent-native-locked"] === "true") {
      locked.push(id);
    }
    if (node.dataAttributes["data-agent-native-hidden"] === "true") {
      hidden.push(id);
    }
  }
  const ids = { locked, hidden, all };
  sourceLayerStateIdsByProjection.set(projection, { fileId, ids });
  return ids;
}
