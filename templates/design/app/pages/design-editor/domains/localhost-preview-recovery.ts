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

  if (!connectionId) return canEdit || publicUnavailable;
  if (refreshFailed) {
    return !hasUsablePreviewCredentials && (canEdit || publicVisualEdit);
  }
  if (connectionUnavailable) return canEdit || publicUnavailable;
  return false;
}

export function shouldShowPublicLocalhostPreviewUnavailable({
  sourceType,
  connectionId,
  snapshotOnly,
  publicVisualEdit,
  serverUnavailable,
}: {
  sourceType?: string | null;
  connectionId?: string | null;
  snapshotOnly: boolean;
  publicVisualEdit: boolean;
  serverUnavailable: boolean;
}): boolean {
  if (sourceType !== "localhost" || snapshotOnly) return false;
  return serverUnavailable || (publicVisualEdit && !connectionId);
}
