import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type NativeHostConfig = {
  version: 1;
  baseUrl: string;
  bearerToken: string;
};

export function defaultNativeHostConfigPath(): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Agent Native",
    "browser-control",
    "native-host.json",
  );
}

export async function readNativeHostConfig(
  path = defaultNativeHostConfigPath(),
): Promise<NativeHostConfig> {
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("Native host config must be readable only by its owner.");
  }
  const value = JSON.parse(
    await readFile(path, "utf8"),
  ) as Partial<NativeHostConfig>;
  if (
    value.version !== 1 ||
    typeof value.baseUrl !== "string" ||
    typeof value.bearerToken !== "string"
  ) {
    throw new Error("Native host config is invalid.");
  }
  const url = new URL(value.baseUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/"
  ) {
    throw new Error("Native host endpoint must be an HTTP loopback origin.");
  }
  if (value.bearerToken.length < 32 || value.bearerToken.length > 256) {
    throw new Error("Native host bearer credential is invalid.");
  }
  return { version: 1, baseUrl: url.origin, bearerToken: value.bearerToken };
}
