(function clipsDiagnosticHistoryBridge() {
  const installedFlag = "__clipsDiagnosticHistoryBridgeInstalled";
  const page = window as unknown as Record<string, unknown>;
  if (page[installedFlag]) return;
  page[installedFlag] = true;

  const notify = (): void => {
    window.postMessage(
      {
        source: "clips-diagnostic-history",
        kind: "navigation",
        url: window.location.href,
      },
      "*",
    );
  };
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function patchedPushState(
    this: History,
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    const result = originalPushState.call(this, state, unused, url);
    notify();
    return result;
  };
  history.replaceState = function patchedReplaceState(
    this: History,
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    const result = originalReplaceState.call(this, state, unused, url);
    notify();
    return result;
  };
})();
