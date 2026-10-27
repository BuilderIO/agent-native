import { getAssignment, upsertAssignment } from "../observability/store.js";
import { getRequestContext } from "../server/request-context.js";
import {
  assignFirstRunBuilderCreditsV2,
  FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
  FIRST_RUN_BUILDER_CREDITS_V2_VARIANTS,
  type FirstRunBuilderCreditsV2RequestAssignment,
} from "../shared/first-run-builder-credits-experiment.js";

function authUserIdForRequest(): string | null {
  const authUserId = getRequestContext()?.authUserId?.trim();
  return authUserId || null;
}

function requestAssignment(
  authUserId: string,
  variantId: string,
): FirstRunBuilderCreditsV2RequestAssignment {
  if (
    !FIRST_RUN_BUILDER_CREDITS_V2_VARIANTS.includes(
      variantId as (typeof FIRST_RUN_BUILDER_CREDITS_V2_VARIANTS)[number],
    )
  ) {
    throw new Error(
      `Invalid first-run Builder credits v2 variant: ${variantId}`,
    );
  }
  const expected = assignFirstRunBuilderCreditsV2(authUserId);
  if (!expected || expected.experiment_variant !== variantId) {
    throw new Error(
      "Stored first-run Builder credits v2 assignment disagrees with the authenticated user assignment.",
    );
  }
  return {
    authUserId,
    experiment_id: FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
    experiment_variant: variantId,
  };
}

function setRequestAssignment(
  assignment: FirstRunBuilderCreditsV2RequestAssignment,
): void {
  const context = getRequestContext();
  if (context?.authUserId !== assignment.authUserId) {
    throw new Error(
      "Cannot attach a first-run Builder credits v2 assignment to a different request identity.",
    );
  }
  context.firstRunBuilderCreditsV2Assignment = assignment;
}

/**
 * Persist exposure after the caller has confirmed the Clips v2 flag is on.
 * The authenticated id is read from request context and is the only assignment
 * key; no email or anonymous identity can create a row.
 */
export async function recordFirstRunBuilderCreditsV2Exposure({
  flagEnabled,
}: {
  flagEnabled: boolean;
}): Promise<FirstRunBuilderCreditsV2RequestAssignment | null> {
  if (!flagEnabled) return null;
  const authUserId = authUserIdForRequest();
  if (!authUserId) return null;
  const expected = assignFirstRunBuilderCreditsV2(authUserId);
  if (!expected) return null;

  const existing = await getAssignment(
    FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
    authUserId,
  );
  if (existing) {
    const assignment = requestAssignment(authUserId, existing.variantId);
    setRequestAssignment(assignment);
    return assignment;
  }

  await upsertAssignment({
    experimentId: FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
    userId: authUserId,
    variantId: expected.experiment_variant,
    assignedAt: Date.now(),
  });
  const assignment = { ...expected, authUserId };
  setRequestAssignment(assignment);
  return assignment;
}

/** Load a previously exposed arm into the current request before tracking. */
export async function loadFirstRunBuilderCreditsV2Assignment(): Promise<FirstRunBuilderCreditsV2RequestAssignment | null> {
  const authUserId = authUserIdForRequest();
  if (!authUserId) return null;
  const assignedInRequest =
    getRequestContext()?.firstRunBuilderCreditsV2Assignment;
  if (assignedInRequest?.authUserId === authUserId) {
    const assignment = requestAssignment(
      authUserId,
      assignedInRequest.experiment_variant,
    );
    setRequestAssignment(assignment);
    return assignment;
  }
  const existing = await getAssignment(
    FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
    authUserId,
  );
  if (!existing) return null;
  const assignment = requestAssignment(authUserId, existing.variantId);
  setRequestAssignment(assignment);
  return assignment;
}
