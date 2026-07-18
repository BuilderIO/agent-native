import { defineEventHandler, getRouterParam } from "h3";

import {
  preparePrivateVaultEnrollmentResponse,
  privateVaultEnrollmentErrorResponse,
  privateVaultEnrollmentFailure,
  serializePrivateVaultEnrollmentStatus,
} from "../../../../../lib/private-vault-enrollment-http.js";
import { readPrivateVaultEnrollmentStatus } from "../../../../../lib/private-vault-enrollment.js";
import { resolveAuthenticatedPrivateVaultBootstrapScope } from "../../../../../lib/private-vault-genesis-account-scope.js";

export default defineEventHandler(async (event) => {
  preparePrivateVaultEnrollmentResponse(event);
  const offerHash = getRouterParam(event, "offerHash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(offerHash)) {
    return privateVaultEnrollmentFailure(event, 404);
  }
  const scope = await resolveAuthenticatedPrivateVaultBootstrapScope(event);
  if (!scope) return privateVaultEnrollmentFailure(event, 404);
  try {
    return serializePrivateVaultEnrollmentStatus(
      await readPrivateVaultEnrollmentStatus({ scope, offerHash }),
    );
  } catch (error) {
    return privateVaultEnrollmentErrorResponse(event, error);
  }
});
