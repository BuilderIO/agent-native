import { isBuilderPreviewUrl } from "@shared/builder-preview-url";
import { useSyncExternalStore } from "react";

const subscribeToBrowserOrigin = () => () => {};
const getBrowserOrigin = () => window.location.origin;
const getServerOrigin = () => null;

export function useBrowserOrigin(): string | null {
  return useSyncExternalStore(
    subscribeToBrowserOrigin,
    getBrowserOrigin,
    getServerOrigin,
  );
}

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
  if (args.registeredBridgeKey !== args.bridgeKey) return null;
  return liveEditEndpointUrl(args.bridgeUrl, args.previewUrl, {
    previewToken: args.previewToken,
    bridgeKey: args.bridgeKey,
  });
}

/**
 * A registration `fetch()` to the localhost bridge can fail for two very
 * different reasons that look identical to page JS (both throw a generic
 * `TypeError: Failed to fetch`, with zero visible network activity):
 *
 * - The dev server / bridge process is genuinely unreachable.
 * - Chrome's Local Network Access permission (a same-origin-policy-adjacent
 *   browser security feature, distinct from CORS) is blocking the request
 *   because this page's origin hasn't been granted permission to reach a
 *   loopback address.
 *
 * `navigator.permissions.query({ name: "local-network-access" })` is a signal,
 * not proof: it reports the SITE's standing permission grant, not why THIS
 * particular fetch failed — a `"prompt"` state is also the default on a first
 * visit regardless of whether the dev server happens to be reachable, so it
 * does not establish that permission was the actual cause. Only `"granted"`
 * is unambiguous (permission is definitely fine, so it's definitely not the
 * cause). Everything else — `"prompt"`, an unsupported browser, or the query
 * throwing — stays in the same "maybePermissionBlocked" bucket, which the UI
 * must present as a possibility to try, never as a diagnosed fact.
 */
export type BridgeRegistrationFailureKind =
  | "maybePermissionBlocked"
  | "unreachable"
  | "stalePreviewToken";

export type LocalNetworkAccessPermissionState =
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported";

export async function getLocalNetworkAccessPermissionState(): Promise<LocalNetworkAccessPermissionState> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return "unsupported";
    }
    const status = await navigator.permissions.query({
      name: "local-network-access" as PermissionName,
    });
    return status.state === "granted" ||
      status.state === "prompt" ||
      status.state === "denied"
      ? status.state
      : "unsupported";
  } catch {
    return "unsupported";
  }
}

export async function classifyBridgeRegistrationFailure(): Promise<BridgeRegistrationFailureKind> {
  return (await getLocalNetworkAccessPermissionState()) === "granted"
    ? "unreachable"
    : "maybePermissionBlocked";
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
    // coercion-ok: malformed preview URLs are not loopback previews.
    return false;
  }
}

function isLoopbackPreviewUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return true;
    }
    const parts = hostname.split(".");
    return (
      parts.length === 4 &&
      parts[0] === "127" &&
      parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
    );
  } catch {
    return false;
  }
}

export function getDesignCanvasIframeAllow(
  previewUrl: string | null | undefined,
): string | undefined {
  return isLoopbackPreviewUrl(previewUrl) ? "local-network-access" : undefined;
}

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
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";
const TRUSTED_EXTERNAL_PREVIEW_IFRAME_SANDBOX = `${EXTERNAL_PREVIEW_IFRAME_SANDBOX} allow-same-origin`;
const EDITABLE_INLINE_IFRAME_SANDBOX =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-same-origin";
const READ_ONLY_INLINE_IFRAME_SANDBOX =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";
const VISUAL_EDIT_SNAPSHOT_IFRAME_SANDBOX = "allow-scripts";

export function isTrustedCrossOriginPreviewUrl(
  previewUrl: string | null | undefined,
  parentOrigin?: string,
): boolean {
  if (
    !previewUrl ||
    isLoopbackPreviewUrl(previewUrl) ||
    !isBuilderPreviewUrl(previewUrl)
  ) {
    return false;
  }

  const effectiveParentOrigin =
    parentOrigin ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!effectiveParentOrigin) return false;

  try {
    return new URL(previewUrl).origin !== new URL(effectiveParentOrigin).origin;
    // coercion-ok: invalid origins are untrusted and cannot grant same-origin access.
  } catch {
    return false;
  }
}

export function getDesignCanvasIframeSandbox(args: {
  externalPreview: boolean;
  readOnly: boolean;
  snapshotOnly?: boolean;
  previewUrl?: string | null;
  parentOrigin?: string;
}): string {
  if (args.snapshotOnly) return VISUAL_EDIT_SNAPSHOT_IFRAME_SANDBOX;
  if (args.externalPreview) {
    return isTrustedCrossOriginPreviewUrl(args.previewUrl, args.parentOrigin)
      ? TRUSTED_EXTERNAL_PREVIEW_IFRAME_SANDBOX
      : EXTERNAL_PREVIEW_IFRAME_SANDBOX;
  }
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

export function isPreviewTokenStaleStatus(status: number): boolean {
  return status === 401;
}
