export function isProbablyHtmlDocumentContent(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed) return true;
  if (trimmed.startsWith("<")) return true;
  return false;
}

export function shouldUseLiveFileContent({
  liveContent,
  storedContent,
  fileType,
}: {
  liveContent: string;
  storedContent: string;
  fileType: string;
}): boolean {
  if (liveContent === storedContent) return true;
  if (fileType.toLowerCase() !== "html") return true;
  if (!isProbablyHtmlDocumentContent(storedContent)) return true;
  return isProbablyHtmlDocumentContent(liveContent);
}
