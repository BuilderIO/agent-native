import {
  AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY,
  AGENT_NATIVE_SUBMISSION_TTL_MS_METADATA_KEY,
} from "@agent-native/agentkit/protocol";

export function normalizeSubmissionDeadlineMetadata(
  metadata: unknown,
  serverReceivedAt = Date.now(),
): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const record = metadata as Record<string, unknown>;
  const custom = record.custom;
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
    return record;
  }
  const customRecord = custom as Record<string, unknown>;
  if (
    !Object.prototype.hasOwnProperty.call(
      customRecord,
      AGENT_NATIVE_SUBMISSION_TTL_MS_METADATA_KEY,
    )
  ) {
    return record;
  }

  const ttlMs = customRecord[AGENT_NATIVE_SUBMISSION_TTL_MS_METADATA_KEY];
  const expiresAt =
    typeof ttlMs === "number" &&
    Number.isFinite(ttlMs) &&
    ttlMs >= 0 &&
    Number.isFinite(serverReceivedAt) &&
    Number.isFinite(serverReceivedAt + ttlMs)
      ? serverReceivedAt + ttlMs
      : Number.NaN;
  const normalizedCustom = { ...customRecord };
  delete normalizedCustom[AGENT_NATIVE_SUBMISSION_TTL_MS_METADATA_KEY];
  normalizedCustom[AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY] = expiresAt;
  return { ...record, custom: normalizedCustom };
}
