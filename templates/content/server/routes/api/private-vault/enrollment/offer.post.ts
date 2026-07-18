import {
  ancV1LifecycleIdToHex,
  decodeAncV1Canonical,
  decodeAncV1EndpointEnrollmentOffer,
  E2EE_ENVELOPE_FIELDS,
} from "@agent-native/core/e2ee";
import { defineEventHandler } from "h3";

import { readPrivateVaultBoundedBody } from "../../../../lib/private-vault-bounded-body.js";
import {
  hasPrivateVaultEnrollmentCsrf,
  hasPrivateVaultEnrollmentMediaType,
  preparePrivateVaultEnrollmentResponse,
  privateVaultEnrollmentErrorResponse,
  privateVaultEnrollmentFailure,
  privateVaultEnrollmentLength,
  serializePrivateVaultEnrollmentStatus,
} from "../../../../lib/private-vault-enrollment-http.js";
import {
  publishPrivateVaultEnrollmentOffer,
  privateVaultEnrollmentLimits,
} from "../../../../lib/private-vault-enrollment.js";
import { resolveAuthenticatedPrivateVaultScope } from "../../../../lib/private-vault-genesis-account-scope.js";

export default defineEventHandler(async (event) => {
  preparePrivateVaultEnrollmentResponse(event);
  if (!hasPrivateVaultEnrollmentCsrf(event)) {
    return privateVaultEnrollmentFailure(event, 403);
  }
  const length = privateVaultEnrollmentLength(event);
  if (
    !hasPrivateVaultEnrollmentMediaType(event) ||
    !Number.isSafeInteger(length) ||
    length > privateVaultEnrollmentLimits.offerBytes
  ) {
    return privateVaultEnrollmentFailure(event, 400);
  }
  const offer = await readPrivateVaultBoundedBody(
    event,
    length,
    privateVaultEnrollmentLimits.offerBytes,
  ).catch(() => null);
  if (!offer) return privateVaultEnrollmentFailure(event, 400);
  let vaultId: string;
  try {
    const decoded = decodeAncV1EndpointEnrollmentOffer(offer, {
      expectedVaultId: offerVaultId(offer),
    });
    vaultId = ancV1LifecycleIdToHex(decoded.vaultId);
  } catch {
    return privateVaultEnrollmentFailure(event, 400);
  }
  const scope = await resolveAuthenticatedPrivateVaultScope(event, vaultId);
  if (!scope) return privateVaultEnrollmentFailure(event, 404);
  try {
    return serializePrivateVaultEnrollmentStatus(
      await publishPrivateVaultEnrollmentOffer({ scope, offer }),
    );
  } catch (error) {
    return privateVaultEnrollmentErrorResponse(event, error);
  }
});

function offerVaultId(offer: Uint8Array): Uint8Array {
  // The decoder still validates the complete canonical envelope. This bounded
  // pre-read extracts only the common vault-id field so account scope can be
  // resolved without accepting a separate caller coordinate.
  const decoded = decodeAncV1Canonical(offer, {
    maxBytes: privateVaultEnrollmentLimits.offerBytes,
  });
  if (!(decoded instanceof Map)) throw new Error();
  const value = decoded.get(E2EE_ENVELOPE_FIELDS.common.vaultId);
  if (!(value instanceof Uint8Array) || value.byteLength !== 16) {
    throw new Error();
  }
  return value;
}
