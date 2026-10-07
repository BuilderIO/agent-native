export function shouldUseLiveDocumentCollaboration({
  isLocalFileDocument,
  openAiWidget,
}: {
  isLocalFileDocument: boolean;
  openAiWidget: boolean;
}): boolean {
  return !isLocalFileDocument && !openAiWidget;
}
