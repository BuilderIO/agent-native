import type { A2ACorrelationMetadata } from "./types.js";

export const MAX_A2A_CORRELATION_VALUE_CHARS = 200;

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function boundedIdentifier(
  value: unknown,
  pattern: RegExp,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_A2A_CORRELATION_VALUE_CHARS ||
    !pattern.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

export function sanitizeA2ACorrelationId(value: unknown): string | undefined {
  return boundedIdentifier(value, CORRELATION_ID_PATTERN);
}

/**
 * Keep only bounded, opaque ASCII correlation identifiers. These values
 * remain telemetry hints; authentication continues to come exclusively from
 * the verified A2A token/request context.
 */
export function sanitizeA2ACorrelationMetadata(
  value: unknown,
): A2ACorrelationMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  const callerApp = boundedIdentifier(metadata.callerApp, APP_ID_PATTERN);
  const callerThreadId = sanitizeA2ACorrelationId(metadata.callerThreadId);
  const parentRunId = sanitizeA2ACorrelationId(metadata.parentRunId);
  const parentTurnId = sanitizeA2ACorrelationId(metadata.parentTurnId);
  const invocationId = sanitizeA2ACorrelationId(metadata.invocationId);
  return {
    ...(callerApp ? { callerApp } : {}),
    ...(callerThreadId ? { callerThreadId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(invocationId ? { invocationId } : {}),
  };
}
