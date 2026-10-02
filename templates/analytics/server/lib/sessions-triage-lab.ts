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

export async function assertSessionsTriageLabEnabled(
  userEmail: string | undefined,
  orgId?: string | null,
): Promise<void> {
  if (await isSessionsTriageLabEnabled(userEmail, orgId)) return;
  fail(
    "Session events are part of the Sessions triage Lab. Turn it on in Settings > Labs.",
    { errorCode: "sessions_triage_lab_disabled", statusCode: 403 },
  );
}
