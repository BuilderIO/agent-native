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
  journeyKind: "onboarding" | "standalone_setup";
  tsMs: number;
  eventName: string;
  templateName: string | null;
  path: string | null;
  flow: string | null;
  source: string | null;
  stepId: string | null;
  stepIndex: number | null;
  methodId: string | null;
  outcome: string | null;
  action: string | null;
  aliasId?: string | null;
}

export interface JourneyStep {
  key: string;
  label: string;
  tsMs: number;
}

/** Display names match the `onboarding-setup-choice` metric's method list. */
const METHOD_LABELS: Record<string, string> = {
  builder_create_account: "Use Builder.io",
  builder_sign_in: "Sign in with Builder.io account",
  custom_keys: "Configure custom keys",
  builder: "Use Builder.io",
  setup_card: "Connection options",
};

// Both spellings of the auth events: the catalog's SQL reads the dotted names
// and core aliases them to the underscored ones.
const SIGNUP_VIEWED = ["auth.signup_viewed", "auth_signup_viewed"];
const SIGNUP_CLICKED = ["auth.signup_clicked", "auth_signup_clicked"];
const ONBOARDING_STEP_EVENT_NAMES = new Set([
  "onboarding_step_viewed",
  "onboarding_step_skipped",
]);

const BUILDER_CONNECTION_EVENT_ALIASES: Readonly<Record<string, string>> = {
  builder_connect_clicked: "builder_connect_clicked",
  "builder connect clicked": "builder_connect_clicked",
  builder_connect_popup_blocked: "builder_connect_popup_blocked",
  "builder connect popup blocked": "builder_connect_popup_blocked",
  builder_connect_started: "builder_connect_started",
  "builder connect started": "builder_connect_started",
  builder_connect_succeeded: "builder_connect_succeeded",
  "builder connect succeeded": "builder_connect_succeeded",
  builder_connect_failed: "builder_connect_failed",
  "builder connect failed": "builder_connect_failed",
};

const BUILDER_CONNECTION_STEPS: Record<string, { key: string; label: string }> =
  {
    builder_connect_clicked: {
      key: "builder:connect:clicked",
      label: "Builder connection CTA clicked",
    },
    builder_connect_popup_blocked: {
      key: "builder:connect:popup_blocked",
      label: "Builder connection popup blocked",
    },
    builder_connect_started: {
      key: "builder:connect:started",
      label: "Builder connection started",
    },
    builder_connect_succeeded: {
      key: "builder:connect:succeeded",
      label: "Builder connected",
    },
    builder_connect_failed: {
      key: "builder:connect:failed",
      label: "Builder connection failed",
    },
  };

const PROVIDER_SETUP_EVENT_NAMES = [
  "integration_key_entry_started",
  "integration_key_validation_outcome",
  "integration_key_save_outcome",
] as const;

const PROVIDER_SETUP_OUTCOME_LABELS: Record<string, string> = {
  started: "started",
  accepted: "accepted",
  rejected: "rejected",
  missing_key: "key missing",
  invalid_endpoint: "endpoint invalid",
  unreachable: "unreachable",
  provider_error: "provider error",
  error: "error",
  saved: "saved",
  failed: "failed",
};

const PROVIDER_SETUP_FLOWS = new Set(["chat_setup", "settings"]);
const INTEGRATION_SETUP_FLOWS = new Set(["chat_setup"]);
const INTEGRATION_SETUP_METHOD_IDS = new Set([
  "setup_card",
  "builder",
  "custom_keys",
]);
const INTEGRATION_SETUP_OUTCOMES = new Set([
  "exposed",
  "started",
  "connected",
  "status_read_failed",
  "connection_failed",
]);

/** Events that put a session in the onboarding cohort at all. */
export const JOURNEY_COHORT_EVENT_NAMES: readonly string[] = [
  "signup",
  ...SIGNUP_VIEWED,
  ...SIGNUP_CLICKED,
  "onboarding_started",
  "onboarding_step_viewed",
  "onboarding_step_skipped",
  "onboarding_abandoned",
  "onboarding_method_clicked",
];

/** Home integration sessions get a separate tree when they never entered onboarding. */
export const JOURNEY_INTEGRATION_EVENT_NAMES: readonly string[] = [
  "integration_setup_exposed",
  "integration_method_clicked",
  "integration_method_outcome",
];

