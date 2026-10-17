import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import { ForbiddenError } from "@agent-native/core/sharing";

import {
  requirePlanOwnerEmailForWrite,
  resolvePlanOrgIdForWrite,
} from "./local-identity.js";

export type PlanWriteVisibility = "private" | "org" | "public";

async function resolvePlanOrgIdForVisibility(
  visibility: PlanWriteVisibility,
  label: string,
): Promise<string | undefined> {
  if (visibility !== "org") return undefined;

  const requesterEmail = getRequestUserEmail();
  const requestOrgId = resolvePlanOrgIdForWrite(
    requesterEmail,
    getRequestOrgId(),
  );
  if (requestOrgId) return requestOrgId;

  const ownerEmail = requirePlanOwnerEmailForWrite(requesterEmail, label);
  const ownerOrgId = await resolveOrgIdForEmail(ownerEmail);
  if (ownerOrgId) return ownerOrgId;

  throw new ForbiddenError(
    `${label} with org visibility requires an active organization. Connect Plan from an organization or publish with private visibility.`,
  );
}

/**
 * Run a plan write with the org that org-visibility requires already bound onto
 * the request context, so the row is inserted under the same org the later
 * access checks read. Without this, an org-visible write from a request that
 * carries no org lands unscoped and nobody in the org can read it back.
 */
export async function runWithPlanOrgContext<T>(
  visibility: PlanWriteVisibility,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const orgId = await resolvePlanOrgIdForVisibility(visibility, label);
  if (!orgId || orgId === getRequestOrgId()) return fn();
  const requestContext = getRequestContext() ?? {};
  return runWithRequestContext(
    {
      ...requestContext,
      userEmail: requestContext.userEmail ?? getRequestUserEmail(),
      orgId,
    },
    fn,
  ) as Promise<T>;
}
