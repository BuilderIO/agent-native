import { deriveAppIdentity } from "./app-identity.js";
import { readEnvConfigLayer } from "./env-layer.js";
import { assertRunLifecycleInvariants } from "./run-lifecycle-invariants.js";
import {
  appConfigSchema,
  type AppConfig,
  type AppConfigInput,
} from "./schema.js";

const LAYER_ORDER = ["env", "legacy", "app"] as const;

type QuestionIntakeEnvironment = {
  enabled?: boolean;
  disabled?: boolean;
};

export type AppConfigLayer = (typeof LAYER_ORDER)[number];

interface AppConfigState {
  layers: Partial<Record<AppConfigLayer, AppConfigInput>>;
  resolved?: AppConfig;
  envSignature?: string;
}

interface AppConfigGlobals {
  __agentNativeAppConfig?: AppConfigState;
}

export const enterpriseAuthAdaptersBuilt =
  process.env.AGENT_NATIVE_BUILD_ENTERPRISE_AUTH !== "false";

const globals = globalThis as typeof globalThis & AppConfigGlobals;
const state: AppConfigState = (globals.__agentNativeAppConfig ??= {
  layers: {},
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function mergeLayers(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const existing = result[key];
    result[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? mergeLayers(existing, value)
        : value;
  }
  return result;
}

function resolve(
  envLayer: Record<string, unknown>,
  questionIntakeEnvironment: QuestionIntakeEnvironment | undefined,
): AppConfig {
  const nonEnvironmentConfig = LAYER_ORDER.filter(
    (layer) => layer !== "env",
  ).reduce<Record<string, unknown>>(
    (merged, layer) =>
      state.layers[layer]
        ? mergeLayers(merged, state.layers[layer] as Record<string, unknown>)
        : merged,
    {},
  );
  const configuredAgent = nonEnvironmentConfig.agent;
  const configuredQuestionIntake = isPlainObject(configuredAgent)
    ? configuredAgent.questionIntake
    : undefined;
  const hasQuestionIntakeConfig =
    isPlainObject(configuredQuestionIntake) &&
    typeof configuredQuestionIntake.experimentId === "string" &&
    typeof configuredQuestionIntake.treatmentInstructions === "string";

  const resolvedEnvLayer = mergeLayers({}, envLayer);
  if (
    hasQuestionIntakeConfig &&
    questionIntakeEnvironment?.enabled !== undefined
  ) {
    const agentLayer = isPlainObject(resolvedEnvLayer.agent)
      ? resolvedEnvLayer.agent
      : (resolvedEnvLayer.agent = {} as Record<string, unknown>);
    const questionIntakeLayer = isPlainObject(agentLayer.questionIntake)
      ? agentLayer.questionIntake
      : (agentLayer.questionIntake = {} as Record<string, unknown>);
    questionIntakeLayer.enabled = questionIntakeEnvironment.enabled;
  }

  state.layers.env = resolvedEnvLayer as AppConfigInput;

  let merged: Record<string, unknown> = {};
  for (const layer of LAYER_ORDER) {
    const value = state.layers[layer];
    if (value) merged = mergeLayers(merged, value as Record<string, unknown>);
  }
  const parsed = appConfigSchema.parse(merged);
  if (
    questionIntakeEnvironment?.disabled === true &&
    parsed.agent.questionIntake
  ) {
    parsed.agent.questionIntake = {
      ...parsed.agent.questionIntake,
      disabled: true,
    };
  }
  assertRunLifecycleInvariants(parsed.agent);
  parsed.app = deriveAppIdentity(parsed.app);
  return parsed;
}

export function readConfigEnvironment(
  embedded: Record<string, string | undefined> = {
    AGENT_NATIVE_RELEASE_MIGRATIONS:
      process.env.AGENT_NATIVE_RELEASE_MIGRATIONS,
    AGENT_NATIVE_BETA_SCHEMA_OWNER: process.env.AGENT_NATIVE_BETA_SCHEMA_OWNER,
    AGENT_NATIVE_BUILD_ANALYTICS_PUBLIC_KEY:
      process.env.AGENT_NATIVE_BUILD_ANALYTICS_PUBLIC_KEY,
    AGENT_NATIVE_BUILD_ANALYTICS_ENDPOINT:
      process.env.AGENT_NATIVE_BUILD_ANALYTICS_ENDPOINT,
    AGENT_NATIVE_BUILD_ENGINE_PACKAGES:
      process.env.AGENT_NATIVE_BUILD_ENGINE_PACKAGES,
    AGENT_NATIVE_BUILD_ID: process.env.AGENT_NATIVE_BUILD_ID,
  },
): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(embedded)) {
    if (!env[key] && value) env[key] = value;
  }
  return env;
}

export function setAppConfigLayer(
  layer: AppConfigLayer,
  config: AppConfigInput,
): void {
  const existing = state.layers[layer];
  const next = existing
    ? (mergeLayers(
        existing as Record<string, unknown>,
        config as Record<string, unknown>,
      ) as AppConfigInput)
    : config;
  appConfigSchema.parse(next);
  state.layers[layer] = next;
  state.resolved = undefined;
}

export function defineAppConfig(config: AppConfigInput): () => void {
  setAppConfigLayer("app", config);
  return () => {};
}

export function getAppConfig(): AppConfig {
  const environment = readConfigEnvironment();
  const questionIntakeEnvironment = (
    readEnvConfigLayer(appConfigSchema, {
      AGENT_QUESTION_INTAKE_EXPERIMENT_ENABLED:
        environment.AGENT_QUESTION_INTAKE_EXPERIMENT_ENABLED,
      AGENT_QUESTION_INTAKE_EXPERIMENT_DISABLED:
        environment.AGENT_QUESTION_INTAKE_EXPERIMENT_DISABLED,
    }).agent as { questionIntake?: QuestionIntakeEnvironment } | undefined
  )?.questionIntake;
  const environmentWithoutQuestionIntakeSwitches = { ...environment };
  delete environmentWithoutQuestionIntakeSwitches.AGENT_QUESTION_INTAKE_EXPERIMENT_ENABLED;
  delete environmentWithoutQuestionIntakeSwitches.AGENT_QUESTION_INTAKE_EXPERIMENT_DISABLED;
  const envLayer = readEnvConfigLayer(
    appConfigSchema,
    environmentWithoutQuestionIntakeSwitches,
  );
  const signature = JSON.stringify({ envLayer, questionIntakeEnvironment });
  if (state.resolved && state.envSignature === signature) return state.resolved;
  state.envSignature = signature;
  return (state.resolved = resolve(envLayer, questionIntakeEnvironment));
}

export function resetAppConfigForTests(): void {
  state.layers = {};
  state.resolved = undefined;
  state.envSignature = undefined;
}
