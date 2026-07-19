import { defineEventHandler, getRouterParam } from "h3";

import { readPrivateVaultBoundedBody } from "../../../../../lib/private-vault-bounded-body.js";
import {
  hasPrivateVaultEnrollmentCsrf,
  hasPrivateVaultEnrollmentMediaType,
  preparePrivateVaultEnrollmentResponse,
  privateVaultEnrollmentErrorResponse,
  privateVaultEnrollmentFailure,
  privateVaultEnrollmentLength,
  serializePrivateVaultEnrollmentStatus,
} from "../../../../../lib/private-vault-enrollment-http.js";
import {
  privateVaultEnrollmentLimits,
  publishPrivateVaultEnrollmentSasDecision,
} from "../../../../../lib/private-vault-enrollment.js";
import { resolveAuthenticatedPrivateVaultBootstrapScope } from "../../../../../lib/private-vault-genesis-account-scope.js";

export default defineEventHandler(async (event) => {
  preparePrivateVaultEnrollmentResponse(event);
  if (!hasPrivateVaultEnrollmentCsrf(event)) {
    return privateVaultEnrollmentFailure(event, 403);
  }
  const offerHash = getRouterParam(event, "offerHash") ?? "";
  const length = privateVaultEnrollmentLength(event);
  if (
    !/^[0-9a-f]{64}$/.test(offerHash) ||
    !hasPrivateVaultEnrollmentMediaType(event) ||
    !Number.isSafeInteger(length) ||
    length > privateVaultEnrollmentLimits.sasDecisionBytes
  ) {
    return privateVaultEnrollmentFailure(event, 404);
  }
  const sasDecision = await readPrivateVaultBoundedBody(
    event,
    length,
    privateVaultEnrollmentLimits.sasDecisionBytes,
  ).catch(() => null);
  const scope = await resolveAuthenticatedPrivateVaultBootstrapScope(event);
  if (!sasDecision || !scope) {
    return privateVaultEnrollmentFailure(event, 404);
  }
  try {
    return serializePrivateVaultEnrollmentStatus(
      await publishPrivateVaultEnrollmentSasDecision({
        scope,
        offerHash,
        sasDecision,
      }),
    );
  } catch (error) {
    return privateVaultEnrollmentErrorResponse(event, error);
  }
});
