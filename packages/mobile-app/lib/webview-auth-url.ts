export interface MobileWebViewAuthUrlOptions {
  url: string;
  sessionToken?: string | null;
  sessionTokenKey: string;
  parentSessionTokenKey: string;
  workspaceAppId?: string;
  workspaceEmbedState?: "idle" | "loading" | "disabled" | "ready" | "error";
  workspaceEmbedUrl?: string | null;
}

/**
 * Build a WebView URL without ever putting the parent bearer on a workspace
 * app request. Workspace apps receive only their one-time embed URL; a
 * separate target token remains supported for legacy non-workspace surfaces.
 */
export function buildMobileWebViewAuthUrl(
  options: MobileWebViewAuthUrlOptions,
): string {
  const {
    url,
    sessionToken,
    sessionTokenKey,
    parentSessionTokenKey,
    workspaceAppId,
    workspaceEmbedState,
    workspaceEmbedUrl,
  } = options;

  if (workspaceAppId) {
    return workspaceEmbedState === "ready" && workspaceEmbedUrl
      ? workspaceEmbedUrl
      : url;
  }
  if (!sessionToken || sessionTokenKey === parentSessionTokenKey) return url;

  try {
    const parsed = new URL(url);
    parsed.searchParams.set("_session", sessionToken);
    return parsed.toString();
  } catch {
    return url;
  }
}
