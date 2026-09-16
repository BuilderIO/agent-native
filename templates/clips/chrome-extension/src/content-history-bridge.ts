(function clipsDiagnosticHistoryBridge() {
  const installedFlag = "__clipsDiagnosticHistoryBridgeInstalled";
  const page = window as unknown as Record<string, unknown>;
  if (page[installedFlag]) return;
  page[installedFlag] = true;
  const createToken = (): string => {
    const webCrypto = globalThis.crypto;
    if (typeof webCrypto?.randomUUID === "function") {
      return webCrypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    let filled = false;
    try {
      if (typeof webCrypto?.getRandomValues === "function") {
        webCrypto.getRandomValues(bytes);
        filled = true;
      }
      // coercion-ok: insecure pages may reject Web Crypto; the fallback still creates a nonce.
    } catch {}
    if (!filled) {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const token = createToken();

  const notify = (): void => {
    window.postMessage(
      {
        source: "clips-diagnostic-history",
        kind: "navigation",
        token,
        url: window.location.href,
      },
      "*",
    );
  };
  window.addEventListener("message", (event) => {
    const data = event.data as { source?: unknown; kind?: unknown } | undefined;
    if (
      event.source === window &&
      data?.source === "clips-diagnostic-history" &&
      data.kind === "request-token"
    ) {
      window.postMessage(
        { source: "clips-diagnostic-history", kind: "token", token },
        "*",
      );
    }
  });
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
