/**
 * Turns one session's raw analytics events into the ordered step sequence the
 * onboarding journey tree is built from. Pure: no I/O, so the SQL that selects
 * the events and the tree that consumes the steps meet only through these
 * types.
 */

import { normalizeJourneyPath } from "../../shared/journey-path.js";

export { normalizeJourneyPath };

export interface JourneyEventRow {
  id: string;
  sessionId: string;
  tsMs: number;
  eventName: string;
  path: string | null;
  stepId: string | null;
  methodId: string | null;
  outcome: string | null;
  action: string | null;
}

export interface JourneyStep {
  key: string;
  label: string;
  tsMs: number;
}

/** Display names match the `onboarding-setup-choice` metric's method list. */
const METHOD_LABELS: Record<string, string> = {
  builder_create_account: "Create Builder.io account",
  builder_sign_in: "Sign in with Builder.io account",
  custom_keys: "Configure custom keys",
};

// Both spellings of the auth events: the catalog's SQL reads the dotted names
// and core aliases them to the underscored ones.
const SIGNUP_VIEWED = ["auth.signup_viewed", "auth_signup_viewed"];
const SIGNUP_CLICKED = ["auth.signup_clicked", "auth_signup_clicked"];

/** Events that put a session in the onboarding cohort at all. */
export const JOURNEY_COHORT_EVENT_NAMES: readonly string[] = [
  "signup",
  ...SIGNUP_VIEWED,
  ...SIGNUP_CLICKED,
  "onboarding_started",
  "onboarding_step_viewed",
  "onboarding_method_clicked",
];

/** Every event name that can become a step; the SQL selects exactly these. */
export const JOURNEY_STEP_EVENT_NAMES: readonly string[] = [
  "pageview",
  "signup",
  ...SIGNUP_VIEWED,
  ...SIGNUP_CLICKED,
  "onboarding_step_viewed",
  "onboarding_method_clicked",
  "onboarding_method_outcome",
  "onboarding_completed",
  "onboarding_app_entered",
  "app_entered",
  "app.first_action",
  "generation_started",
  "generation_completed",
  "recording_started",
  "recording_ready",
];

// Events sharing a millisecond order by where they sit in the journey, so a
// session's sequence does not depend on event id order.
const TIE_RANK: Record<string, number> = {
  pageview: 0,
  "auth.signup_viewed": 1,
  auth_signup_viewed: 1,
  "auth.signup_clicked": 2,
  auth_signup_clicked: 2,
  signup: 3,
  onboarding_step_viewed: 4,
  onboarding_method_clicked: 5,
  onboarding_method_outcome: 6,
  onboarding_completed: 7,
  onboarding_app_entered: 8,
  app_entered: 8,
  "app.first_action": 9,
  generation_started: 10,
  recording_started: 10,
  generation_completed: 11,
  recording_ready: 11,
};

function clean(value: string | null): string {
  return value?.trim().toLowerCase() || "unknown";
}

function methodLabel(methodId: string): string {
  return METHOD_LABELS[methodId] ?? methodId;
}

export function deriveJourneyStep(
  row: JourneyEventRow,
): { key: string; label: string } | null {
  switch (row.eventName) {
    case "pageview": {
      const path = normalizeJourneyPath(row.path);
      return path ? { key: `page:${path}`, label: path } : null;
    }
    case "onboarding_step_viewed": {
      const id = clean(row.stepId);
      return { key: `step:${id}`, label: `Onboarding step: ${id}` };
    }
    case "onboarding_method_clicked": {
      const id = clean(row.methodId);
      return { key: `method:${id}`, label: `Chose: ${methodLabel(id)}` };
    }
    case "onboarding_method_outcome": {
      const id = clean(row.methodId);
      const outcome = clean(row.outcome);
      return {
        key: `outcome:${id}:${outcome}`,
        label: `${methodLabel(id)}: ${outcome}`,
      };
    }
    case "signup":
      return { key: "signup", label: "Signed up" };
    case "auth.signup_viewed":
    case "auth_signup_viewed":
      return { key: "auth:signup_viewed", label: "Signup page viewed" };
    case "auth.signup_clicked":
    case "auth_signup_clicked":
      return { key: "auth:signup_clicked", label: "Signup CTA clicked" };
    case "onboarding_completed":
      return { key: "onboarding:completed", label: "Onboarding completed" };
    case "onboarding_app_entered":
    case "app_entered":
      return { key: "app:entered", label: "Entered app" };
    case "app.first_action": {
      const action = clean(row.action);
      return {
        key: `action:first:${action}`,
        label: `First action: ${action}`,
      };
    }
    case "generation_started":
      return { key: "output:generation_started", label: "Generation started" };
    case "generation_completed":
      return {
        key: "output:generation_completed",
        label: "Generation completed",
      };
    case "recording_started":
      return { key: "output:recording_started", label: "Recording started" };
    case "recording_ready":
      return { key: "output:recording_ready", label: "Recording ready" };
    default:
      return null;
  }
}

/**
 * One session's rows as ordered steps. Rows with no step meaning are skipped
 * and consecutive repeats of the same step collapse into the first, which
 * keeps that first occurrence's timestamp.
 */
export function buildSessionSteps(
  rows: readonly JourneyEventRow[],
): JourneyStep[] {
  const ordered = [...rows].sort(
    (a, b) =>
      a.tsMs - b.tsMs ||
      (TIE_RANK[a.eventName] ?? 99) - (TIE_RANK[b.eventName] ?? 99) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const steps: JourneyStep[] = [];
  for (const row of ordered) {
    const step = deriveJourneyStep(row);
    if (!step || steps[steps.length - 1]?.key === step.key) continue;
    steps.push({ ...step, tsMs: row.tsMs });
  }
  return steps;
}
