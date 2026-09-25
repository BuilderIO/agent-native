/**
 * The server's single reader of the build-embedded hosted harness setting.
 *
 * The setting is resolved once, at build time, from the same resolved app
 * config the browser bundle is built from (`resolvedAppConfig.harness` in
 * `vite/client.ts`), then embedded into the server bundle as a literal
 * environment read of `AGENT_NATIVE_BUILD_HARNESS` (Vite `define`, Nitro
 * `replace`, and the deploy build's own replacement map — see
 * `resolveHarnessBuildReplacement` in `vite/agent-native-config-loader.ts`).
 * A runtime read of `agent-native.json` / `agent-native.config.ts` is not an
 * option: neither file is shipped into a deployed server function, so
 * resolving "absent" would read the same as "not configured" and silently
 * disable the hosted harness for every app that only sets `harness` in its
 * TS config (chat, mail, analytics, calendar).
 *
 * Keep this the only environment read of that key.
 */
import type { AgentNativeHarnessSetting } from "../config.js";

export interface HostedHarnessBuildConfig {
  /**
   * false when the build did not embed a value — an older core, or a build
   * that never ran the Vite/deploy config hook. The caller must then fall
   * back to a runtime read (dev server, or `agent-native start` from the app
   * directory, where the config file actually exists on disk).
   */
  recorded: boolean;
  value: AgentNativeHarnessSetting | undefined;
}

export function readHostedHarnessBuildConfig(): HostedHarnessBuildConfig {
  // config-ok: embedded at build time by literal replacement (see module comment)
  const raw = process.env.AGENT_NATIVE_BUILD_HARNESS;
  if (raw === undefined || raw === "") {
    return { recorded: false, value: undefined };
  }

  return { recorded: true, value: parseHostedHarnessBuildValue(raw) };
}

/**
 * Parses a recorded harness value (`null`, a boolean, or a settings object).
 * The build validates its marker with this too, so a malformed value fails the
 * build instead of the deployed runtime.
 */
export function parseHostedHarnessBuildValue(
  raw: string,
): AgentNativeHarnessSetting | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid embedded AGENT_NATIVE_BUILD_HARNESS value: ${raw}`,
      {
        cause: error,
      },
    );
  }
  if (parsed === null) return undefined;
  if (typeof parsed === "boolean") return parsed;
  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as AgentNativeHarnessSetting;
  }
  throw new Error(`Invalid embedded AGENT_NATIVE_BUILD_HARNESS value: ${raw}`);
}
