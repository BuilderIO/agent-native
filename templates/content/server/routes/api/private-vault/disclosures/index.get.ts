import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { resolveAuthenticatedPrivateVaultScope } from "../../../../lib/private-vault-genesis-account-scope.js";
import { privateVaultSignedDisclosureService } from "../../../../lib/private-vault-signed-disclosures.js";

const NOT_FOUND = { error: "Not found" };

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const vaultId = getHeader(event, "x-anc-vault-id")?.trim() ?? "";
  const scope = await resolveAuthenticatedPrivateVaultScope(event, vaultId);
  if (!scope) {
    setResponseStatus(event, 404);
    return NOT_FOUND;
  }
  try {
    const rows = await privateVaultSignedDisclosureService.list(scope, 50);
    return {
      version: 1,
      suite: "anc/v1",
      disclosures: rows.map((row) => ({
        disclosureId: row.disclosureId,
        vaultId: row.vaultId,
        endpointId: row.endpointId,
        jobId: row.jobId,
        grantId: row.grantId,
        resourceId: row.resourceId,
        operation: row.operation,
        providerId: row.providerId,
        destination: row.destination,
        outcome: row.outcome,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        serverReceivedAt: row.serverReceivedAt,
        signedEnvelope: row.signedEnvelope,
      })),
    };
  } catch {
    setResponseStatus(event, 503);
    return { error: "Request unavailable" };
  }
});
