import {
  defineEventHandler,
  getHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { resolveAuthenticatedPrivateVaultScope } from "../../../../../lib/private-vault-genesis-account-scope.js";
import {
  PrivateVaultObjectNotFoundError,
  privateVaultObjectService,
} from "../../../../../lib/private-vault-objects.js";

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
  const objectId = getRouterParam(event, "objectId") ?? "";
  const revisionId = getRouterParam(event, "revisionId") ?? "";
  try {
    const result = await privateVaultObjectService.getRevision(
      scope,
      objectId,
      revisionId,
    );
    setResponseHeader(event, "Content-Type", "application/octet-stream");
    setResponseHeader(
      event,
      "X-ANC-Ciphertext-Byte-Length",
      String(result.metadata.ciphertextByteLength),
    );
    setResponseHeader(event, "X-ANC-Algorithm-Id", result.metadata.algorithmId);
    setResponseHeader(event, "X-ANC-Epoch", String(result.metadata.epoch));
    setResponseHeader(event, "X-ANC-Object-Type", result.metadata.objectType);
    setResponseHeader(
      event,
      "X-ANC-Parent-Revision-Ids",
      Buffer.from(JSON.stringify(result.metadata.parentRevisionIds)).toString(
        "base64url",
      ),
    );
    return result.ciphertext;
  } catch (error) {
    setResponseStatus(
      event,
      error instanceof PrivateVaultObjectNotFoundError ? 404 : 503,
    );
    return error instanceof PrivateVaultObjectNotFoundError
      ? NOT_FOUND
      : { error: "Request unavailable" };
  }
});
