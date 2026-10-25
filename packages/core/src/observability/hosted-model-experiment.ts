import {
  DEFAULT_REASONING_EFFORT,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";

/**
 * First-party hosted A/B: the Builder default (`engine.defaultModel` at
 * DEFAULT_REASONING_EFFORT) versus Haiku 5.5 at medium effort. Chat clients
 * send the default model and effort explicitly, so this keys off the resolved
 * values rather than the explicit-request flag the DB experiment path uses.
 * Any other model or effort is a deliberate choice and is left alone.
 */
export const HOSTED_MODEL_EXPERIMENT_ID =
  "hosted-default-haiku-5-5-medium-vs-luna-high-2026-10";

export const HOSTED_MODEL_EXPERIMENT_CONTROL = {
  id: "luna-high",
} as const;

export const HOSTED_MODEL_EXPERIMENT_TREATMENT = {
  id: "haiku-5-5-medium",
  model: "claude-haiku-5-5",
  effort: "medium",
} as const satisfies { id: string; model: string; effort: ReasoningEffort };

const TREATMENT_PERCENT = 50;

export interface HostedModelExperimentAssignment {
  experimentId: string;
  variantId: string;
}

export interface HostedModelExperimentResolution {
  /** True only for the Haiku arm; control keeps the request's model and effort. */
  treatment: boolean;
  model: string;
  /** Undefined for the control arm: the request's own effort stands. */
  effort?: ReasoningEffort;
  assignment: HostedModelExperimentAssignment;
}

/**
 * `setting` is `observability.hostedModelExperiment` from app config. `auto`
 * follows the caller's first-party hosted check; `on` forces it for preview;
 * `off` is the emergency rollback.
 */
export function isHostedModelExperimentEnabled(args: {
  setting: "auto" | "on" | "off";
  firstParty: boolean;
}): boolean {
  if (args.setting === "off") return false;
  return args.setting === "on" || args.firstParty;
}

/**
 * Stable across apps and processes: the same user lands in the same arm in
 * every hosted template for the life of this experiment id. No DB write needed.
 */
export function hostedModelExperimentBucket(userEmail: string): number {
  const input = `${HOSTED_MODEL_EXPERIMENT_ID}:${userEmail.trim().toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export function resolveHostedModelExperiment(args: {
  enabled: boolean;
  userEmail: string | null | undefined;
  engineName: string;
  defaultModel: string;
  model: string;
  /** The request's effort as submitted; anything but default means a choice. */
  effort: unknown;
}): HostedModelExperimentResolution | null {
  const userEmail = args.userEmail?.trim();
  if (!userEmail) return null;
  if (!args.enabled) return null;
  if (args.engineName !== "builder") return null;
  if (args.model !== args.defaultModel) return null;
  if (
    args.effort !== undefined &&
    args.effort !== "auto" &&
    args.effort !== DEFAULT_REASONING_EFFORT
  ) {
    return null;
  }

  if (hostedModelExperimentBucket(userEmail) >= TREATMENT_PERCENT) {
    return {
      treatment: false,
      model: args.model,
      assignment: {
        experimentId: HOSTED_MODEL_EXPERIMENT_ID,
        variantId: HOSTED_MODEL_EXPERIMENT_CONTROL.id,
      },
    };
  }
  return {
    treatment: true,
    model: HOSTED_MODEL_EXPERIMENT_TREATMENT.model,
    effort: HOSTED_MODEL_EXPERIMENT_TREATMENT.effort,
    assignment: {
      experimentId: HOSTED_MODEL_EXPERIMENT_ID,
      variantId: HOSTED_MODEL_EXPERIMENT_TREATMENT.id,
    },
  };
}

/**
 * The hosted arm's variant, found by id so it is reported even when the turn
 * is also in another experiment. The singular experiment tags only cover a
 * turn with exactly one assignment.
 */
export function hostedModelExperimentVariant(
  assignments: readonly HostedModelExperimentAssignment[] | undefined,
): string | undefined {
  return assignments?.find(
    (assignment) => assignment.experimentId === HOSTED_MODEL_EXPERIMENT_ID,
  )?.variantId;
}

/**
 * The singular experiment tags predate the hosted test. They keep naming only
 * the other experiment on a turn, so the hosted arm never changes them.
 */
export function singleNonHostedAssignment(
  assignments: readonly HostedModelExperimentAssignment[] | undefined,
): HostedModelExperimentAssignment | undefined {
  const others = assignments?.filter(
    (assignment) => assignment.experimentId !== HOSTED_MODEL_EXPERIMENT_ID,
  );
  return others?.length === 1 ? others[0] : undefined;
}
