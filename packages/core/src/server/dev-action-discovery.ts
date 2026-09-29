import fs from "node:fs";
import path from "node:path";

export const DEV_ACTION_DISCOVERY_PATH = path.join(
  ".agent-native",
  "dev-server.json",
);

export interface DevActionDiscovery {
  origin: string;
  pid: number;
  token: string;
  databaseKey: string;
}

export function readDevActionDiscoveryFile(
  appRoot: string,
): DevActionDiscovery | undefined {
  const filePath = path.join(appRoot, DEV_ACTION_DISCOVERY_PATH);
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
