import type { A2ACorrelationMetadata } from "./types.js";

export const MAX_A2A_CORRELATION_VALUE_CHARS = 200;

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_A2A_CORRELATION_VALUE_CHARS) {
    return undefined;
  }
  return trimmed;
}

/**
 * Keep only bounded, content-free correlation fields. These values remain
 * telemetry hints; authentication continues to come exclusively from the
 * verified A2A token/request context.
 */
export function sanitizeA2ACorrelationMetadata(
  value: unknown,
): A2ACorrelationMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  const callerApp = boundedString(metadata.callerApp);
  const callerThreadId = boundedString(metadata.callerThreadId);
  const parentRunId = boundedString(metadata.parentRunId);
  const parentTurnId = boundedString(metadata.parentTurnId);
  const invocationId = boundedString(metadata.invocationId);
  return {
    ...(callerApp ? { callerApp } : {}),
    ...(callerThreadId ? { callerThreadId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(invocationId ? { invocationId } : {}),
  };
}
