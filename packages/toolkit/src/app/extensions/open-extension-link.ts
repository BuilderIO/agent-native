export const EXTENSION_OPEN_URL_MESSAGE = "agent-native-extension-open-url";
export const EXTENSION_OPEN_URL_READY_MESSAGE =
  "agent-native-extension-open-url-ready";

// The extension shell announces a random token with its binding, before any
// extension code runs. Hosts latch it with the binding and only honor
// open-url requests that carry it, so a page the iframe navigated to can't
// use this.
export function readOpenUrlToken(message: unknown): string | null {
  const token = (message as { openUrlToken?: unknown } | null)?.openUrlToken;
  return typeof token === "string" && token.length >= 16 ? token : null;
}

// Tells the shell this host opens links, so it starts routing them here.
export function announceOpenUrlSupport(source: MessageEventSource | null) {
  (source as Window | null)?.postMessage?.(
    { type: EXTENSION_OPEN_URL_READY_MESSAGE },
    "*",
  );
}

// Opens a link on behalf of a sandboxed extension iframe. A tab the iframe
// opened itself would inherit its sandbox (an opaque origin, so apps like
// HubSpot render blank); opening from the host gives a normal tab, and
// noopener keeps that tab from reaching back into the host page.
export function openExtensionLink(
  message: unknown,
  expectedToken: string | null,
): boolean {
  if (!expectedToken || !message || typeof message !== "object") return false;
  const { url, token } = message as { url?: unknown; token?: unknown };
  if (token !== expectedToken || typeof url !== "string") return false;
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
