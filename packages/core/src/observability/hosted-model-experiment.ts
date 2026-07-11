export const HOSTED_DEFAULT_MODEL_EXPERIMENT_ID =
  "hosted-default-model-sonnet-5-vs-gpt-5-6-luna-2026-07";

export const HOSTED_DEFAULT_MODEL_CONTROL = {
  id: "sonnet-5",
  model: "claude-sonnet-5",
  weight: 80,
} as const;

export const HOSTED_DEFAULT_MODEL_TREATMENT = {
  id: "gpt-5-6-luna",
  model: "gpt-5-6-luna",
  weight: 20,
} as const;

export interface HostedDefaultModelExperimentAssignment {
  experimentId: string;
  variantId: string;
}

export interface HostedDefaultModelExperimentResolution {
  model: string;
  assignment: HostedDefaultModelExperimentAssignment;
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
 * The rollout is automatic only on first-party hosted app domains. Operators
 * can explicitly enable or disable it for preview and emergency rollback.
 */
export function isHostedDefaultModelExperimentEnabled(
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
 * Stable cross-app bucket: the same authenticated user receives the same
 * variant in every hosted template for the life of this experiment id.
 */
export function hostedDefaultModelExperimentBucket(userId: string): number {
  const input = `${HOSTED_DEFAULT_MODEL_EXPERIMENT_ID}:${userId.trim().toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export function resolveHostedDefaultModelExperiment(args: {
  userId: string | null | undefined;
  engineName: string;
  isDefaultModelSelection: boolean;
  supportedModels?: readonly string[];
  env?: HostedExperimentEnv;
}): HostedDefaultModelExperimentResolution | null {
  const userId = args.userId?.trim();
  if (!userId) return null;
  if (args.engineName !== "builder") return null;
  if (!args.isDefaultModelSelection) return null;
  if (!isHostedDefaultModelExperimentEnabled(args.env)) return null;

  const variant =
    hostedDefaultModelExperimentBucket(userId) <
    HOSTED_DEFAULT_MODEL_TREATMENT.weight
      ? HOSTED_DEFAULT_MODEL_TREATMENT
      : HOSTED_DEFAULT_MODEL_CONTROL;
  if (args.supportedModels && !args.supportedModels.includes(variant.model)) {
    return null;
  }

  return {
    model: variant.model,
    assignment: {
      experimentId: HOSTED_DEFAULT_MODEL_EXPERIMENT_ID,
      variantId: variant.id,
    },
  };
}
