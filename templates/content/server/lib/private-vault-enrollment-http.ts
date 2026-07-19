import {
  getHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  PrivateVaultEnrollmentError,
  type PrivateVaultEnrollmentStatus,
} from "./private-vault-enrollment.js";

export const PRIVATE_VAULT_ENROLLMENT_MEDIA_TYPE =
  "application/vnd.agent-native.private-vault-enrollment+cbor";

export function preparePrivateVaultEnrollmentResponse(event: H3Event) {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
}

export function hasPrivateVaultEnrollmentCsrf(event: H3Event): boolean {
  return (
    getHeader(event, "x-agent-native-csrf")?.trim() === "1" ||
    getHeader(event, "sec-fetch-site")?.trim() === "same-origin"
  );
}

export function privateVaultEnrollmentLength(event: H3Event): number {
  const value = getHeader(event, "content-length")?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(value)) return Number.NaN;
  return Number(value);
}

export function hasPrivateVaultEnrollmentMediaType(event: H3Event): boolean {
  return (
    getHeader(event, "content-type")?.trim().toLowerCase() ===
    PRIVATE_VAULT_ENROLLMENT_MEDIA_TYPE
  );
}

export function privateVaultEnrollmentFailure(event: H3Event, status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

export function privateVaultEnrollmentErrorResponse(
  event: H3Event,
  error: unknown,
) {
  if (error instanceof PrivateVaultEnrollmentError) {
    if (error.code === "invalid_request") {
      return privateVaultEnrollmentFailure(event, 400);
    }
    if (error.code === "conflict" || error.code === "expired") {
      return privateVaultEnrollmentFailure(event, 409);
    }
    if (error.code === "unavailable") {
      return privateVaultEnrollmentFailure(event, 503);
    }
  }
  return privateVaultEnrollmentFailure(event, 404);
}

export function serializePrivateVaultEnrollmentStatus(
  status: PrivateVaultEnrollmentStatus,
) {
  return {
    version: 1 as const,
    suite: "anc/v1" as const,
    phase: status.phase,
    offer: Buffer.from(status.offer).toString("base64url"),
    challenge:
      status.challenge === null
        ? null
        : Buffer.from(status.challenge).toString("base64url"),
    sasDecision:
      status.sasDecision === null
        ? null
        : Buffer.from(status.sasDecision).toString("base64url"),
    authorization:
      status.authorization === null
        ? null
        : Buffer.from(status.authorization).toString("base64url"),
    controlEntryId: status.controlEntryId,
    controlEntryHash: status.controlEntryHash,
    expiresAt: status.expiresAt,
  };
}
