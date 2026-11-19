export function designMetadataQueryKey(id: string | undefined) {
  return ["action", "get-design", { id, includeFileContent: false }] as const;
}
