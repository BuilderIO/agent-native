export type WebviewNavigationHandler = (
  event: Electron.Event,
  url: string,
  options: { isMainFrame: boolean },
) => void;

export function installWebviewNavigationListeners(
  contents: Electron.WebContents,
  handleNavigation: WebviewNavigationHandler,
) {
  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    handleNavigation(event, event.url, { isMainFrame: false });
  });

  contents.on("will-navigate", (event, url) => {
    handleNavigation(event, url || event.url, { isMainFrame: true });
  });

  contents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    handleNavigation(event, url, { isMainFrame });
  });
}
