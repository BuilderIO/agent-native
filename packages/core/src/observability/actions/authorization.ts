import { fail, type ActionRunContext } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { currentRequestUserIsOrgAdmin } from "../../server/org-admin.js";
import { getRequestRunContext } from "../../server/request-context.js";

function requireObservabilityOrgIdentity(ctx: ActionRunContext | undefined): {
  userId: string;
  orgId: string;
} {
  const userId = ctx?.userEmail?.trim();
  if (!userId) fail("Sign in to review agent outputs.", { statusCode: 401 });
  const orgId = ctx?.orgId?.trim();
  if (!orgId) {
    fail("Only organization owners and admins can review agent outputs.", {
      statusCode: 403,
    });
  }
  return { userId, orgId };
}

export async function authorizeObservabilityOrgAdmin(
  _args: unknown,
  ctx: ActionRunContext | undefined,
): Promise<boolean> {
  const { orgId } = requireObservabilityOrgIdentity(ctx);
  if (!(await currentRequestUserIsOrgAdmin(orgId))) {
    fail("Only organization owners and admins can review agent outputs.", {
      statusCode: 403,
    });
  }
  return true;
}

export function getObservabilityOrgAdminAccess(
  ctx: ActionRunContext | undefined,
): {
  userId: string;
  orgId: string;
  reviewScope:
    | { kind: "organization"; orgId: string }
    | { kind: "all"; activeOrgId: string };
} {
  const { userId, orgId } = requireObservabilityOrgIdentity(ctx);
  const superOrgId = getAppConfig().observability.superOrgId;
  return {
    userId,
    orgId,
    reviewScope:
      superOrgId && orgId === superOrgId
        ? { kind: "all", activeOrgId: orgId }
        : { kind: "organization", orgId },
  };
}

export function resolveObservabilityReviewOrg(
  scope:
    | { kind: "organization"; orgId: string }
    | { kind: "all"; activeOrgId: string },
  requestedOrgId?: string,
): string {
  if (scope.kind === "all") {
    const orgId = requestedOrgId?.trim();
    if (!orgId) {
      fail("Choose an organization for this review output.", {
        statusCode: 400,
      });
    }
    return orgId;
  }
  if (requestedOrgId && requestedOrgId !== scope.orgId) {
    fail("This review output belongs to a different organization.", {
      statusCode: 403,
    });
  }
  return scope.orgId;
}

export function requireObservabilityReviewRunScope(runId: string): void {
  const scope = getRequestRunContext()?.actionScope;
  if (scope?.kind === "observability-review-summary-batch") {
    const runIds = scope.runIds;
    if (
      !Array.isArray(runIds) ||
      !runIds.every((value) => typeof value === "string") ||
      !runIds.includes(runId)
    ) {
      fail("This summary request is outside its authorized run batch.", {
        statusCode: 403,
      });
    }
    return;
  }
  if (
    (scope?.kind === "observability-review-summary" ||
      scope?.kind === "observability-feedback-improvement") &&
    scope.runId !== runId
  ) {
    fail("This summary request is scoped to a different run.", {
      statusCode: 403,
    });
  }
}
