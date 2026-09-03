/**
 * Server helper: load the current user's "include full video in AI" preference.
 */

import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";

import {
  CLIPS_USER_PREFS_KEY,
  isIncludeFullVideoInAiEnabled,
  type ClipsUserPrefs,
} from "../../shared/clips-ai-prefs.js";

export async function readIncludeFullVideoInAi(
  email?: string | null,
): Promise<boolean> {
  const userEmail = email ?? getRequestUserEmail();
  if (!userEmail) return false;
  try {
    const prefs = (await getUserSetting(
      userEmail,
      CLIPS_USER_PREFS_KEY,
    )) as ClipsUserPrefs | null;
    return isIncludeFullVideoInAiEnabled(prefs);
  } catch {
    return false;
  }
}
