import type { A2ACorrelationMetadata } from "./types.js";

export const MAX_A2A_CORRELATION_VALUE_CHARS = 200;
export const MAX_A2A_DELEGATION_HOPS = 3;

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
// Model ids also carry `/` (provider-prefixed gateway ids).
const MODEL_HINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

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
 * the verified A2A token/request context. `callerModel` is the one value here
 * a receiver may act on, and only as a preference — it never reaches identity,
 * org, access, or approval resolution, and it can only name a model the
 * receiver's own engine already offers (see `resolveDelegatedRunModel`).
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
  const callerModel = boundedIdentifier(
    metadata.callerModel,
    MODEL_HINT_PATTERN,
  );
  const providedDelegationDepth =
    typeof metadata.delegationDepth === "number" &&
    Number.isInteger(metadata.delegationDepth) &&
    metadata.delegationDepth >= 0 &&
    metadata.delegationDepth <= MAX_A2A_DELEGATION_HOPS
      ? metadata.delegationDepth
      : undefined;
  const visitedApps = Array.isArray(metadata.visitedApps)
    ? [
        ...new Set(
          metadata.visitedApps
            .map((value) => boundedIdentifier(value, APP_ID_PATTERN))
            .filter((value): value is string => !!value),
        ),
      ].slice(0, MAX_A2A_DELEGATION_HOPS + 1)
    : [];
  const pathDepth = Math.min(MAX_A2A_DELEGATION_HOPS, visitedApps.length);
  // Damaged lineage must never reset a nested call to depth zero. Derive at
  // least the valid path length, and fail closed at the hop limit when a peer
  // supplied an explicit but invalid depth.
  const delegationDepth =
    providedDelegationDepth !== undefined
      ? Math.max(providedDelegationDepth, pathDepth)
      : metadata.delegationDepth !== undefined
        ? MAX_A2A_DELEGATION_HOPS
        : visitedApps.length > 0
          ? pathDepth
          : undefined;
  return {
    ...(callerApp ? { callerApp } : {}),
    ...(callerThreadId ? { callerThreadId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(invocationId ? { invocationId } : {}),
    ...(delegationDepth !== undefined ? { delegationDepth } : {}),
    ...(visitedApps.length > 0 ? { visitedApps } : {}),
    ...(callerModel ? { callerModel } : {}),
  };
}
