import type { AgentNativeHarnessSetting } from "../config.js";

export interface HostedHarnessBuildConfig {
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
