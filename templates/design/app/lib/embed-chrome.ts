/**
 * Embedded hosts normally supply their own chrome, so the editor hides its
 * rails. A host that frames only the canvas asks for them back with
 * `?embedChrome=1`.
 */

const EMBED_CHROME_QUERY_PARAM = "embedChrome";

const STORAGE_KEY = "agent-native:embed-chrome";

let requested: boolean | null = null;

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

/**
 * Sticky once seen: the editor rewrites its own URL on the first navigation,
 * which would otherwise drop the flag and strip the rails mid-session.
 */
export function isEmbedChromeRequested(): boolean {
  if (typeof window === "undefined") return false;
  if (requested !== null) return requested;
  if (readFromUrl(window)) {
    requested = true;
    try {
      window.sessionStorage?.setItem(STORAGE_KEY, "1");
    } catch {
      // coercion-ok: sandboxed hosts refuse session storage; the module-level
      // value still covers the single-page boot path.
    }
    return true;
  }
  try {
    requested = window.sessionStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    requested = false;
  }
  return requested;
}

export function _resetEmbedChromeForTests(): void {
  requested = null;
}
