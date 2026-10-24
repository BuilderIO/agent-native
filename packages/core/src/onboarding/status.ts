import { appStateGet } from "../application-state/store.js";
import { listOnboardingSteps } from "./registry.js";
import {
  DEFAULT_ONBOARDING_CHECKLIST,
  type OnboardingResolveContext,
  type OnboardingStepStatus,
} from "./types.js";

const OVERRIDE_KEY_PREFIX = "onboarding:override:";
const DISMISSED_KEY = "onboarding:dismissed";
const CHECKLIST_NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export function isValidOnboardingChecklistName(name: string): boolean {
  return CHECKLIST_NAME_PATTERN.test(name);
}

/** The setup checklist keeps its original key so existing dismissals survive. */
export function onboardingDismissedKey(checklist: string): string {
  return checklist === DEFAULT_ONBOARDING_CHECKLIST
    ? DISMISSED_KEY
    : `${DISMISSED_KEY}:${checklist}`;
}

export function onboardingOverrideKey(stepId: string): string {
  return `${OVERRIDE_KEY_PREFIX}${stepId}`;
}

async function hasOverride(
  sessionId: string,
  stepId: string,
): Promise<boolean> {
  const val = await appStateGet(sessionId, onboardingOverrideKey(stepId));
  return !!(val && (val as { complete?: boolean }).complete);
}

export async function readOnboardingDismissed(
  sessionId: string,
  checklist: string = DEFAULT_ONBOARDING_CHECKLIST,
): Promise<boolean> {
  const value = await appStateGet(sessionId, onboardingDismissedKey(checklist));
  return !!(value && (value as { dismissed?: boolean }).dismissed);
}

/**
 * Resolves the steps of one checklist. A failing `isAvailable`, `isComplete`,
 * or override read rejects instead of reporting a step as incomplete, so
 * callers can tell "could not check" from "not done".
 */
export async function getOnboardingStepStatuses(
  context: OnboardingResolveContext,
  options: { preview?: boolean; checklist?: string } = {},
): Promise<OnboardingStepStatus[]> {
  const checklist = options.checklist ?? DEFAULT_ONBOARDING_CHECKLIST;
  const steps = listOnboardingSteps().filter(
    (step) => (step.checklist ?? DEFAULT_ONBOARDING_CHECKLIST) === checklist,
  );
  const serialized = await Promise.all(
    steps.map(async (step) => {
      if (!options.preview && step.isAvailable) {
        if (!(await step.isAvailable(context))) return null;
      }
      let complete = false;
      if (!options.preview) {
        complete = (await step.isComplete(context)) === true;
        if (!complete) {
          complete = await hasOverride(context.sessionId, step.id);
        }
      }
      return {
        id: step.id,
        title: step.title,
        description: step.description,
        order: step.order,
        required: step.required ?? false,
        complete,
        ...(step.href ? { href: step.href } : {}),
        methods: step.methods,
      };
    }),
  );
  return serialized.filter(
    (step): step is OnboardingStepStatus => step !== null,
  );
}
