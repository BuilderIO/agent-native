export function shouldShowLocalhostPreviewRecovery({
  sourceType,
  connectionId,
  snapshotOnly,
  refreshFailed,
  hasUsablePreviewCredentials,
  connectionUnavailable,
  canEdit,
  publicUnavailable,
  publicVisualEdit,
}: {
  sourceType?: string | null;
  connectionId?: string | null;
  snapshotOnly: boolean;
  refreshFailed: boolean;
  hasUsablePreviewCredentials: boolean;
  connectionUnavailable: boolean;
  canEdit: boolean;
  publicUnavailable: boolean;
  publicVisualEdit: boolean;
}): boolean {
  if (sourceType !== "localhost" || snapshotOnly) return false;

  if (!connectionId) return canEdit;
  if (refreshFailed) {
    return !hasUsablePreviewCredentials && (canEdit || publicVisualEdit);
  }
  if (connectionUnavailable) return canEdit || publicUnavailable;
  return false;
}
