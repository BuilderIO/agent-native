export interface MobileWebViewAuthUrlOptions {
  url: string;
  workspaceAppId?: string;
  workspaceEmbedState?: "idle" | "loading" | "disabled" | "ready" | "error";
  workspaceEmbedUrl?: string | null;
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
 */
export function buildMobileWebViewAuthUrl(
  options: MobileWebViewAuthUrlOptions,
): string {
  const { url, workspaceAppId, workspaceEmbedState, workspaceEmbedUrl } =
    options;

  if (workspaceAppId) {
    return workspaceEmbedState === "ready" && workspaceEmbedUrl
      ? workspaceEmbedUrl
      : url;
  }
  return url;
}
