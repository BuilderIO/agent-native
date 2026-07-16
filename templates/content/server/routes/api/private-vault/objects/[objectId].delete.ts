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
} from "../../../../lib/private-vault-objects.js";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const csrf = getHeader(event, "x-agent-native-csrf")?.trim();
  if (csrf !== "1" && getHeader(event, "sec-fetch-site") !== "same-origin") {
    setResponseStatus(event, 403);
    return { error: "Request unavailable" };
  }
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  const vaultId = getHeader(event, "x-anc-vault-id")?.trim() ?? "";
  const objectId = getRouterParam(event, "objectId") ?? "";
  try {
    return await privateVaultObjectService.deleteObject(
      { ownerEmail: session.email, orgId: session.orgId ?? "", vaultId },
      objectId,
    );
  } catch (error) {
    setResponseStatus(
      event,
      error instanceof PrivateVaultObjectNotFoundError ? 404 : 503,
    );
    return error instanceof PrivateVaultObjectNotFoundError
      ? { error: "Not found" }
      : { error: "Request unavailable" };
  }
});
