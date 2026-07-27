import { constants } from "node:fs";
import { access, chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import type { NativeHostConfig } from "./config";

const HOST_NAME = "com.agent_native.dispatch";

export type ChromeNativeHostInstallOptions = {
  extensionId: string;
  executablePath: string;
  bridge: { baseUrl: string; bearerToken: string };
  configPath?: string;
  manifestPath?: string;
};

export type ChromeNativeHostInstallResult = {
  configPath: string;
  manifestPath: string;
};

export async function installChromeNativeHost(
  options: ChromeNativeHostInstallOptions,
): Promise<ChromeNativeHostInstallResult> {
  if (!/^[a-p]{32}$/.test(options.extensionId)) {
    throw new Error(
      "Chrome extension id must contain exactly 32 a-p characters.",
    );
  }
  if (!isAbsolute(options.executablePath)) {
    throw new Error("Native host executable path must be absolute.");
  }
  await access(options.executablePath, constants.X_OK);
  const baseUrl = new URL(options.bridge.baseUrl);
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.hostname !== "127.0.0.1" ||
    baseUrl.pathname !== "/"
  ) {
    throw new Error("Native host bridge must use an HTTP loopback origin.");
  }
  if (
    options.bridge.bearerToken.length < 32 ||
    options.bridge.bearerToken.length > 256
  ) {
    throw new Error("Native host bearer credential is invalid.");
  }

  const configPath = options.configPath ?? defaultConfigPath();
  const manifestPath = options.manifestPath ?? defaultManifestPath();
  const config: NativeHostConfig = {
    version: 1,
    baseUrl: baseUrl.origin,
    bearerToken: options.bridge.bearerToken,
  };
  const manifest = {
    name: HOST_NAME,
    description: "Agent-Native desktop browser control bridge",
    path: options.executablePath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${options.extensionId}/`],
  };

  await writeAtomicJson(configPath, config, 0o600, 0o700);
  await writeAtomicJson(manifestPath, manifest, 0o644, 0o755);
  return { configPath, manifestPath };
}

function defaultConfigPath(): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Agent Native",
    "browser-control",
    "native-host.json",
  );
}

function defaultManifestPath(): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "NativeMessagingHosts",
    `${HOST_NAME}.json`,
  );
}

async function writeAtomicJson(
  path: string,
  value: unknown,
  mode: number,
  directoryMode: number,
): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: directoryMode });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", mode);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
    await chmod(path, mode);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
