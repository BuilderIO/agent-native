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

export function mobileWebViewTargetPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
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
