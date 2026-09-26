import { fail, type ActionRunContext } from "../../action.js";
import { currentRequestUserIsOrgAdmin } from "../../server/org-admin.js";
import { getRequestRunContext } from "../../server/request-context.js";

export async function requireObservabilityOrgAdmin(
  ctx: ActionRunContext | undefined,
): Promise<{ userId: string; orgId: string }> {
  const userId = ctx?.userEmail?.trim();
  if (!userId) fail("Sign in to review agent outputs.", { statusCode: 401 });
  const orgId = ctx?.orgId?.trim();
  if (!orgId || !(await currentRequestUserIsOrgAdmin(orgId))) {
    fail("Only organization owners and admins can review agent outputs.", {
      statusCode: 403,
    });
  }
  return { userId, orgId };
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
