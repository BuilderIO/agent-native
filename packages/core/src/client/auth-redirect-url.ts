import { AUTH_REDIRECT_QUERY_PARAM } from "../shared/auth-redirect-url.js";

function browserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function stripAuthRedirectParamFromUrl(win = browserWindow()): void {
  if (!win) return;

  try {
    const url = new URL(win.location.href);
    if (!url.searchParams.has(AUTH_REDIRECT_QUERY_PARAM)) return;

    url.searchParams.delete(AUTH_REDIRECT_QUERY_PARAM);
    win.history.replaceState(
      win.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // Cosmetic cleanup only; never block app boot if history/location is odd.
  }
}
