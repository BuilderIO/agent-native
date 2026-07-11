const MAC_SYSTEM_PREFERENCES_PROTOCOL = "x-apple.systempreferences:";
const MAC_PRIVACY_PANE = "com.apple.preference.security";
const ALLOWED_MAC_PRIVACY_SETTINGS = new Set([
  "Privacy_Accessibility",
  "Privacy_ScreenCapture",
  "Privacy_Camera",
  "Privacy_Microphone",
]);

export function isAllowedMacPrivacySettingsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === MAC_SYSTEM_PREFERENCES_PROTOCOL &&
      parsed.pathname === MAC_PRIVACY_PANE &&
      ALLOWED_MAC_PRIVACY_SETTINGS.has(parsed.search.slice(1)) &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

export function canOpenDesktopExternalUrl(
  url: string,
  platform: string,
): boolean {
  try {
    const protocol = new URL(url).protocol;
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:" ||
      protocol === "tel:" ||
      (platform === "darwin" && isAllowedMacPrivacySettingsUrl(url))
    );
  } catch {
    return false;
  }
}
