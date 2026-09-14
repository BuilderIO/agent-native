import { getUserLabs } from "@agent-native/core/labs/server";

import { CREATIVE_CONTEXT_LIBRARY_LAB } from "../labs.js";

export async function isCreativeContextLabAvailable(
  userEmail: string | undefined,
  labKey = CREATIVE_CONTEXT_LIBRARY_LAB.key,
): Promise<boolean> {
  if (!userEmail) return false;
  const labs = await getUserLabs(userEmail);
  return labs[labKey] === true;
}
