export function liveEditEndpointUrl(
  bridgeUrl: string,
  previewUrl: string,
  options: {
    previewToken: string;
    includeEditorBridge?: boolean;
    bridgeKey?: string;
  },
): string {
  const endpoint = new URL("/live-edit", bridgeUrl);
  endpoint.searchParams.set("url", previewUrl);
  endpoint.searchParams.set("previewToken", options.previewToken);
  if (options?.includeEditorBridge === false) {
    endpoint.searchParams.set("bridge", "0");
  } else if (options?.bridgeKey) {
    endpoint.searchParams.set("bridgeKey", options.bridgeKey);
  }
  return endpoint.toString();
}

export function resolveLiveEditPreviewUrl(args: {
  sourceType: string | undefined;
  bridgeUrl: string | undefined;
  previewToken: string | undefined;
  previewUrl: string | null | undefined;
  bridgeKey: string;
  registeredBridgeKey: string | null;
}): string | null {
  if (
    args.sourceType !== "localhost" ||
    !args.bridgeUrl ||
    !args.previewToken ||
    !args.previewUrl
  ) {
    return null;
  }
  // Every localhost mode registers a keyed injected script before rendering:
  // editable modes include editor chrome, while Interact/read-only modes use
  // the gesture-only bridge. Waiting for the matching key prevents a raw URL
  // load followed by a second proxied load (the flash/state-loss regression).
  if (args.registeredBridgeKey !== args.bridgeKey) return null;
  return liveEditEndpointUrl(args.bridgeUrl, args.previewUrl, {
    previewToken: args.previewToken,
    bridgeKey: args.bridgeKey,
  });
}

export function shouldUseIframeLoadReadyFallback(
  usesLiveEditEditorBridge: boolean,
): boolean {
  return !usesLiveEditEditorBridge;
}

export function shouldFetchExternalSourceSnapshot(args: {
  sourceType: string | undefined;
  bridgeUrl: string | undefined;
  previewToken: string | undefined;
  previewUrl: string | null | undefined;
  hasSnapshotConsumer: boolean;
}): boolean {
  return Boolean(
    args.sourceType === "localhost" &&
    args.bridgeUrl &&
    args.previewToken &&
    args.previewUrl &&
    args.hasSnapshotConsumer,
  );
}

const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SCRIPT_SRC_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function isKnownDevRuntimeScriptSource(value: string): boolean {
  try {
    const parsed = new URL(value, "http://localhost");
    return (
      parsed.pathname === "/@vite/client" ||
      parsed.pathname === "/@react-refresh" ||
      parsed.pathname.includes("/__x00__react-refresh")
    );
  } catch {
    return false;
  }
}

/**
 * Remove development-server HTML transforms before treating a live snapshot as
 * writable source. Vite injects its HMR client and React Refresh preamble into
 * the served document; persisting either back to index.html corrupts the real
 * source and can duplicate refresh runtimes on every Apply-to-source cycle.
 * User-authored module scripts and inline application scripts are preserved.
 */
export function sanitizeLocalhostSourceSnapshotHtml(html: string): string {
  return html.replace(
    SCRIPT_TAG_RE,
    (fullScript, rawAttributes: string, inlineBody: string) => {
      const srcMatch = rawAttributes.match(SCRIPT_SRC_RE);
      const src = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? "";
      if (src && isKnownDevRuntimeScriptSource(src)) return "";

      const knownRefreshPreamble =
        inlineBody.includes("/@react-refresh") ||
        inlineBody.includes("RefreshRuntime.injectIntoGlobalHook") ||
        inlineBody.includes("__vite_plugin_react_preamble_installed__");
      const knownViteClientInjection =
        inlineBody.includes("/@vite/client") &&
        (inlineBody.includes("import") || inlineBody.includes("__vite"));
      return knownRefreshPreamble || knownViteClientInjection ? "" : fullScript;
    },
  );
}

const EXTERNAL_PREVIEW_IFRAME_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin";
const EDITABLE_INLINE_IFRAME_SANDBOX =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin";
const READ_ONLY_INLINE_IFRAME_SANDBOX =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox";

export function getDesignCanvasIframeSandbox(args: {
  externalPreview: boolean;
  readOnly: boolean;
}): string {
  if (args.externalPreview) return EXTERNAL_PREVIEW_IFRAME_SANDBOX;
  return args.readOnly
    ? READ_ONLY_INLINE_IFRAME_SANDBOX
    : EDITABLE_INLINE_IFRAME_SANDBOX;
}

const SNAPSHOT_RETRY_BASE_DELAY_MS = 1500;
const SNAPSHOT_RETRY_MAX_DELAY_MS = 15000;

export function getSnapshotRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, attempt) : 0;
  const delay = SNAPSHOT_RETRY_BASE_DELAY_MS * 2 ** safeAttempt;
  return Math.min(SNAPSHOT_RETRY_MAX_DELAY_MS, delay);
}
