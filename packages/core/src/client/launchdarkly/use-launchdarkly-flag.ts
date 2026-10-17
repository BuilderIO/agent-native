import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

interface GetLaunchDarklyFlagsResult {
  flags?: Record<string, unknown>;
}

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
