import { fail } from "../action.js";
import type { FeatureFlagScope } from "../feature-flags/store.js";

interface LabsCallerContext {
  userEmail?: string | null;
  orgId?: string | null;
}

function isCallerContext(ctx: unknown): ctx is LabsCallerContext {
  return typeof ctx === "object" && ctx !== null;
}

/** The signed-in user and org a Lab action acts for. */
export function labsCaller(ctx: unknown): {
  email: string;
  scope: FeatureFlagScope;
} {
  if (!isCallerContext(ctx) || !ctx.userEmail) {
    fail("Not authenticated.", { statusCode: 401 });
  }
  return {
    email: ctx.userEmail,
    scope: ctx.orgId ? { orgId: ctx.orgId } : {},
  };
}
