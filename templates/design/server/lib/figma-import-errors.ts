/**
 * Figma import/read failures the user is meant to read.
 *
 * `throw new Error(...)` does not survive the action HTTP transport: there it
 * is indistinguishable from a driver or upstream blowup, so it is replaced by
 * a generic 500 `"Internal server error"` and only `fail()` declares the text
 * safe to echo (see `packages/core/src/action.ts`). Every Figma entry point
 * raised its diagnosis as a bare `Error`, so an expired token, a frame the
 * token cannot read, an oversized payload, a missing storage provider and a
 * genuine crash all reached the import panel as the same opaque toast — while
 * the specs asserted on messages no user could ever see.
 *
 * Raise through these helpers instead. Each carries a stable `errorCode` the
 * UI can branch on and `details` the transport preserves, so adding a new
 * diagnosis here cannot regress into an opaque 500.
 */

import { fail, type FailOptions } from "@agent-native/core/action";

export const FIGMA_IMPORT_ERROR_CODES = {
  /** URL/file key/node id the caller supplied cannot be parsed. */
  urlInvalid: "figma_url_invalid",
  /** No usable Figma credential or no authenticated request context. */
  authRequired: "figma_auth_required",
  /** Figma answered, but not with success. */
  requestFailed: "figma_request_failed",
  /** Figma rate limit; `details` carries retry/plan hints. */
  rateLimited: "figma_rate_limited",
  /** The requested node is absent from the file the token can see. */
  nodeNotFound: "figma_node_not_found",
  /** The frame or its assets exceed an import budget. */
  payloadTooLarge: "figma_payload_too_large",
  /** A render/image asset could not be fetched or is not an image. */
  assetUnavailable: "figma_asset_unavailable",
  /** Durable file storage is not configured, so assets cannot be kept. */
  storageUnavailable: "figma_storage_unavailable",
  /** A clipboard paste carried no exact node ids and no matchable text. */
  clipboardUnmatched: "figma_clipboard_unmatched",
  /** No design/file to import into. */
  targetInvalid: "figma_import_target_invalid",
  /** A requested option this import path does not implement. */
  unsupportedOption: "figma_unsupported_option",
} as const;

export type FigmaImportErrorCode =
  (typeof FIGMA_IMPORT_ERROR_CODES)[keyof typeof FIGMA_IMPORT_ERROR_CODES];

interface FigmaImportFailureOptions {
  statusCode?: number;
  details?: Record<string, unknown>;
}

/** Abort a Figma import/read with a message the user is meant to act on. */
export function failFigmaImport(
  message: string,
  code: FigmaImportErrorCode,
  options: FigmaImportFailureOptions = {},
): never {
  const failOptions: FailOptions = {
    errorCode: code,
    statusCode: options.statusCode ?? 400,
  };
  if (options.details !== undefined) failOptions.details = options.details;
  fail(message, failOptions);
}

export interface FigmaRateLimitDetails {
  retryAfterSeconds?: number;
  planTier?: string;
  rateLimitType?: "low" | "high";
  upgradeUrl?: string;
}

/**
 * Status to report for an upstream Figma failure. A 4xx is the user's to act
 * on and is mirrored as-is; anything else is Figma being unwell, which is a
 * gateway failure a retry can plausibly clear.
 */
function figmaUpstreamStatusCode(status: number | undefined): number {
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : 502;
}

/** Abort because Figma answered with an error status. */
export function failFigmaRequest(options: {
  label: string;
  detail: string;
  status?: number;
  rateLimit?: FigmaRateLimitDetails;
}): never {
  const { label, detail, status, rateLimit } = options;
  if (status === 429) {
    const details: Record<string, unknown> = { figmaStatus: 429 };
    if (rateLimit?.retryAfterSeconds !== undefined) {
      details.retryAfterSeconds = rateLimit.retryAfterSeconds;
    }
    if (rateLimit?.planTier) details.planTier = rateLimit.planTier;
    if (rateLimit?.rateLimitType) {
      details.rateLimitType = rateLimit.rateLimitType;
    }
    if (rateLimit?.upgradeUrl) details.upgradeUrl = rateLimit.upgradeUrl;
    failFigmaImport(
      `Figma ${label} request failed: ${detail}`,
      FIGMA_IMPORT_ERROR_CODES.rateLimited,
      { statusCode: 429, details },
    );
  }
  failFigmaImport(
    `Figma ${label} request failed: ${detail}`,
    FIGMA_IMPORT_ERROR_CODES.requestFailed,
    {
      statusCode: figmaUpstreamStatusCode(status),
      ...(typeof status === "number"
        ? { details: { figmaStatus: status } }
        : {}),
    },
  );
}

