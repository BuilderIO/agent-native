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
