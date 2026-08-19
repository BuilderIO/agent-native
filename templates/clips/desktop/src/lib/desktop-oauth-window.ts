type OAuthWindow = Pick<Window, "close"> & {
  location: Pick<Location, "href">;
};

type OpenOAuthWindow = (
  url: string,
  target: string,
) => OAuthWindow | null;

/**
 * Open a same-WebView OAuth child before awaiting the auth URL.
 *
 * The parent keeps polling the exchange while the child completes Google
 * OAuth. Using window.open keeps both pages in the Tauri WebView cookie
 * partition; the system-browser shell opener would lose the binding cookie.
 */
export function openBoundOAuthWindow(
  openWindow: OpenOAuthWindow = (url, target) =>
    window.open(url, target) as OAuthWindow | null,
): OAuthWindow {
  const oauthWindow = openWindow("about:blank", "_blank");
  if (!oauthWindow) {
    throw new Error("Could not open the Google sign-in window.");
  }
  return oauthWindow;
}
