import { getRequestContext } from "./request-context.js";

export interface CaptureErrorContext {
  route?: string;
  method?: string;
  userAgent?: string;
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
  aiTraceId?: string;
}

export type CaptureErrorProvider = (
  error: unknown,
  context: CaptureErrorContext,
) => string | undefined | void;

const providers = new Map<string, CaptureErrorProvider>();

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

export function captureError(
  error: unknown,
  context: CaptureErrorContext = {},
): string | undefined {
  if (getRequestContext()?.isSyntheticTraffic) return undefined;

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
