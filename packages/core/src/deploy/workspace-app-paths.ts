import fs from "node:fs";
import path from "node:path";

import { minimatch } from "minimatch";

import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../vite/agent-native-config-loader.js";

export async function resolveWorkspaceAppPaths(
  root: string,
  configInput?: import("../config.js").AgentNativeConfig,
) {
  const config =
    configInput ??
    (await loadResolvedAgentNativeConfig(
      root,
      createAgentNativeConfigContext("serve", "development"),
    ));
  const workspace = config.deployment?.workspace;
  const appsDir = path.resolve(root, workspace?.appsDirectory ?? "apps");
  const include = workspace?.appInclude;
  return {
    appsDir,
    includes: (name: string) =>
      !include || include.some((pattern) => minimatch(name, pattern)),
  };
}

export function readWorkspaceAppDisplayNames(
  root: string,
): Map<string, string> {
  const file = path.join(root, ".agent-native", "workspace-apps.json");
  if (!fs.existsSync(file)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    apps?: unknown;
  };
  if (!Array.isArray(parsed.apps))
    throw new Error("Workspace app catalog must contain an apps array");
  const names = new Map<string, string>();
  for (const entry of parsed.apps) {
    if (
      entry &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      entry.name.trim()
    )
      names.set(entry.id, entry.name.trim());
  }
  return names;
}
