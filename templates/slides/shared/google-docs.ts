const GOOGLE_DOC_ID_RE = /^[a-zA-Z0-9_-]{20,}$/;
const GOOGLE_SLIDES_ID_RE = /^[a-zA-Z0-9_-]+$/;

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

export function extractGoogleSlidesUrls(text: string): string[] {
  const urls = new Set<string>();
  const pattern =
    /https:\/\/docs\.google\.com\/presentation(?:\/u\/\d+)?\/d\/[^\s<>"'`),\]]+/gi;
  for (const match of text.matchAll(pattern)) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }

    if (!/(\.|^)google\.com$/i.test(parsed.hostname)) continue;

    const presentationMatch = parsed.pathname.match(
      /\/presentation(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/,
    );
    if (presentationMatch && GOOGLE_SLIDES_ID_RE.test(presentationMatch[1])) {
      urls.add(url);
    }
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
