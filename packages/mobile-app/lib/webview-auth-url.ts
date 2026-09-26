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

export function resolveStickyWebViewUrl(options: {
  requestedUrl: string;
  loaded: { owner: string | null; url: string } | null;
  owner: string | null;
  workspaceHandshakeInFlight: boolean;
}): string {
  const mine = options.loaded && options.loaded.owner === options.owner;
  if (mine && options.workspaceHandshakeInFlight) {
    return options.loaded!.url;
  }
  return options.requestedUrl;
}
