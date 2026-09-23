import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

interface GetLaunchDarklyFlagsResult {
  flags?: Record<string, unknown>;
}

/**
 * Returns the current user's evaluated value for a LaunchDarkly boolean flag.
 *
 * Reads through the `get-launchdarkly-flags` action rather than a
 * LaunchDarkly client-side SDK, so no LaunchDarkly key or client-side ID ever
 * reaches the browser. `get-launchdarkly-flags` requires a real session —
 * gating on it avoids firing a request that 401s for every signed-out
 * visitor; the flag defaults to `defaultValue` with no data either way.
 */
export function useLaunchDarklyFlag(
  key: string,
  defaultValue = false,
): boolean {
  const { status } = useSession();
  const query = useActionQuery<GetLaunchDarklyFlagsResult>(
    "get-launchdarkly-flags" as never,
    { keys: [key], defaultValue } as never,
    { enabled: status === "authenticated" },
  );
  const value = query.data?.flags?.[key];
  return typeof value === "boolean" ? value : defaultValue;
}

/**
 * Returns evaluated values for several LaunchDarkly flags in one request.
 */
export function useLaunchDarklyFlags(
  keys: readonly string[],
  defaultValue = false,
): Record<string, boolean> {
  const { status } = useSession();
  const query = useActionQuery<GetLaunchDarklyFlagsResult>(
    "get-launchdarkly-flags" as never,
    { keys, defaultValue } as never,
    { enabled: status === "authenticated" && keys.length > 0 },
  );
  const flags = query.data?.flags ?? {};
  return Object.fromEntries(
    keys.map((key) => [
      key,
      typeof flags[key] === "boolean" ? (flags[key] as boolean) : defaultValue,
    ]),
  );
}
