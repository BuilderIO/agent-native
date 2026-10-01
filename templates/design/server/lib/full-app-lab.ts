import { getUserLabState } from "@agent-native/core/labs/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { FULL_APP_BUILDING_LAB } from "../../shared/labs.js";

export async function isFullAppBuildingEnabled(ctx?: {
  userEmail?: string;
  orgId?: string | null;
}): Promise<boolean> {
  const userEmail = ctx?.userEmail ?? getRequestUserEmail();
  if (!userEmail)
    throw new Error("Full app building requires an authenticated user");
  const state = await getUserLabState(userEmail, FULL_APP_BUILDING_LAB, {
    userEmail,
    orgId: ctx?.orgId,
  });
  return state.enabled;
}
