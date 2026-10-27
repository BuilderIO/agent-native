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

export type LayerStateOverrides = Map<
  string,
  { hidden?: boolean; locked?: boolean }
>;

/**
 * Next hidden or locked id set after the built layer models change. Settles
 * `overrides` in place: an override is dropped once the source agrees with it
 * or its layer no longer exists.
 */
export function reconcileLayerStateIds({
  current,
  kind,
  liveFileIds,
  builtStateByFileId,
  overrides,
}: {
  current: Set<string>;
  kind: "hidden" | "locked";
  liveFileIds: ReadonlySet<string>;
  builtStateByFileId: ReadonlyMap<string, SourceLayerStateIds>;
  overrides: LayerStateOverrides;
}): Set<string> {
  const screenOf = (id: string) =>
    liveFileIds.has(id) ? id : id.split(LAYER_STATE_SCOPE_SEPARATOR, 1)[0]!;
  // Layer models are built on demand, so a screen without one says nothing
  // about its layers: its ids and overrides carry over untouched.
  const isSettled = (id: string) =>
    !liveFileIds.has(id) && builtStateByFileId.has(screenOf(id));
  const sourceIds = new Set(
    [...builtStateByFileId.values()].flatMap((state) => state[kind]),
  );
  const next = new Set(sourceIds);
  current.forEach((id) => {
    if (liveFileIds.has(screenOf(id)) && !isSettled(id)) next.add(id);
  });
  overrides.forEach((override, id) => {
    const screenId = screenOf(id);
    const layerExists =
      liveFileIds.has(screenId) &&
      (!isSettled(id) || builtStateByFileId.get(screenId)!.all.has(id));
    if (!layerExists) {
      overrides.delete(id);
      return;
    }
    const value = override[kind];
    if (value === undefined) return;
    if (isSettled(id) && sourceIds.has(id) === value) {
      const remaining = { ...override };
      delete remaining[kind];
      if (remaining.hidden === undefined && remaining.locked === undefined) {
        overrides.delete(id);
      } else {
        overrides.set(id, remaining);
      }
      return;
    }
    if (value) next.add(id);
    else next.delete(id);
  });
  if (
    next.size === current.size &&
    Array.from(next).every((id) => current.has(id))
  ) {
    return current;
  }
  return next;
}
