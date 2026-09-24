import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

interface GetLaunchDarklyFlagsResult {
  flags?: Record<string, unknown>;
}

// Reads through the `get-launchdarkly-flags` action rather than a
// LaunchDarkly client-side SDK, so no LaunchDarkly key ever reaches the
// browser. Requires a real session — gating on it avoids firing a request
// that 401s for every signed-out visitor.
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
  // Disabling the query on logout stops new requests but React Query keeps
  // the last successful result cached, so a signed-out read must ignore it
  // rather than surface the previous user's evaluated flag.
  if (status !== "authenticated") return defaultValue;
  const value = query.data?.flags?.[key];
  return typeof value === "boolean" ? value : defaultValue;
}

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
  const flags = status === "authenticated" ? (query.data?.flags ?? {}) : {};
  return Object.fromEntries(
    keys.map((key) => [
      key,
      typeof flags[key] === "boolean" ? (flags[key] as boolean) : defaultValue,
    ]),
  );
}
