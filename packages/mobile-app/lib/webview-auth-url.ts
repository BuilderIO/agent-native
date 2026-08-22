export interface MobileWebViewAuthUrlOptions {
  url: string;
  workspaceAppId?: string;
  workspaceEmbedState?:
    | "idle"
    | "loading"
    | "disabled"
    | "ready"
    | "reused"
    | "error";
  workspaceEmbedUrl?: string | null;
}

function removeLegacySessionParam(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("_session")) return url;
    parsed.searchParams.delete("_session");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * The native shell owns the parent credential. A WebView may only capture a
 * session into a distinct app-scoped key, never back into that shared key.
 */
export function canCaptureMobileWebViewSession(options: {
  enabled: boolean;
  sessionTokenKey: string;
  parentSessionTokenKey: string;
}): boolean {
  return (
    options.enabled && options.sessionTokenKey !== options.parentSessionTokenKey
  );
}

/**
 * Build a WebView URL without putting any reusable session token in a URL.
 * Workspace apps receive only their one-time embed URL; non-workspace apps
 * remain on their ordinary app-owned login path.
 *
 * `"reused"` deliberately resolves to the plain app URL: the embed session is
 * already in the shared cookie store, so the app opens at its CDN-cached shell
 * instead of redeeming another one-time ticket.
 */
export function buildMobileWebViewAuthUrl(
  options: MobileWebViewAuthUrlOptions,
): string {
  const { url, workspaceAppId, workspaceEmbedState, workspaceEmbedUrl } =
    options;
  const safeUrl = removeLegacySessionParam(url);

  if (workspaceAppId) {
    return workspaceEmbedState === "ready" && workspaceEmbedUrl
      ? workspaceEmbedUrl
      : safeUrl;
  }
  return safeUrl;
}

/**
 * Decide which URL a mounted WebView should actually be showing.
 *
 * A WebView that already holds a document must never be renavigated because
 * the workspace handshake restarted: while it is in flight the URL builder
 * falls back to the plain app URL, and handing that to a live WebView throws
 * away everything the user had open. Only a settled handshake may replace the
 * loaded document.
 */
export function resolveStickyWebViewUrl(options: {
  requestedUrl: string;
  loadedUrl: string | null;
  workspaceHandshakeInFlight: boolean;
}): string {
  if (options.loadedUrl && options.workspaceHandshakeInFlight) {
    return options.loadedUrl;
  }
  return options.requestedUrl;
}
