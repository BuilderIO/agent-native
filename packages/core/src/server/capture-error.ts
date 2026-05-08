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
  let eventId: string | undefined;
  for (const provider of providers.values()) {
    try {
      const result = provider(error, context);
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
