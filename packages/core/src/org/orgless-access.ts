import { isTrustedSelfHostedRuntime } from "../server/credential-provider.js";
import { isBootstrapAdmin } from "./signup-admission.js";

/**
 * A caller with no active org is not the only user of a deployment: any
 * account can clear its active org. Without an org there is no role to
 * check, so deployment-wide writes stay with a bootstrap admin or a local,
 * self-hosted runtime.
 */
export function canManageDeploymentWithoutOrg(
  email: string | null | undefined,
): boolean {
  if (isTrustedSelfHostedRuntime()) return true;
  const normalized = email?.trim() ?? "";
  return normalized.length > 0 && isBootstrapAdmin(normalized);
}
