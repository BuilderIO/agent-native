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