/** Slides reports request and attempt outcomes separately from saved outputs. */
export const SLIDES_GENERATION_ATTEMPT_EVENT_NAMES: readonly string[] = [
  "generation_started",
  "generation_request_accepted",
  "generation_outcome_unresolved",
  "generation_failed",
  "generation_stuck",
  "generation_cancelled",
  "generation_abandoned",
];

/** Every event name that can become a step; the SQL selects exactly these. */
export const JOURNEY_STEP_EVENT_NAMES: readonly string[] = [
  "pageview",
  "signup",
  ...SIGNUP_VIEWED,
  ...SIGNUP_CLICKED,
  "onboarding_step_viewed",
  "onboarding_step_skipped",
  "onboarding_method_clicked",
  "onboarding_method_started",
  "onboarding_method_outcome",
  "integration_setup_exposed",
  "integration_method_clicked",
  "integration_method_outcome",
  "onboarding_abandoned",
  "onboarding_completed",
  "onboarding_app_entered",
  "app_entered",
  "app.first_action",
  ...SLIDES_GENERATION_ATTEMPT_EVENT_NAMES,
  "generation_completed",
  "design_output_created",
  "recording_started",
  "recording_ready",
  ...Object.keys(BUILDER_CONNECTION_EVENT_ALIASES),
  ...PROVIDER_SETUP_EVENT_NAMES,
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
  onboarding_step_skipped: 5,
  onboarding_method_clicked: 6,
  onboarding_method_started: 7,
  onboarding_method_outcome: 9,
  onboarding_abandoned: 10,
  onboarding_completed: 11,
  onboarding_app_entered: 12,
  app_entered: 12,
  "app.first_action": 13,
  integration_setup_exposed: 14,
  integration_method_clicked: 15,
  builder_connect_clicked: 16,
  integration_key_entry_started: 16,
  builder_connect_popup_blocked: 17,
  integration_key_validation_outcome: 17,
  builder_connect_started: 18,
  integration_key_save_outcome: 18,
  builder_connect_succeeded: 19,
  builder_connect_failed: 19,
  integration_method_outcome: 20,
  generation_started: 21,
  recording_started: 21,
  generation_request_accepted: 22,
  generation_outcome_unresolved: 23,
  generation_failed: 23,
  generation_stuck: 23,
  generation_cancelled: 23,
  generation_abandoned: 23,
  generation_completed: 24,
  recording_ready: 22,
  design_output_created: 23,
};

function clean(value: string | null): string {
  return value?.trim().toLowerCase() || "unknown";
}

function lookup<T>(
  values: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(values, key)
    ? values[key]
    : undefined;
}

function methodLabel(methodId: string): string {
  return lookup(METHOD_LABELS, methodId) ?? methodId;
}

function eventRank(row: JourneyEventRow): number {
  const builderEvent = lookup(BUILDER_CONNECTION_EVENT_ALIASES, row.eventName);
  if (builderEvent) {
    const firstRun =
      row.flow?.trim().toLowerCase() === "first_run" ||
      row.source?.trim().toLowerCase() === "first_run_onboarding";
    if (firstRun) {
      switch (builderEvent) {
        case "builder_connect_clicked":
          return 7.5;
        case "builder_connect_popup_blocked":
          return 8;
        case "builder_connect_started":
          return 8.5;
        case "builder_connect_succeeded":
        case "builder_connect_failed":
          return 8.75;
      }
    }
    return lookup(TIE_RANK, builderEvent) ?? 99;
  }
  return lookup(TIE_RANK, row.eventName) ?? 99;
}

function providerSetupFlow(flow: string | null): string {
  const normalized = clean(flow);
  return PROVIDER_SETUP_FLOWS.has(normalized) ? normalized : "unknown";
}

function providerSetupOutcome(outcome: string | null): {
  key: string;
  label: string;
} {
  const normalized = clean(outcome);
  const label = lookup(PROVIDER_SETUP_OUTCOME_LABELS, normalized);
  return label
    ? { key: normalized, label }
    : { key: "unknown", label: "unknown" };
}

