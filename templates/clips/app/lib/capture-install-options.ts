import { appPath } from "@agent-native/core/client";

const DESKTOP_PROMO_DISMISSED_STORAGE_KEY = "clips.desktop-promo.dismissed";
const DESKTOP_DOWNLOADED_STORAGE_KEY = "clips.desktop-app.downloaded";

// Custom scheme the desktop build registers. A web click tries this first and
// falls back to the download page when nothing handles it.
const DESKTOP_APP_PROTOCOL_URL = "clips://open";
const DESKTOP_APP_LAUNCH_FALLBACK_MS = 800;

export function hasDownloadedDesktopApp(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage?.getItem(DESKTOP_DOWNLOADED_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function markDesktopAppDownloaded(): void {
  try {
    // Downloading (or successfully launching) the app also hides the promo.
    window.localStorage?.setItem(DESKTOP_DOWNLOADED_STORAGE_KEY, "1");
    window.localStorage?.setItem(DESKTOP_PROMO_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Download tracking is best-effort and must not block the installer.
  }
}

export function hasDismissedDesktopPromo(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage?.getItem(DESKTOP_PROMO_DISMISSED_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function markDesktopPromoDismissed(): void {
  try {
    window.localStorage?.setItem(DESKTOP_PROMO_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Dismiss tracking is best-effort.
  }
}

/**
 * Try to launch the installed desktop app via its custom protocol, falling back
 * to the download page when nothing handles the scheme. Browsers expose no way
 * to query whether the protocol is registered, so we watch for the tab losing
 * focus (the app taking over) within a short window; if that never happens we
 * assume the app is not installed and navigate to the fallback. A successful
 * launch self-heals the stored "downloaded" flag.
 */
export function attemptOpenDesktopApp(fallbackHref = "/download"): void {
  if (typeof window === "undefined") return;
  const fallbackUrl = appPath(fallbackHref);

  let launched = false;
  const cleanup = () => {
    window.removeEventListener("blur", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  const onLeave = () => {
    if (launched) return;
    launched = true;
    markDesktopAppDownloaded();
    cleanup();
  };
  const onVisibility = () => {
    if (document.hidden) onLeave();
  };

  window.addEventListener("blur", onLeave);
  document.addEventListener("visibilitychange", onVisibility);

  window.setTimeout(() => {
    cleanup();
    if (!launched) window.location.href = fallbackUrl;
  }, DESKTOP_APP_LAUNCH_FALLBACK_MS);

  try {
    window.location.href = DESKTOP_APP_PROTOCOL_URL;
  } catch {
    // Some browsers throw on an unknown scheme; the timeout handles fallback.
  }
}

function isFalsy(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function normalizeHostname(hostname: string | undefined): string {
  return (hostname ?? "").trim().toLowerCase();
}

export function supportsPublishedClipsChromeExtensionHost(
  hostname: string | undefined,
): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "clips.agent-native.com" ||
    normalized === "localhost" ||
    normalized === "127.0.0.1"
  );
}

export function resolveClipsChromeExtensionEnabled({
  enabledSetting,
  hostname,
}: {
  enabledSetting?: string;
  hostname?: string;
}): boolean {
  const normalizedSetting = enabledSetting?.trim();
  if (normalizedSetting) return !isFalsy(normalizedSetting);
  return supportsPublishedClipsChromeExtensionHost(hostname);
}

function getCurrentHostname(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

const chromeExtensionUrl =
  import.meta.env.VITE_CLIPS_CHROME_EXTENSION_URL?.trim() ??
  "https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn";

// The published extension manifest only trusts first-party Clips/local origins.
// Custom deployments can opt in after publishing a matching extension/listing.
export const clipsChromeExtensionEnabled = resolveClipsChromeExtensionEnabled({
  enabledSetting: import.meta.env.VITE_CLIPS_CHROME_EXTENSION_ENABLED,
  hostname: getCurrentHostname(),
});

export const clipsChromeExtensionUrl = chromeExtensionUrl || null;
