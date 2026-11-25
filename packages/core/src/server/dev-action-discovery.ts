import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where older versions wrote the discovery file. It sat inside the app root,
 * which the dev server serves, so its bearer token could be fetched over
 * HTTP. Only ever deleted now, never read.
 */
export const LEGACY_DEV_ACTION_DISCOVERY_PATH = path.join(
  ".agent-native",
  "dev-server.json",
);

function canonicalAppRoot(appRoot: string): string {
  try {
    return fs.realpathSync(appRoot);
  } catch {
    // coercion-ok: an unresolvable root still keys one file for server and CLI alike.
    return path.resolve(appRoot);
  }
}

/**
 * The discovery file lives in the user's home directory, keyed by app root:
 * never under a directory the dev server can serve.
 */
export function devActionDiscoveryFilePath(
  appRoot: string,
  homeDir = os.homedir(),
): string {
  const key = crypto
    .createHash("sha256")
    .update(canonicalAppRoot(appRoot))
    .digest("hex")
    .slice(0, 32);
  return path.join(homeDir, ".agent-native", "dev-servers", `${key}.json`);
}

export interface DevActionDiscovery {
  origin: string;
  pid: number;
  token: string;
  databaseKey: string;
}

export function readDevActionDiscoveryFile(
  appRoot: string,
): DevActionDiscovery | undefined {
  const filePath = devActionDiscoveryFilePath(appRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(
        "[agent-native] could not read dev action discovery file:",
        error,
      );
    }
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(
      "[agent-native] dev action discovery file is not valid JSON:",
      error,
    );
    return undefined;
  }

  const candidate = parsed as Partial<DevActionDiscovery> | null;
  if (
    !candidate ||
    typeof candidate.origin !== "string" ||
    !Number.isInteger(candidate.pid) ||
    typeof candidate.token !== "string" ||
    typeof candidate.databaseKey !== "string"
  ) {
    console.warn(
      "[agent-native] dev action discovery file has an unexpected shape; ignoring it",
    );
    return undefined;
  }
  return candidate as DevActionDiscovery;
}
