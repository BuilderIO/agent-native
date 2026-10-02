import { fail } from "@agent-native/core/action";
import { getUserLabEnabled } from "@agent-native/core/labs/server";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../shared/labs.js";

export async function isSessionsTriageLabEnabled(
  userEmail: string | undefined,
  orgId?: string | null,
): Promise<boolean> {
  if (!userEmail) return false;
  return getUserLabEnabled(userEmail, ANALYTICS_SESSIONS_TRIAGE_LAB, {
    orgId: orgId ?? undefined,
  });
}

const LAB_FEATURE_SUBJECTS = {
  events: "Session events are",
  friction: "Session friction is",
  "events and friction": "Session events and friction are",
} as const;

export async function assertSessionsTriageLabEnabled(
  userEmail: string | undefined,
  orgId?: string | null,
  feature: keyof typeof LAB_FEATURE_SUBJECTS = "events",
): Promise<void> {
  if (await isSessionsTriageLabEnabled(userEmail, orgId)) return;
  fail(
    `${LAB_FEATURE_SUBJECTS[feature]} part of the Sessions triage Lab. Turn it on in Settings > Labs.`,
    { errorCode: "sessions_triage_lab_disabled", statusCode: 403 },
  );
}
