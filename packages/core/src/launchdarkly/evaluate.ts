import { getLaunchDarklyClient } from "./client.js";
import { buildLaunchDarklyContext, type LaunchDarklyActor } from "./context.js";

/**
 * Evaluates a LaunchDarkly flag's variation for the given caller.
 *
 * Fails closed to `defaultValue` — never throws — when LaunchDarkly is not
 * configured, the client failed to initialize, or evaluation itself errors. A
 * flag read must never become an availability dependency for its caller.
 */
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

/** Boolean convenience wrapper around {@link getLaunchDarklyVariation}. */
export async function isLaunchDarklyFlagEnabled(
  flagKey: string,
  actor: LaunchDarklyActor,
  defaultValue = false,
): Promise<boolean> {
  return getLaunchDarklyVariation(flagKey, actor, defaultValue);
}

/**
 * Evaluates every flag LaunchDarkly currently has targeting rules for, for the
 * given caller. Returns `{}` (not an error) when LaunchDarkly is unconfigured
 * or unreachable.
 */
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
