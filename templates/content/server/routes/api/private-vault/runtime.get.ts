import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";

import { privateVaultControlLogService } from "../../../lib/private-vault-control-log-runtime.js";
import { resolveAuthenticatedPrivateVaultBootstrapScope } from "../../../lib/private-vault-genesis-account-scope.js";

function fail(event: Parameters<typeof setResponseStatus>[0], status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

/** Content-free attended runtime discovery; broker enrollment is optional. */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const scope = await resolveAuthenticatedPrivateVaultBootstrapScope(event);
  if (!scope) return fail(event, 404);
  try {
    const state = await privateVaultControlLogService.loadVerifiedState(scope);
    if (!state) return fail(event, 404);
    return {
      version: 1,
      suite: "anc/v1",
      state: "active",
      vaultId: scope.vaultId,
      head: { sequence: state.sequence, hash: state.headHash },
    };
  } catch {
    return fail(event, 503);
  }
});
