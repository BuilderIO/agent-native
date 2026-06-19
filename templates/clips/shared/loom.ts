const LOOM_HOST_RE = /(^|\.)loom\.com$/i;
const LOOM_VIDEO_ID_RE = /^[A-Za-z0-9_-]{8,120}$/;
const LOOM_VIDEO_PATHS = new Set(["share", "embed"]);

function parsePublicUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!LOOM_HOST_RE.test(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeHost(parsed: URL): void {
  parsed.protocol = "https:";
  parsed.hostname = "www.loom.com";
  parsed.hash = "";
}

export function extractLoomVideoId(value: string): string | null {
  const parsed = parsePublicUrl(value);
  if (!parsed) return null;

  const [kind, rawId] = parsed.pathname.split("/").filter(Boolean);
  if (!kind || !LOOM_VIDEO_PATHS.has(kind)) return null;
  if (!rawId || !LOOM_VIDEO_ID_RE.test(rawId)) return null;
  return rawId;
}

export function normalizeLoomShareUrl(value: string): string | null {
  const parsed = parsePublicUrl(value);
  const id = extractLoomVideoId(value);
  if (!parsed || !id) return null;

  normalizeHost(parsed);
  parsed.pathname = `/share/${id}`;

  const sid = parsed.searchParams.get("sid");
  parsed.search = "";
  if (sid) parsed.searchParams.set("sid", sid);

  return parsed.href;
}

export function sanitizeLoomEmbedUrl(value: string): string | null {
  const parsed = parsePublicUrl(value);
  const id = extractLoomVideoId(value);
  if (!parsed || !id) return null;

  const [kind] = parsed.pathname.split("/").filter(Boolean);
  if (kind !== "embed") return null;

  normalizeHost(parsed);
  parsed.pathname = `/embed/${id}`;
  return parsed.href;
}

export function isLoomEmbedUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && Boolean(sanitizeLoomEmbedUrl(value));
}

export function loomEmbedUrlForId(id: string): string {
  return `https://www.loom.com/embed/${encodeURIComponent(id)}`;
}

export function extractLoomEmbedUrlFromHtml(html: string): string | null {
  const match = html.match(
    /<iframe\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
  );
  const raw = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  if (!raw) return null;

  return sanitizeLoomEmbedUrl(raw.replace(/&amp;/g, "&"));
}
