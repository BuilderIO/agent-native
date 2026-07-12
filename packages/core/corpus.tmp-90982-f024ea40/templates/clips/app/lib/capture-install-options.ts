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
