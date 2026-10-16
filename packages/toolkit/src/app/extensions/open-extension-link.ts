import { useLayoutEffect, useMemo, useRef } from "react";

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

// Binds link opening to one document the host loaded into an extension
// iframe. The binding latch alone isn't enough: it also resets on re-renders
// that keep the document, and by then the iframe may have navigated to
// another page that would latch its own token. Pair it with
// useOpenUrlLatchDocument so it resets only when the frame's document does.
export function useOpenUrlLatch() {
  const latchedRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  return useMemo(
    () => ({
      // Call with every binding message; only the document's first one counts.
      latch(
        message: unknown,
        source: MessageEventSource | null,
        enabled = true,
      ) {
        if (latchedRef.current) return;
        latchedRef.current = true;
        tokenRef.current = enabled ? readOpenUrlToken(message) : null;
        if (tokenRef.current) announceOpenUrlSupport(source);
      },
      open(message: unknown) {
        return openExtensionLink(message, tokenRef.current);
      },
      reset() {
        latchedRef.current = false;
        tokenRef.current = null;
      },
    }),
    [],
  );
}

let frameDocuments = 0;

// Returns a key to put in the iframe's `key`, and resets the latch, whenever
// `documentIdentity` (whatever determines the frame's document: its src,
// srcdoc or key) changes. The frame's window outlives its documents, so
// event.source alone can't tell a message from the previous document, or
// from a page it navigated to, from the new document's. A new element is a
// new window, so those messages fail the hosts' event.source check instead.
export function useOpenUrlLatchDocument(
  openUrl: ReturnType<typeof useOpenUrlLatch>,
  documentIdentity: string,
): string {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new document is what makes a new key
  const frameKey = useMemo(() => `doc-${++frameDocuments}`, [documentIdentity]);
  useLayoutEffect(() => {
    openUrl.reset();
  }, [openUrl, frameKey]);
  return frameKey;
}
