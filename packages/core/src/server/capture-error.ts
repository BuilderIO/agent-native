import { getProtectedExecutionContext } from "../protected-execution-context.js";

export interface CaptureErrorContext {
  /** The request path or logical route, when known. */
  route?: string;
  /** HTTP method, when known. */
  method?: string;
  /** Caller's `User-Agent` header, when known. */
  userAgent?: string;
  /** Searchable low-cardinality tags. */
  tags?: Record<string, string | undefined>;
  /** Structured diagnostic payload shown on the captured event. */
  extra?: Record<string, unknown>;
  /** Grouped diagnostic cards shown on the captured event. */
  contexts?: Record<string, Record<string, unknown>>;
}

export type CaptureErrorProvider = (
  error: unknown,
  context: CaptureErrorContext,
) => string | undefined | void;

const providers = new Map<string, CaptureErrorProvider>();

/**
 * Register a backend for the framework-level `captureError()` utility.
 *
 * The default Sentry plugin registers itself here when a DSN is configured.
 * Keeping this registry Sentry-agnostic lets core runtime code report errors
 * without importing a Node-only SDK in edge/client-adjacent modules.
 */
export function registerErrorCaptureProvider(
  name: string,
  provider: CaptureErrorProvider,
): () => void {
  providers.set(name, provider);
  return () => {
    if (providers.get(name) === provider) {
      providers.delete(name);
    }
  };
}

/**
 * Capture an error through every configured provider. No-ops when no provider
 * is installed and never throws back into the application path.
 */
export function captureError(
  error: unknown,
  context: CaptureErrorContext = {},
): string | undefined {
  const protectedContext = getProtectedExecutionContext();
  const capturedError = protectedContext
    ? Object.assign(new Error("Protected execution failed"), {
        name: "ProtectedExecutionError",
        code: "protected_execution_error",
      })
    : error;
  const capturedContext: CaptureErrorContext = protectedContext
    ? {
        tags: {
          action: protectedContext.receipt.actionName,
          resourceType: protectedContext.receipt.resourceType,
          placement: protectedContext.receipt.placement,
        },
      }
    : context;
  let eventId: string | undefined;
  for (const provider of providers.values()) {
    try {
      const result = provider(capturedError, capturedContext);
      if (eventId === undefined && typeof result === "string") {
        eventId = result;
      }
    } catch {
      // Observability must never mask the original failure.
    }
  }
  return eventId;
}

export const captureServerError = captureError;
