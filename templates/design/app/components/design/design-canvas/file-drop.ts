export function isOsFileDragEvent(event: {
  dataTransfer: { types: readonly string[] | DOMStringList } | null;
}): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === "Files") return true;
  }
  return false;
}
