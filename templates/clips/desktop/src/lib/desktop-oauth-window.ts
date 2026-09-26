type OAuthWindow = Pick<Window, "close"> & {
  location: Pick<Location, "href">;
};

type OpenOAuthWindow = (url: string, target: string) => OAuthWindow | null;

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
