export function isStandaloneHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/[\s<>]/.test(trimmed)) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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
