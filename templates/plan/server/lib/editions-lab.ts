import { ActionContractError } from "@agent-native/core";
import { getUserLabs } from "@agent-native/core/labs/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { PLAN_EDITIONS } from "../../shared/labs.js";

/**
 * Labs are stored per user, so the gate can only speak for a caller who has
 * one. Plan's no-login local mode has no Labs identity to read or to toggle,
 * and a signed-out hosted reader is turned away by the action's own access
 * check — refusing here instead would tell them the feature does not exist
 * rather than to sign in.
 */
export async function isEditionsLabEnabled(): Promise<boolean> {
  const email = getRequestUserEmail();
  if (!email) return true;
  const labs = await getUserLabs(email);
  return labs[PLAN_EDITIONS.key] === true;
}

/** 404, not 403: an app whose owner never turned the lab on has no editions. */
export async function assertEditionsLabEnabled(): Promise<void> {
  if (await isEditionsLabEnabled()) return;
  throw new ActionContractError("Editions is turned off in Labs.", {
    errorCode: "editions-lab-disabled",
    statusCode: 404,
  });
}
