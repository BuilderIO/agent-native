export const EXTENSION_OPEN_URL_MESSAGE = "agent-native-extension-open-url";
export const EXTENSION_OPEN_URL_READY_MESSAGE =
  "agent-native-extension-open-url-ready";

const OPEN_URL_TOKEN_RE = /^[0-9a-f]{32}$/;

// The extension shell announces a random token with its binding, before any
// extension code runs. Hosts latch it with the binding and only honor
// open-url requests that carry it, so a page the iframe navigated to can't
// use this. A binding without a valid token means the shell can't route
// links, so the host doesn't offer to.
export function readOpenUrlToken(message: unknown): string | null {
  const token = (message as { openUrlToken?: unknown } | null)?.openUrlToken;
  return typeof token === "string" && OPEN_URL_TOKEN_RE.test(token)
    ? token
    : null;
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
  const { url, token } = (message ?? {}) as { url?: unknown; token?: unknown };
  if (!expectedToken || token !== expectedToken) {
    console.warn(
      "[extensions] Ignored an open-url request without this frame's token.",
    );
    return false;
  }
  const parsed =
    typeof url === "string" && URL.canParse(url) ? new URL(url) : null;
  if (
    !parsed ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    console.warn("[extensions] Ignored an open-url request for a non-web URL.");
    return false;
  }
  window.open(parsed.href, "_blank", "noopener,noreferrer");
  return true;
}
