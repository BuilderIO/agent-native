function getUrlOrigin(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  return new URL(url).origin;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function isTrustedBuilderConnectUrl(
  url: URL,
  sourceUrl?: string,
): boolean {
  if (!url.pathname.endsWith("/_agent-native/builder/connect")) return false;
  if (isLoopbackHostname(url.hostname)) return true;
  return getUrlOrigin(sourceUrl) === url.origin;
}

/**
 * Keep the OAuth callback in the cookie session that bootstrapped the flow.
 *
 * Desktop OAuth state is bound to an HttpOnly cookie created by the bootstrap
 * request. Passing the source session through this seam makes it explicit that
 * the callback window must use the same cookie partition rather than the
 * system browser's unrelated session.
 */
export function routeOAuthToBoundSession<TSession>(
  url: string,
  bootstrapSession: TSession | undefined,
  openOAuthWindow: (url: string, callbackSession: TSession | undefined) => void,
): void {
  openOAuthWindow(url, bootstrapSession);
}
