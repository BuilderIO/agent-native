import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { getOrgContext } from "@agent-native/core/org";
import { getCurrentBetterAuthSession } from "@agent-native/core/server";
import { defineEventHandler, getRequestURL, setResponseStatus } from "h3";

import {
  CONTENT_PRIVATE_VAULT_ACCESS_FLAG,
  CONTENT_PRIVATE_VAULT_ENROLLMENT_FLAG,
  CONTENT_PRIVATE_VAULT_MIGRATION_FLAG,
} from "../../shared/private-vault-feature-flags.js";

function isEnrollmentPath(pathname: string) {
  return (
    pathname.startsWith("/api/private-vault/genesis/") ||
    pathname.startsWith("/api/private-vault/enrollment/")
  );
}

function isMigrationPath(pathname: string) {
  return pathname.startsWith("/api/private-vault/migration/");
}

/**
 * Gate only user-session Private Vault traffic here. Cookie-free broker,
 * control-log, and platform requests carry their own signed/bearer authority
 * and deliberately continue to their stricter route-specific verifiers.
 */
export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;
  if (!pathname.startsWith("/api/private-vault/")) return;

  const session = await getCurrentBetterAuthSession(event).catch(() => null);
  if (!session?.email || !session.userId) return;
  const org = await getOrgContext(event).catch(() => null);
  const email = session.email.trim().toLowerCase();
  if (!org?.orgId || org.email.trim().toLowerCase() !== email) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  const scope = {
    userEmail: email,
    userKey: session.userId,
    orgId: org.orgId,
  };
  const access = await isFeatureFlagEnabled(
    CONTENT_PRIVATE_VAULT_ACCESS_FLAG,
    scope,
  );
  const enrollment =
    !isEnrollmentPath(pathname) ||
    (await isFeatureFlagEnabled(CONTENT_PRIVATE_VAULT_ENROLLMENT_FLAG, scope));
  const migration =
    !isMigrationPath(pathname) ||
    (await isFeatureFlagEnabled(CONTENT_PRIVATE_VAULT_MIGRATION_FLAG, scope));
  if (access && enrollment && migration) return;
  setResponseStatus(event, 404);
  return { error: "Not found" };
});
