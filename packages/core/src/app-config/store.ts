import { deriveAppIdentity } from "./app-identity.js";
import { readEnvConfigLayer } from "./env-layer.js";
import { assertRunLifecycleInvariants } from "./run-lifecycle-invariants.js";
import {
  appConfigSchema,
  type AppConfig,
  type AppConfigInput,
} from "./schema.js";

const LAYER_ORDER = ["env", "legacy", "app"] as const;

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

function resolve(envLayer: Record<string, unknown>): AppConfig {
  state.layers.env = envLayer as AppConfigInput;

  let merged: Record<string, unknown> = {};
  for (const layer of LAYER_ORDER) {
    const value = state.layers[layer];
    if (value) merged = mergeLayers(merged, value as Record<string, unknown>);
  }
  const parsed = appConfigSchema.parse(merged);
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
  const envLayer = readEnvConfigLayer(appConfigSchema, readConfigEnvironment());
  const signature = JSON.stringify(envLayer);
  if (state.resolved && state.envSignature === signature) return state.resolved;
  state.envSignature = signature;
  return (state.resolved = resolve(envLayer));
}

export function resetAppConfigForTests(): void {
  state.layers = {};
  state.resolved = undefined;
  state.envSignature = undefined;
}
