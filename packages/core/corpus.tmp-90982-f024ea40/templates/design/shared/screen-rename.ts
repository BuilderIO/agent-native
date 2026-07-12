/**
 * Resolve the persisted filename for a screen rename without dropping its
 * current extension. The Layers panel edits the display name (normally just
 * the stem), while design_files.filename remains the routable identifier.
 */
export function renameFilenamePreservingExtension(
  currentFilename: string,
  typedName: string,
): string {
  const trimmed = typedName.trim();
  if (!trimmed) return currentFilename;

  const dot = currentFilename.lastIndexOf(".");
  const currentExtension = dot > 0 ? currentFilename.slice(dot) : "";
  if (
    currentExtension &&
    trimmed.toLowerCase().endsWith(currentExtension.toLowerCase())
  ) {
    return trimmed;
  }
  return currentExtension ? `${trimmed}${currentExtension}` : trimmed;
}

/**
 * Rewrite exact quoted `data-screen` attribute values while preserving the
 * source document's quote and whitespace style. This deliberately operates on
 * the serialized HTML instead of parsing/serializing the whole document, which
 * would create a large unrelated formatting diff for a one-attribute rename.
 */
export function replaceDataScreenReferences(
  content: string,
  oldFilename: string,
  newFilename: string,
): string {
  if (oldFilename === newFilename) return content;
  const escaped = oldFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `((?:^|[\\s<])data-screen\\s*=\\s*)(["'])${escaped}\\2`,
    "gm",
  );
  return content.replace(pattern, `$1$2${newFilename}$2`);
}
