import { ProviderAuthenticationError } from "./provider-auth-error.js";
import { PROVIDER_ENV_META } from "./provider-env-vars.js";
import { EngineError, type EngineEvent } from "./types.js";

const PROVIDER_NAMES = new Set([...Object.keys(PROVIDER_ENV_META), "builder"]);
const constructedErrors = new WeakSet<object>();

/** Fixed application-owned copy. Never derived from a provider response. */
export const PRIVATE_COMPLETION_ERROR_MESSAGE =
  "The private completion failed.";

/** Fixed application-owned code used when no canonical status was read. */
export const PRIVATE_COMPLETION_ERROR_CODE = "private_completion_error";

export interface PrivateCompletionErrorOptions {
  code?: string;
  status?: number;
  message?: string;
}

function safeProvider(provider: unknown): string {
  if (typeof provider !== "string") return "model";
  const name = provider.startsWith("ai-sdk:")
    ? provider.slice("ai-sdk:".length)
    : provider;
  return PROVIDER_NAMES.has(name) ? name : "model";
}

function safeStatus(status: unknown): number | undefined {
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : undefined;
}

/**
 * Reads `statusCode` / `status` without trusting a hostile accessor: a getter
 * that throws is ignored rather than allowed to escape the boundary. Only an
 * integer in the HTTP error range is canonicalized to a code.
 */
function readNumericStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["statusCode", "status"] as const) {
    let value: unknown;
    try {
      value = (error as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    const status = safeStatus(value);
    if (status !== undefined) return status;
  }
  return undefined;
}

function readField(error: unknown, key: string): unknown {
  try {
    return typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)[key]
      : undefined;
  } catch {
    // coercion-ok: a throwing getter contributes nothing; the error is retyped to fixed copy either way.
    return undefined;
  }
}

function isAuthenticationError(error: unknown): boolean {
  try {
    return error instanceof ProviderAuthenticationError;
  } catch {
    // coercion-ok: a hostile prototype trap is not an auth error; it falls to the generic private error.
    return false;
  }
}

/**
 * Local error boundary for private completion. It retains only a fixed
 * message, an allowlisted provider, and a canonical code/status; the incoming
 * error is never stored. This is a boundary guarantee, not a claim about what
 * an engine or provider does with the request before it fails.
 */
export class PrivateCompletionError extends EngineError {
  readonly provider: string;
  readonly code: string;
  readonly status?: number;

  constructor(provider: unknown, opts?: PrivateCompletionErrorOptions) {
    const safe = safeProvider(provider);
    const status = safeStatus(opts?.status);
    const code =
      safe === "builder" && opts?.code === "builder_auth_error"
        ? "builder_auth_error"
        : status !== undefined
          ? `http_${status}`
          : PRIVATE_COMPLETION_ERROR_CODE;
    super(PRIVATE_COMPLETION_ERROR_MESSAGE, {
      errorCode: code,
      ...(status !== undefined ? { statusCode: status } : {}),
    });
    this.name = "PrivateCompletionError";
    this.provider = safe;
    this.code = code;
    if (status !== undefined) this.status = status;
    constructedErrors.add(this);
    Object.freeze(this);
  }

  details() {
    return {
      message: this.message,
      provider: this.provider,
      code: this.code,
      ...(this.status !== undefined ? { status: this.status } : {}),
    };
  }

  stopEvent(): EngineEvent {
    return {
      type: "stop",
      reason: "error",
      error: this.message,
      errorCode: this.code,
      provider: this.provider,
      ...(this.status !== undefined ? { statusCode: this.status } : {}),
    };
  }
}

/**
 * Retypes any error crossing the private boundary. The canonical 401 helper is
 * preserved as typed code/provider/status; everything else only contributes a
 * safely-read numeric status. No message, code, cause, request id, upgrade
 * url, response, or stack from the incoming error survives.
 */
export function toPrivateCompletionError(
  error: unknown,
  fallbackProvider: unknown = "model",
): PrivateCompletionError {
  if (
    typeof error === "object" &&
    error !== null &&
    constructedErrors.has(error)
  ) {
    return error as PrivateCompletionError;
  }

  const status = readNumericStatus(error);
  if (isAuthenticationError(error)) {
    const code = readField(error, "code");
    return new PrivateCompletionError(
      readField(error, "provider") ?? fallbackProvider,
      {
        ...(code === "builder_auth_error" ? { code } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    );
  }

  return new PrivateCompletionError(fallbackProvider, {
    ...(status !== undefined ? { status } : {}),
  });
}
