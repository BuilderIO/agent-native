export function shouldUseLiveDocumentCollaboration({
  isLocalFileDocument,
  isGitHubSourceDocument = false,
  mcpDirectoryWidgetReadOnly,
}: {
  isLocalFileDocument: boolean;
  /** Only sync writes these bodies, so the saved body is always current. */
  isGitHubSourceDocument?: boolean;
  mcpDirectoryWidgetReadOnly: boolean;
}): boolean {
  return (
    !isLocalFileDocument &&
    !isGitHubSourceDocument &&
    !mcpDirectoryWidgetReadOnly
  );
}
