import { opaqueIdSchema } from "@agent-native/core/e2ee";
import {
  defineEventHandler,
  getHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { resolveAuthenticatedPrivateVaultScope } from "../../../../lib/private-vault-genesis-account-scope.js";
import { privateVaultGrantService } from "../../../../lib/private-vault-grants.js";

function header(event: Parameters<typeof getHeader>[0], name: string) {
  return getHeader(event, name)?.trim() ?? "";
}

function fail(event: Parameters<typeof setResponseStatus>[0], status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  if (
    header(event, "x-agent-native-csrf") !== "1" &&
    header(event, "sec-fetch-site") !== "same-origin"
  )
    return fail(event, 403);
  const vault = opaqueIdSchema.safeParse(header(event, "x-anc-vault-id"));
  const grant = opaqueIdSchema.safeParse(getRouterParam(event, "grantId"));
  if (!vault.success || !grant.success) return fail(event, 400);
  const scope = await resolveAuthenticatedPrivateVaultScope(event, vault.data);
  if (!scope) return fail(event, 404);
  try {
    return await privateVaultGrantService.revoke(scope, grant.data);
  } catch {
    return fail(event, 503);
  }
});
