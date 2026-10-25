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
  model: string;
  /** Undefined for the control arm: the request's own effort stands. */
  effort?: ReasoningEffort;
  assignment: HostedModelExperimentAssignment;
}

type HostedExperimentEnv = Record<string, string | undefined>;

const FIRST_PARTY_HOST_SUFFIX = ".agent-native.com";
const ENABLED_VALUES = new Set(["1", "true", "on", "yes"]);
const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

function hostnameFromUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Automatic only on first-party hosted domains. `AGENT_NATIVE_HOSTED_MODEL_EXPERIMENT`
 * forces it on for preview or off as the emergency rollback.
 */
export function isHostedModelExperimentEnabled(
  env: HostedExperimentEnv = process.env,
): boolean {
  const override =
    env.AGENT_NATIVE_HOSTED_MODEL_EXPERIMENT?.trim().toLowerCase();
  if (override && DISABLED_VALUES.has(override)) return false;
  if (override && ENABLED_VALUES.has(override)) return true;

  const hostnames = [
    env.APP_URL,
    env.BETTER_AUTH_URL,
    env.URL,
    env.DEPLOY_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ]
    .map(hostnameFromUrl)
    .filter((hostname): hostname is string => Boolean(hostname));

  return hostnames.some(
    (hostname) =>
      hostname === "agent-native.com" ||
      hostname.endsWith(FIRST_PARTY_HOST_SUFFIX),
  );
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
  userEmail: string | null | undefined;
  engineName: string;
  defaultModel: string;
  model: string;
  /** The request's effort as submitted; anything but default means a choice. */
  effort: unknown;
  env?: HostedExperimentEnv;
}): HostedModelExperimentResolution | null {
  const userEmail = args.userEmail?.trim();
  if (!userEmail) return null;
  if (args.engineName !== "builder") return null;
  if (args.model !== args.defaultModel) return null;
  if (
    args.effort !== undefined &&
    args.effort !== "auto" &&
    args.effort !== DEFAULT_REASONING_EFFORT
  ) {
    return null;
  }
  if (!isHostedModelExperimentEnabled(args.env)) return null;

  if (hostedModelExperimentBucket(userEmail) >= TREATMENT_PERCENT) {
    return {
      model: args.model,
      assignment: {
        experimentId: HOSTED_MODEL_EXPERIMENT_ID,
        variantId: HOSTED_MODEL_EXPERIMENT_CONTROL.id,
      },
    };
  }
  return {
    model: HOSTED_MODEL_EXPERIMENT_TREATMENT.model,
    effort: HOSTED_MODEL_EXPERIMENT_TREATMENT.effort,
    assignment: {
      experimentId: HOSTED_MODEL_EXPERIMENT_ID,
      variantId: HOSTED_MODEL_EXPERIMENT_TREATMENT.id,
    },
  };
}
