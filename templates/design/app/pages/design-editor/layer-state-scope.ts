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
