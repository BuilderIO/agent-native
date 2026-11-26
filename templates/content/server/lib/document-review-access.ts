import type {
  ReviewResourceContext,
  ReviewResourceRole,
  ReviewableResourceRegistration,
} from "@agent-native/core/review";
import {
  resolveAccess,
  roleSatisfies,
  type AccessContext,
} from "@agent-native/core/sharing";

import {
  isAgentCall,
  type CallProvenance,
} from "../../actions/_document-agent-lock.js";
import { agentLevelFromStored } from "../../shared/agent-level.js";

/** The access context core's default path builds from a review call's. */
function accessContextFrom(ctx: ReviewResourceContext): AccessContext {
  const transaction = ctx.transaction as AccessContext["transaction"];
  return {
    ...(ctx.userEmail != null ? { userEmail: ctx.userEmail } : {}),
    ...(ctx.orgId != null ? { orgId: ctx.orgId } : {}),
    ...(transaction ? { transaction } : {}),
  };
}

/**
 * Core's review comments and suggestions on a page take its access from here,
 * as they would from the page's sharing. While the page is set to Can view an
 * agent's role stops at viewer, so it reads threads and suggestions there but
 * doesn't write, react to or decide them.
 */
export const contentDocumentReviewResource: ReviewableResourceRegistration = {
  type: "document",
  async resolveAccess(resourceId, ctx) {
    const access = await resolveAccess(
      "document",
      resourceId,
      ctx ? accessContextFrom(ctx) : undefined,
    );
    if (!access) return null;
    const { agentTextLocked } = access.resource as {
      agentTextLocked?: number | null;
    };
    const viewOnly =
      agentLevelFromStored(agentTextLocked) === "view" &&
      isAgentCall(ctx as CallProvenance | undefined) &&
      roleSatisfies(access.role, "commenter");
    return {
      role: viewOnly ? "viewer" : (access.role as ReviewResourceRole),
      ownerEmail: access.resource.ownerEmail ?? null,
      orgId: access.resource.orgId ?? null,
      visibility: access.resource.visibility,
      resource: access.resource,
    };
  },
};
