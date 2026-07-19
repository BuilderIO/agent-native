import {
  ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES,
  decodeAncV1MigrationEvidence,
  encodeAncV1MigrationEvidenceResponse,
} from "@agent-native/core/e2ee";
import {
  getHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { readPrivateVaultBoundedBody } from "./private-vault-bounded-body.js";
import {
  authenticatePrivateVaultAttendedEndpoint,
  decodePrivateVaultEndpointProofHeader,
} from "./private-vault-endpoint-auth.js";
import { privateVaultMigrationEvidenceService } from "./private-vault-migration-evidence-runtime.js";

export const PRIVATE_VAULT_MIGRATION_EVIDENCE_PATH =
  "/api/private-vault/migration/evidence";

function fail(event: H3Event) {
  setResponseStatus(event, 404);
  return { error: "Not found" };
}

export async function handlePrivateVaultMigrationEvidence(event: H3Event) {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const length = getHeader(event, "content-length")?.trim() ?? "";
  if (
    getHeader(event, "content-type")?.trim().toLowerCase() !==
      "application/octet-stream" ||
    !/^[1-9][0-9]*$/.test(length) ||
    Number(length) > ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES
  )
    return fail(event);
  const body = await readPrivateVaultBoundedBody(
    event,
    Number(length),
    ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES,
  ).catch(() => null);
  if (!body || body.byteLength !== Number(length)) return fail(event);
  try {
    const evidence = decodeAncV1MigrationEvidence(body);
    const proof = decodePrivateVaultEndpointProofHeader(
      getHeader(event, "x-anc-endpoint-proof")?.trim() ?? "",
    );
    const principal = await authenticatePrivateVaultAttendedEndpoint({
      proof,
      method: "POST",
      path: PRIVATE_VAULT_MIGRATION_EVIDENCE_PATH,
      body,
    });
    const stored = await privateVaultMigrationEvidenceService.append(
      principal,
      evidence,
    );
    const response = encodeAncV1MigrationEvidenceResponse({
      version: 1,
      suite: "anc/v1",
      type: "migration-evidence-response",
      kind: stored.kind,
      state: "stored",
      migrationId: stored.migrationId,
      evidenceId: stored.evidenceId,
    });
    setResponseHeader(event, "Content-Type", "application/octet-stream");
    setResponseHeader(event, "Content-Length", String(response.byteLength));
    return response;
  } catch {
    return fail(event);
  } finally {
    body.fill(0);
  }
}
