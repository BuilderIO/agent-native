import { getLaunchDarklyClient } from "./client.js";
import { buildLaunchDarklyContext, type LaunchDarklyActor } from "./context.js";

// Fails closed to `defaultValue` — never throws — because a flag read must
// never become an availability dependency for its caller.
export async function getLaunchDarklyVariation<T>(
  flagKey: string,
  actor: LaunchDarklyActor,
  defaultValue: T,
): Promise<T> {
  try {
    const client = await getLaunchDarklyClient();
    if (!client) return defaultValue;
    const context = buildLaunchDarklyContext(actor);
    return (await client.variation(flagKey, context, defaultValue)) as T;
  } catch (error) {
    console.warn(`[launchdarkly] failed to evaluate flag "${flagKey}"`, error);
    return defaultValue;
  }
}

// Uses `boolVariation` rather than the generic `variation()` cast above — the
// SDK itself falls back to `defaultValue` when the dashboard flag isn't
// actually boolean-typed, instead of handing a truthy non-boolean (e.g. the
// string `"false"`) to a caller's `if (enabled)` gate.
export async function isLaunchDarklyFlagEnabled(
  flagKey: string,
  actor: LaunchDarklyActor,
  defaultValue = false,
): Promise<boolean> {
  try {
    const client = await getLaunchDarklyClient();
    if (!client) return defaultValue;
    const context = buildLaunchDarklyContext(actor);
    return await client.boolVariation(flagKey, context, defaultValue);
  } catch (error) {
    console.warn(`[launchdarkly] failed to evaluate flag "${flagKey}"`, error);
    return defaultValue;
  }
}

export async function getAllLaunchDarklyFlags(
  actor: LaunchDarklyActor,
): Promise<Record<string, unknown>> {
  try {
    const client = await getLaunchDarklyClient();
    if (!client) return {};
    const context = buildLaunchDarklyContext(actor);
    const state = await client.allFlagsState(context);
    return state.valid ? state.allValues() : {};
  } catch (error) {
    console.warn("[launchdarkly] failed to evaluate all flags", error);
    return {};
  }
}