function integrationSetupValue(
  value: string | null,
  allowed: ReadonlySet<string>,
): string {
  const normalized = clean(value);
  return allowed.has(normalized) ? normalized : "unknown";
}

export function deriveJourneyStep(
  row: JourneyEventRow,
): { key: string; label: string } | null {
  const builderEvent = lookup(BUILDER_CONNECTION_EVENT_ALIASES, row.eventName);
  if (builderEvent)
    return lookup(BUILDER_CONNECTION_STEPS, builderEvent) ?? null;

  switch (row.eventName) {
    case "pageview": {
      const path = normalizeJourneyPath(row.path);
      return path ? { key: `page:${path}`, label: path } : null;
    }
    case "onboarding_step_viewed": {
      const id = clean(row.stepId);
      return { key: `step:${id}`, label: `Onboarding step: ${id}` };
    }
    case "onboarding_step_skipped": {
      const stepIndex =
        typeof row.stepIndex === "number" &&
        Number.isSafeInteger(row.stepIndex) &&
        row.stepIndex >= 0
          ? `:${row.stepIndex}`
          : "";
      const flow = row.flow?.trim().toLowerCase();
      const flowKey = flow ? `:flow:${encodeURIComponent(flow)}` : "";
      return {
        key: `onboarding:step_skipped${stepIndex}${flowKey}`,
        label: "Onboarding step skipped",
      };
    }
    case "onboarding_method_clicked": {
      const id = clean(row.methodId);
      return { key: `method:${id}`, label: `Chose: ${methodLabel(id)}` };
    }
    case "onboarding_method_started": {
      const id = clean(row.methodId);
      return {
        key: `method:${id}:started`,
        label: `${methodLabel(id)}: setup started`,
      };
    }
    case "onboarding_method_outcome": {
      const id = clean(row.methodId);
      const outcome = clean(row.outcome);
      return {
        key: `outcome:${id}:${outcome}`,
        label: `${methodLabel(id)}: ${outcome}`,
      };
    }
    case "integration_key_entry_started": {
      const flow = providerSetupFlow(row.flow);
      return {
        key: `custom_key:${flow}:entry_started`,
        label: `Custom key entry started (${flow})`,
      };
    }
    case "integration_key_validation_outcome": {
      const flow = providerSetupFlow(row.flow);
      const outcome = providerSetupOutcome(row.outcome);
      return {
        key: `custom_key:${flow}:validation:${outcome.key}`,
        label: `Custom key validation (${flow}): ${outcome.label}`,
      };
    }
    case "integration_key_save_outcome": {
      const flow = providerSetupFlow(row.flow);
      const outcome = providerSetupOutcome(row.outcome);
      return {
        key: `custom_key:${flow}:save:${outcome.key}`,
        label: `Custom key save (${flow}): ${outcome.label}`,
      };
    }
    case "integration_setup_exposed": {
      const flow = integrationSetupValue(row.flow, INTEGRATION_SETUP_FLOWS);
      const id = integrationSetupValue(
        row.methodId,
        INTEGRATION_SETUP_METHOD_IDS,
      );
      return {
        key: `integration:${flow}:exposed:${id}`,
        label: `Setup shown: ${methodLabel(id)}`,
      };
    }
    case "integration_method_clicked": {
      const flow = integrationSetupValue(row.flow, INTEGRATION_SETUP_FLOWS);
      const id = integrationSetupValue(
        row.methodId,
        INTEGRATION_SETUP_METHOD_IDS,
      );
      return {
        key: `integration:${flow}:method:${id}`,
        label: `Setup choice: ${methodLabel(id)}`,
      };
    }
    case "integration_method_outcome": {
      const flow = integrationSetupValue(row.flow, INTEGRATION_SETUP_FLOWS);
      const id = integrationSetupValue(
        row.methodId,
        INTEGRATION_SETUP_METHOD_IDS,
      );
      const outcome = integrationSetupValue(
        row.outcome,
        INTEGRATION_SETUP_OUTCOMES,
      );
      return {
        key: `integration:${flow}:outcome:${id}:${outcome}`,
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
    case "onboarding_abandoned":
      return { key: "onboarding:abandoned", label: "Onboarding abandoned" };
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
      return {
        key: "attempt:generation_started",
        label: "Generation attempt started",
      };
    case "generation_request_accepted":
      if (row.templateName !== "slides") return null;
      return {
        key: "attempt:generation_request_accepted",
        label: "Generation request accepted",
      };
    case "generation_outcome_unresolved":
      if (row.templateName !== "slides") return null;
      return {
        key: "attempt:generation_outcome_unresolved",
        label: "Generation outcome unresolved",
      };
    case "generation_failed":
      if (row.templateName !== "slides") return null;
      return {
        key: "attempt:generation_failed",
        label: "Generation attempt failed",
      };
    case "generation_stuck":
      if (row.templateName !== "slides") return null;
      return {
        key: "attempt:generation_stuck",
        label: "Generation attempt stalled",
      };
    case "generation_cancelled":
      if (row.templateName !== "slides") return null;
      return {
        key: "attempt:generation_cancelled",
        label: "Generation attempt cancelled",
      };
    case "generation_abandoned":
      if (row.templateName !== "slides") return null;
      return {
        key: "attempt:generation_abandoned",
        label: "Generation attempt abandoned",
      };
    case "generation_completed":
      if (!(row.templateName === "slides" || row.templateName === "design")) {
        return null;
      }
      return {
        key: "output:generation_completed",
        label: "Generation completed",
      };
    case "design_output_created":
      if (row.templateName !== "design") return null;
      return {
        key: "output:design_output_created",
        label: "Design output created",
      };
    case "recording_started":
      if (row.templateName !== "clips") return null;
      return {
        key: "attempt:recording_started",
        label: "Recording attempt started",
      };
    case "recording_ready":
      if (row.templateName !== "clips") return null;
      return { key: "output:recording_ready", label: "Clip saved" };
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
  const ordered = [...rows].sort((a, b) => {
    const aRank = eventRank(a);
    const bRank = eventRank(b);
    const aEventOrderKey =
      lookup(BUILDER_CONNECTION_EVENT_ALIASES, a.eventName) ?? a.eventName;
    const bEventOrderKey =
      lookup(BUILDER_CONNECTION_EVENT_ALIASES, b.eventName) ?? b.eventName;
    const aIsOnboardingStep = ONBOARDING_STEP_EVENT_NAMES.has(a.eventName);
    const bIsOnboardingStep = ONBOARDING_STEP_EVENT_NAMES.has(b.eventName);
    const aPositionRank = aIsOnboardingStep
      ? TIE_RANK.onboarding_step_viewed
      : aRank;
    const bPositionRank = bIsOnboardingStep
      ? TIE_RANK.onboarding_step_viewed
      : bRank;
    const aFlow = aIsOnboardingStep ? (a.flow ?? "") : "";
    const bFlow = bIsOnboardingStep ? (b.flow ?? "") : "";
    const aStepIndex = aIsOnboardingStep
      ? (a.stepIndex ?? Number.MAX_SAFE_INTEGER)
      : Number.MIN_SAFE_INTEGER;
    const bStepIndex = bIsOnboardingStep
      ? (b.stepIndex ?? Number.MAX_SAFE_INTEGER)
      : Number.MIN_SAFE_INTEGER;

    return (
      a.tsMs - b.tsMs ||
      aPositionRank - bPositionRank ||
      (aFlow < bFlow ? -1 : aFlow > bFlow ? 1 : 0) ||
      aStepIndex - bStepIndex ||
      aRank - bRank ||
      (aEventOrderKey < bEventOrderKey
        ? -1
        : aEventOrderKey > bEventOrderKey
          ? 1
          : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  });
  const steps: JourneyStep[] = [];
  const seenAliases = new Set<string>();
  for (const row of ordered) {
    const step = deriveJourneyStep(row);
    if (!step) continue;
    if (row.aliasId) {
      // Legacy and canonical telemetry records can arrive on either side of
      // other session events, but share this per-occurrence correlation key.
      const aliasStep = `${row.sessionId}\u0000${row.aliasId}\u0000${step.key}`;
      if (seenAliases.has(aliasStep)) continue;
      seenAliases.add(aliasStep);
    }
    if (steps[steps.length - 1]?.key === step.key) continue;
    steps.push({ ...step, tsMs: row.tsMs });
  }
  return steps;
}
