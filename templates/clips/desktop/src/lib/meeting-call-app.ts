const NATIVE_CALL_APP_BUNDLE_IDS = [
  "us.zoom.xos",
  "us.zoom.ZoomClips",
  "com.microsoft.teams2",
  "com.microsoft.teams",
] as const;

const BROWSER_CALL_APP_BUNDLE_IDS = [
  "com.google.Chrome",
  "company.thebrowser.Browser",
  "com.apple.Safari",
  "org.mozilla.firefox",
] as const;

function isHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

export function callAppBundleIdsForJoinUrl(
  joinUrl?: string | null,
  platform?: string | null,
  browserBundleId?: string | null,
): string[] {
  const exactBrowserBundleId = BROWSER_CALL_APP_BUNDLE_IDS.find(
    (bundleId) => bundleId.toLowerCase() === browserBundleId?.toLowerCase(),
  );
  if (exactBrowserBundleId) return [exactBrowserBundleId];

  const normalizedPlatform = platform?.toLowerCase();
  if (!joinUrl) {
    if (normalizedPlatform === "meet" || normalizedPlatform === "webex") {
      return [...BROWSER_CALL_APP_BUNDLE_IDS];
    }
    if (normalizedPlatform === "zoom" || normalizedPlatform === "teams") {
      return [...NATIVE_CALL_APP_BUNDLE_IDS, ...BROWSER_CALL_APP_BUNDLE_IDS];
    }
    return [...NATIVE_CALL_APP_BUNDLE_IDS];
  }

  if (URL.canParse(joinUrl)) {
    const hostname = new URL(joinUrl).hostname.toLowerCase();
    if (isHost(hostname, "meet.google.com")) {
      return [...BROWSER_CALL_APP_BUNDLE_IDS];
    }
    if (
      isHost(hostname, "teams.microsoft.com") ||
      isHost(hostname, "zoom.us") ||
      isHost(hostname, "zoom.com") ||
      isHost(hostname, "zoomgov.com")
    ) {
      return [...NATIVE_CALL_APP_BUNDLE_IDS, ...BROWSER_CALL_APP_BUNDLE_IDS];
    }
    if (isHost(hostname, "webex.com") || isHost(hostname, "webex.us")) {
      return [...BROWSER_CALL_APP_BUNDLE_IDS];
    }
  }

  if (normalizedPlatform === "meet" || normalizedPlatform === "webex") {
    return [...BROWSER_CALL_APP_BUNDLE_IDS];
  }
  if (normalizedPlatform === "zoom" || normalizedPlatform === "teams") {
    return [...NATIVE_CALL_APP_BUNDLE_IDS, ...BROWSER_CALL_APP_BUNDLE_IDS];
  }

  return [...NATIVE_CALL_APP_BUNDLE_IDS];
}
