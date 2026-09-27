export interface LiveCollaborationOverride {
  enabled: boolean;
  observedDataUpdatedAt: number;
}

export function reconcileLiveCollaborationOverride(
  override: LiveCollaborationOverride | null,
  persistedEnabled: boolean | undefined,
  dataUpdatedAt: number,
): LiveCollaborationOverride | null {
  if (
    override &&
    typeof persistedEnabled === "boolean" &&
    dataUpdatedAt > override.observedDataUpdatedAt
  ) {
    return null;
  }
  return override;
}
