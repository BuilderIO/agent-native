import { ActionContractError } from "@agent-native/core";
import { getUserLabs } from "@agent-native/core/labs/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { PLAN_EDITIONS } from "../../shared/labs.js";

/**
 * 404, not 403: an app whose owner never turned the lab on does not have
 * editions at all. A signed-out caller is left to the action's own access
 * check, or the reader is told the feature is missing instead of to sign in.
 */
export async function assertEditionsLabEnabled(): Promise<void> {
  const email = getRequestUserEmail();
  if (!email) return;
  const labs = await getUserLabs(email);
  if (labs[PLAN_EDITIONS.key] === true) return;
  throw new ActionContractError("Editions is turned off in Labs.", {
    errorCode: "editions-lab-disabled",
    statusCode: 404,
  });
}
