export function shouldUseLiveDocumentCollaboration({
  isLocalFileDocument,
  mcpDirectoryWidgetReadOnly,
}: {
  isLocalFileDocument: boolean;
  mcpDirectoryWidgetReadOnly: boolean;
}): boolean {
  return !isLocalFileDocument && !mcpDirectoryWidgetReadOnly;
}
