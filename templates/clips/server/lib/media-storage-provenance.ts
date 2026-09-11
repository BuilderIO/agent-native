export function allowsLegacyS3ObjectForPersistedMedia(params: {
  requestedUrl: string;
  persistedUrl: string | null | undefined;
  editsJson: string | null | undefined;
}): boolean {
  if (!params.persistedUrl || params.persistedUrl !== params.requestedUrl) {
    return false;
  }
  try {
    const edits = JSON.parse(params.editsJson || "{}");
    return edits?.mediaStorageLayout !== "external";
    // coercion-ok: malformed provenance is an explicit deny, never successful authorization.
  } catch {
    return false;
  }
}
