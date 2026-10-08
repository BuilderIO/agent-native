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
  speed: "Couldn't read session speed data.",
} as const;

/**
 * What a caller is told about a failed Lab state, friction, or speed read. The error
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

/** What a request asked the Lab for, named in its 403. */
export type SessionsTriageLabFeature = "events" | "friction" | "speed";

function labFeatureSubject(
  features: readonly SessionsTriageLabFeature[],
): string {
  const nouns = [...new Set(features)];
  const list =
    nouns.length < 3
      ? nouns.join(" and ")
      : `${nouns.slice(0, -1).join(", ")}, and ${nouns[nouns.length - 1]}`;
  const plural = nouns.length > 1 || nouns[0] === "events";
  return `Session ${list} ${plural ? "are" : "is"}`;
}

export async function assertSessionsTriageLabEnabled(
  userEmail: string | undefined,
  orgId?: string | null,
  features: readonly SessionsTriageLabFeature[] = ["events"],
): Promise<void> {
  if (await isSessionsTriageLabEnabled(userEmail, orgId)) return;
  fail(
    `${labFeatureSubject(features)} part of the Sessions triage Lab. Turn it on in Settings > Labs.`,
    { errorCode: "sessions_triage_lab_disabled", statusCode: 403 },
  );
}
