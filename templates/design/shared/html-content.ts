/**
 * A URL-backed screen's `design_files.content` is the route URL itself, not a
 * document. Any transform that parses stored content as HTML must refuse this
 * shape: `DOMParser` happily turns the URL into body text, so the "edited"
 * document that comes back out has silently replaced the route.
 *
 * Lives in `shared/` so the server write path and `code-layer`'s document
 * transforms can reach the same predicate the editor uses — there must never
 * be a second one to keep in step.
 */
export function isStandaloneHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  // `new URL()` alone is not enough: the WHATWG parser strips newlines and
  // percent-encodes spaces and markup rather than failing, so it accepts
  // `http://localhost:8210/<div …>` — precisely the corrupted "route with a
  // serialized subtree glued on" shape this predicate must call NOT a URL.
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
