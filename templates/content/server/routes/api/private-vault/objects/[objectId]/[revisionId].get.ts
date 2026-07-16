import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  PrivateVaultObjectNotFoundError,
  privateVaultObjectService,
} from "../../../../../lib/private-vault-objects.js";

const NOT_FOUND = { error: "Not found" };

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 404);
    return NOT_FOUND;
  }
  const vaultId = getHeader(event, "x-anc-vault-id")?.trim() ?? "";
  const objectId = getRouterParam(event, "objectId") ?? "";
  const revisionId = getRouterParam(event, "revisionId") ?? "";
  try {
    const result = await privateVaultObjectService.getRevision(
      { ownerEmail: session.email, orgId: session.orgId ?? "", vaultId },
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
