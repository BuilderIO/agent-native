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
  /**
   * Our own provider-API quota governor is cooling down, not Figma. Kept
   * separate because the remedy is "wait", never "upgrade your Figma plan".
   */
  providerQuotaCooldown: "figma_provider_quota_cooldown",
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
  providerQuotaRetryAfterSeconds?: number | null;
}): never {
  const { label, detail, status, rateLimit } = options;
  if (options.providerQuotaRetryAfterSeconds !== undefined) {
    const retryAfterSeconds = options.providerQuotaRetryAfterSeconds;
    failFigmaImport(
      "Design is pacing its own Figma requests after hitting a quota limit. Wait for the cooldown and import again.",
      FIGMA_IMPORT_ERROR_CODES.providerQuotaCooldown,
      {
        statusCode: 429,
        details: {
          ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
        },
      },
    );
  }
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
 * Retry delay when this 429 came from our own provider-API quota governor
 * rather than from Figma, or `undefined` when it did not.
 *
 * `providerQuotaExhaustedResponse` in `@agent-native/core/provider-api`
 * synthesizes a 429 envelope for its cooldown, carrying this header and
 * `json.error`. Reading only the status told the user Figma had rate-limited
 * them and offered a Figma plan upgrade for an app-side wait.
 */
function providerQuotaRetryAfterSeconds(
  response: NonNullable<FigmaProviderEnvelope["response"]>,
): number | null | undefined {
  const isProviderQuota =
    response.headers?.["x-agent-native-provider-quota"] === "exhausted" ||
    (response.json as { error?: unknown } | null)?.error ===
      "provider_quota_exhausted";
  if (!isProviderQuota) return undefined;
  const retryAfter = Number.parseInt(
    response.headers?.["retry-after"] ?? "",
    10,
  );
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
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
    const providerQuota = providerQuotaRetryAfterSeconds(response);
    failFigmaRequest({
      label,
      detail,
      status: response.status,
      ...(providerQuota === undefined
        ? {}
        : { providerQuotaRetryAfterSeconds: providerQuota }),
      rateLimit:
        response.status === 429
          ? figmaRateLimitDetails(response.headers)
          : undefined,
    });
  }
  // A 2xx whose body is null, a primitive, or an array is not the document
  // shape any caller here reads. Returned unchanged it became a bare
  // TypeError one frame later ("cannot read properties of null"), which is
  // the same opaque 500 this module exists to remove.
  if (
    !response.json ||
    typeof response.json !== "object" ||
    Array.isArray(response.json)
  ) {
    failFigmaImport(
      `Figma ${label} response was not in the expected format.`,
      FIGMA_IMPORT_ERROR_CODES.requestFailed,
      { statusCode: 502 },
    );
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

/**
 * Recognize the provider runtime's "no credential available" failures.
 *
 * These are raised before any HTTP envelope exists, so they never reach
 * `readFigmaProviderJson`: a Figma import with no resolvable token escaped as
 * a bare `Error` and became the same opaque 500 this module removes. That
 * matters most for the reported case, where the connection badge reads
 * "Figma connected" from `resolveSecret` while the provider runtime resolves
 * through a credential context that may not see the same secret.
 *
 * Core raises these untyped, so recognition is by message. `figma-credential-
 * failure.spec.ts` drives the real `createProviderApiRuntime` to pin both
 * shapes — if core rewords them, that spec fails instead of this quietly
 * degrading back to a 500.
 */
export function isProviderCredentialFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (isFigmaImportFailure(err)) return false;
  return (
    /\bcredential not configured\b/i.test(err.message) ||
    /\bnot configured\b.*\bcredential\b/i.test(err.message) ||
    /^Cannot resolve credential\b/i.test(err.message) ||
    /\brequire an authenticated request context\b/i.test(err.message) ||
    /^[A-Z0-9_]+ not configured\b/.test(err.message)
  );
}

/**
 * Re-raise a provider request failure as a Figma diagnosis when it is one,
 * and leave anything unexpected untouched so it still reports as a real bug.
 */
export function rethrowFigmaProviderFailure(err: unknown): never {
  if (isProviderCredentialFailure(err)) {
    // The message names credential keys and scope gaps, not secret values,
    // but it is internal wiring detail: give the user the action instead.
    console.error(
      "[figma-import] Figma credential could not be resolved:",
      err,
    );
    failFigmaImport(
      "No Figma access token is available for this session. Add a Figma personal access token in Settings, then import again.",
      FIGMA_IMPORT_ERROR_CODES.authRequired,
      { statusCode: 401 },
    );
  }
  throw err;
}
