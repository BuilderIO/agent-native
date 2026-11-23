export function collectionProjectFilter(
  id: string | null | undefined,
  name: string | null | undefined,
) {
  return id ? { folderId: id } : name ? { folderName: name } : {};
}
