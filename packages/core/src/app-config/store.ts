import { readEnvConfigLayer } from "./env-layer.js";
import {
  appConfigSchema,
  type AppConfig,
  type AppConfigInput,
} from "./schema.js";

/**
 * Resolution order for app configuration, lowest opinion first.
 *
 * `legacy` is where the bespoke `configure*` / `set*` setters this schema
 * replaces write their values, so a deprecated call still works and still has
 * a stated position rather than whichever `if` happens to run first.
 */
const LAYER_ORDER = ["env", "legacy", "app"] as const;

export type AppConfigLayer = (typeof LAYER_ORDER)[number];

interface AppConfigState {
  layers: Partial<Record<AppConfigLayer, AppConfigInput>>;
  resolved?: AppConfig;
  /** Serialized env layer the cached `resolved` was built from. */
  envSignature?: string;
}

interface AppConfigGlobals {
  __agentNativeAppConfig?: AppConfigState;
}

// Same reason the provider registries do this: core can be loaded more than
// once in a dev server or a dual-format build, and a config set by a plugin
// has to be visible to a reader that resolved a different copy of the module.
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

/**
 * Merges `override` onto `base`, recursing into domain subobjects so two
 * layers can each set a different field of the same domain. Functions, arrays,
 * and scalars replace rather than merge.
 */
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
  return appConfigSchema.parse(merged);
}

/**
 * Writes one layer of the ladder. Framework-internal: the deprecated setters
 * use it to keep working without reintroducing a second namespace.
 */
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
  // Validate where the value is set, so a bad value names the call site that
  // set it instead of whichever unrelated read happened to run first.
  appConfigSchema.parse(next);
  state.layers[layer] = next;
  state.resolved = undefined;
}

/**
 * Sets this app's server configuration.
 *
 * Call it from a server plugin. Values given here beat any environment
 * variable aliased to the same field. Calling it more than once merges, so an
 * app can split its configuration by domain across plugin files.
 */
export function defineAppConfig(config: AppConfigInput): void {
  setAppConfigLayer("app", config);
}

/**
 * The resolved configuration, with declared defaults applied.
 *
 * The parsed result is cached, but the env layer is rebuilt each call and the
 * cache is dropped when it differs. Re-reading a handful of declared keys is
 * cheap next to re-parsing the schema, and caching the env read outright would
 * mean whichever code path ran first froze the configuration for the process —
 * a stale value nobody can see, which is the failure this module exists to
 * remove.
 */
export function getAppConfig(): AppConfig {
  const envLayer = readEnvConfigLayer(appConfigSchema, process.env);
  const signature = JSON.stringify(envLayer);
  if (state.resolved && state.envSignature === signature) return state.resolved;
  state.envSignature = signature;
  return (state.resolved = resolve(envLayer));
}

/**
 * Drops every layer and the resolved cache.
 *
 * The resolved object is cached on first read, so a test that mutates
 * `process.env` between cases has to call this to be seen.
 */
export function resetAppConfigForTests(): void {
  state.layers = {};
  state.resolved = undefined;
  state.envSignature = undefined;
}
