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

const READ_FAILURES = {
  labState: "Couldn't read the Sessions triage Lab state.",
  friction: "Couldn't read session friction.",
} as const;

/**
 * What a caller is told about a failed Lab state or friction read. The error
 * itself can quote database details, so only the server log keeps it.
 */
export function sessionsTriageReadFailure(
  read: keyof typeof READ_FAILURES,
  logPrefix: string,
  error: unknown,
): string {
  console.error(`${logPrefix} ${READ_FAILURES[read]}`, error);
  return READ_FAILURES[read];
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
