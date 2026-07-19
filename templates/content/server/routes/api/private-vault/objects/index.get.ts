import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { resolveAuthenticatedPrivateVaultScope } from "../../../../lib/private-vault-genesis-account-scope.js";
import {
  PrivateVaultObjectNotFoundError,
  privateVaultObjectService,
} from "../../../../lib/private-vault-objects.js";

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
    return { objects: await privateVaultObjectService.listObjects(scope) };
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
