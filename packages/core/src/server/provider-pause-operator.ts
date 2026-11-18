import { fail } from "../action.js";
import { getAppConfig } from "../app-config/index.js";
import { listOrgMemberships } from "../org/context.js";
import type { OrgMembership } from "../org/context.js";
import { canManageOrg } from "../org/permissions.js";

/**
 * Who may flip a deployment-wide provider pause.
 *
 * A pause switch stops every user's calls to that provider on this deployment, so the identity allowed to
 * flip it must come from the deployment's own declaration:
 *
 * - the deployment's operator email allowlist (`providerPause.operatorEmails`), or
 * - the one organization the deployment names as its own (`providerPause.operatorOrgId`), through its owner
 *   or admin.
 *
 * Nothing else counts. In particular "owner of an organization" is NOT enough on its own: signing in creates
 * an organization with the new person as its owner, so that would admit any stranger. A deployment that
 * declares neither refuses the switch (typed `provider_pause_forbidden`) rather than inheriting whoever
 * happens to be signed in, and an unreadable configuration also refuses: fail closed, never admit.
 */
export const PROVIDER_PAUSE_FORBIDDEN = "provider_pause_forbidden";

export type ProviderPauseCaller = {
  userEmail?: string | undefined;
  orgId?: string | null | undefined;
};

type ProviderPauseBinding = {
  operatorEmails: readonly string[];
  operatorOrgId: string | null;
};

type DeclaredBinding =
  | ({ state: "read"; reason?: undefined } & ProviderPauseBinding)
  | { state: "unreadable"; reason: "config-unreadable" };

function declaredBinding(): DeclaredBinding {
  try {
    const config = getAppConfig().providerPause;
    return {
      state: "read",
      operatorEmails: config.operatorEmails,
      operatorOrgId: config.operatorOrgId ?? null,
    };
  } catch {
    // An unreadable configuration is not permission, and it is not the same answer as "nobody was declared":
    // a caller reading the failure can tell a deployment that declared no operator from one whose declaration
    // could not be resolved, and both refuse.
    return { state: "unreadable", reason: "config-unreadable" };
  }
}

function namedOrgMembership(
  memberships: readonly OrgMembership[] | null,
  operatorOrgId: string,
): OrgMembership | null {
  if (!memberships) return null;
  const membership = memberships.find((entry) => entry.orgId === operatorOrgId);
  return membership && canManageOrg(membership.role) ? membership : null;
}

async function isOperator(
  caller: ProviderPauseCaller | undefined,
  binding: ProviderPauseBinding,
): Promise<boolean> {
  const email = caller?.userEmail?.trim().toLowerCase();
  if (!email) return false;
  if (binding.operatorEmails.includes(email)) return true;
  if (!binding.operatorOrgId) return false;
  const memberships = await listOrgMemberships(email);
  return namedOrgMembership(memberships, binding.operatorOrgId) !== null;
}

/** True only for the deployment's declared operator. A pause switch reports it, never guesses it. */
export async function isProviderPauseOperator(
  caller: ProviderPauseCaller | undefined,
): Promise<boolean> {
  const binding = declaredBinding();
  if (binding.state === "unreadable") return false;
  return isOperator(caller, binding);
}

/**
 * Refuse anyone else before the action touches the pause setting. Throws the typed 403 so a caller can tell
 * "you may not" from "the write failed".
 */
export async function assertProviderPauseOperator(
  caller: ProviderPauseCaller | undefined,
): Promise<void> {
  const binding = declaredBinding();
  const email = caller?.userEmail?.trim().toLowerCase();
  if (!email) {
    fail("This switch needs a signed-in operator.", {
      errorCode: PROVIDER_PAUSE_FORBIDDEN,
      statusCode: 403,
    });
  }
  if (binding.state === "unreadable") {
    fail(
      "This deployment's provider-switch operator declaration could not be read.",
      {
        errorCode: PROVIDER_PAUSE_FORBIDDEN,
        statusCode: 403,
        details: { reason: binding.reason },
      },
    );
  }
  if (binding.operatorEmails.length === 0 && binding.operatorOrgId === null) {
    fail(
      "This deployment has not declared an operator for its provider switches.",
      { errorCode: PROVIDER_PAUSE_FORBIDDEN, statusCode: 403 },
    );
  }
  if (await isOperator(caller, binding)) return;
  fail("Only this deployment's declared operator can change this switch.", {
    errorCode: PROVIDER_PAUSE_FORBIDDEN,
    statusCode: 403,
  });
}