interface FigmaProviderEnvelope {
  response?: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    json?: unknown;
    text?: string;
    truncated?: boolean;
    size?: number;
  };
}

const FIGMA_PLAN_TIERS = new Set([
  "enterprise",
  "org",
  "pro",
  "starter",
  "student",
]);

function figmaUpgradeUrl(value: string | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  const isFigmaHttps =
    url.protocol === "https:" &&
    (url.hostname === "figma.com" || url.hostname.endsWith(".figma.com"));
  return isFigmaHttps ? value : undefined;
}

function figmaRateLimitDetails(
  headers: Record<string, string> | undefined,
): FigmaRateLimitDetails {
  const details: FigmaRateLimitDetails = {};

  // Retry-After may also be an HTTP-date, which parseInt turns into NaN. A NaN
  // countdown renders as "NaN min", so only a real delay is carried.
  const retryAfter = Number.parseInt(headers?.["retry-after"] ?? "", 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    details.retryAfterSeconds = retryAfter;
  }

  const planTier = headers?.["x-figma-plan-tier"];
  if (planTier && FIGMA_PLAN_TIERS.has(planTier)) details.planTier = planTier;

  const rateLimitType = headers?.["x-figma-rate-limit-type"];
  if (rateLimitType === "low" || rateLimitType === "high") {
    details.rateLimitType = rateLimitType;
  }

  const upgradeUrl = figmaUpgradeUrl(headers?.["x-figma-upgrade-link"]);
  if (upgradeUrl) details.upgradeUrl = upgradeUrl;

  return details;
}

/**
 * Unwrap a provider-API envelope into Figma's JSON body, or raise the reason
 * it cannot be. Three Figma entry points each carried their own copy of this
 * reader and two of them never checked `truncated`, so a response the provider
 * had cut short was parsed as if it were whole.
 */
export function readFigmaProviderJson(
  envelope: unknown,
  label: string,
): unknown {
  const response = (envelope as FigmaProviderEnvelope | null)?.response;
  if (!response) {
    failFigmaImport(
      `Figma ${label} response was empty.`,
      FIGMA_IMPORT_ERROR_CODES.requestFailed,
      { statusCode: 502 },
    );
  }
  if (response.truncated) {
    failFigmaImport(
      `Figma ${label} response exceeded the safe import size limit${response.size ? ` (${response.size} bytes)` : ""}. Import a smaller frame or selection.`,
      FIGMA_IMPORT_ERROR_CODES.payloadTooLarge,
      { statusCode: 413 },
    );
  }
  if (response.ok === false) {
    const jsonBody = response.json as { message?: string } | null;
    const detail =
      (typeof response.text === "string" && response.text.trim()) ||
      (typeof jsonBody?.message === "string" && jsonBody.message) ||
      response.statusText ||
      `HTTP ${response.status ?? "error"}`;
    failFigmaRequest({
      label,
      detail,
      status: response.status,
      rateLimit:
        response.status === 429
          ? figmaRateLimitDetails(response.headers)
          : undefined,
    });
  }
  return response.json;
}

/** True when a failure means the payload was too big for this import path. */
export function isFigmaPayloadTooLargeError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { errorCode?: unknown }).errorCode ===
      FIGMA_IMPORT_ERROR_CODES.payloadTooLarge
  );
}

/** True when a failure already carries its own user-facing Figma diagnosis. */
export function isFigmaImportFailure(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    typeof (err as { errorCode?: unknown }).errorCode === "string" &&
    (err as { errorCode: string }).errorCode.startsWith("figma_")
  );
}
