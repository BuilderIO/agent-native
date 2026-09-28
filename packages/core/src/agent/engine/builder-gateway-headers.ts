import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let cachedCoreVersion: string | null = null;

/** @internal */
export function getAgentNativeCorePackageVersion(): string {
  if (cachedCoreVersion !== null) return cachedCoreVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "../../../package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    cachedCoreVersion =
      typeof pkg.version === "string" && pkg.version.length > 0
        ? pkg.version
        : "unknown";
  } catch {
    cachedCoreVersion = "unknown";
  }
  return cachedCoreVersion;
}

export function getBuilderGatewayClientVersion(): string {
  const v = getAgentNativeCorePackageVersion();
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.AGENT_NATIVE_BUILD_SHA?.trim() ||
    "";
  return sha.length >= 7 ? `${v}+${sha.slice(0, 7)}` : v;
}

export function getBuilderGatewayRequestHeaders(): Record<string, string> {
  return {
    "x-client-name": "@agent-native/core",
    "x-client-version": getBuilderGatewayClientVersion(),
  };
}
