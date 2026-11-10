/**
 * The app's `runtime.environment.required` names, as the build embedded them,
 * for the `/_agent-native/ping?configuration=1` probe.
 *
 * A deployed server never has `agent-native.config.ts` to read, so the build
 * embeds the resolved list by literal replacement, as it does for the hosted
 * harness setting. A build always records a list, even an empty one; nothing
 * recorded means a dev server, where `required-env-config.ts` reads the config
 * from disk instead. The probe never takes names from the request: that would
 * let anyone ask whether a deployment has a given variable set.
 */
export interface RequiredEnvBuildConfig {
  recorded: boolean;
  names: string[];
}

export function readRequiredEnvBuildConfig(): RequiredEnvBuildConfig {
  // config-ok: embedded at build time by literal replacement (see module comment)
  const raw = process.env.AGENT_NATIVE_BUILD_REQUIRED_ENV;
  if (raw === undefined || raw === "") return { recorded: false, names: [] };
  return { recorded: true, names: parseRequiredEnvBuildValue(raw) };
}

export function parseRequiredEnvBuildValue(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid embedded AGENT_NATIVE_BUILD_REQUIRED_ENV value: ${raw}`,
      { cause: error },
    );
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((key): key is string => typeof key === "string")
  ) {
    throw new Error(
      `Invalid embedded AGENT_NATIVE_BUILD_REQUIRED_ENV value: ${raw}`,
    );
  }
  return parsed;
}
