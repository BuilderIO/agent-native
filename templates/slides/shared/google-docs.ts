const GOOGLE_DOC_ID_RE = /^[a-zA-Z0-9_-]{20,}$/;

export function extractGoogleDocId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (GOOGLE_DOC_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!/(\.|^)google\.com$/i.test(url.hostname)) return null;

  const standardMatch = url.pathname.match(
    /\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/,
  );
  if (standardMatch) return standardMatch[1];

  const idParam = url.searchParams.get("id");
  return idParam && GOOGLE_DOC_ID_RE.test(idParam) ? idParam : null;
}

export function extractGoogleDocUrls(text: string): string[] {
  const urls = new Set<string>();
  const pattern = /https:\/\/docs\.google\.com\/document\/[^\s<>"'`),\]]+/gi;
  for (const match of text.matchAll(pattern)) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    if (extractGoogleDocId(url)) urls.add(url);
  }
  return [...urls];
}

export function normalizeGoogleDocText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
