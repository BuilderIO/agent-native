export const EXTENSION_OPEN_URL_MESSAGE = "agent-native-extension-open-url";

// Opens a link on behalf of a sandboxed extension iframe. A tab the iframe
// opened itself would inherit its sandbox (an opaque origin, so apps like
// HubSpot render blank); opening from the host gives a normal tab, and
// noopener keeps that tab from reaching back into the host page.
export function openExtensionLink(url: unknown): boolean {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  window.open(parsed.href, "_blank", "noopener,noreferrer");
  return true;
}
