
const EMBED_CHROME_QUERY_PARAM = "embedChrome";

function readFromUrl(win: Window): boolean {
  try {
    const value = new URL(win.location.href).searchParams.get(
      EMBED_CHROME_QUERY_PARAM,
    );
    return value === "1" || value === "true";
    // coercion-ok: an unparsable URL cannot be carrying the flag.
  } catch {
    return false;
  }
}

export function isEmbedChromeRequested(): boolean {
  if (typeof window === "undefined") return false;
  return readFromUrl(window);
}
