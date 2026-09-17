/**
 * Embedded hosts normally supply their own chrome, so the editor hides its
 * rails. A host that frames only the canvas asks for them back with
 * `?embedChrome=1`.
 */

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
  // The editor's URL-state builder preserves unrelated params, including this
  // one. Reading the current URL keeps a same-design host navigation from
  // inheriting a stale canvas-only preference.
  return readFromUrl(window);
}
