import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENT_NATIVE_CHROME_EXTENSION_ID =
  "oflpdgfpegnhakjociddiffecjnbnnad";
export const AGENT_NATIVE_BROWSER_HOST_NAME = "com.agent_native.dispatch";
export const AGENT_NATIVE_BROWSER_EXTENSION_IDS_ENV =
  "AGENT_NATIVE_BROWSER_EXTENSION_IDS";

export interface InstallBrowserNativeHostOptions {
  baseUrl: string;
  bearerToken: string;
  executablePath: string;
  hostEntryPath: string;
  stateDirectory: string;
  homeDirectory?: string;
  additionalExtensionIds?: readonly string[];
}

export function installBrowserNativeHost(
  options: InstallBrowserNativeHostOptions,
): { manifestPath: string; launcherPath: string; configPath: string } {
  const stateDirectory = path.resolve(options.stateDirectory);
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const configPath = path.join(stateDirectory, "native-host-config.json");
  const launcherPath = path.join(stateDirectory, "native-host-launcher.sh");
  writePrivateJson(configPath, {
    baseUrl: assertLoopbackBaseUrl(options.baseUrl),
    bearerToken: options.bearerToken,
  });
  fs.writeFileSync(
    launcherPath,
    `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${shellQuote(options.executablePath)} ${shellQuote(options.hostEntryPath)} ${shellQuote(configPath)} "$@"\n`,
    { mode: 0o700 },
  );
  fs.chmodSync(launcherPath, 0o700);

  const manifestDirectory = path.join(
    options.homeDirectory ?? os.homedir(),
    "Library/Application Support/Google/Chrome/NativeMessagingHosts",
  );
  fs.mkdirSync(manifestDirectory, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(
    manifestDirectory,
    `${AGENT_NATIVE_BROWSER_HOST_NAME}.json`,
  );
  const extensionIds = [
    AGENT_NATIVE_CHROME_EXTENSION_ID,
    ...(options.additionalExtensionIds ?? []),
  ];
  writePrivateJson(manifestPath, {
    name: AGENT_NATIVE_BROWSER_HOST_NAME,
    description: "Agent Native browser control bridge",
    path: launcherPath,
    type: "stdio",
    allowed_origins: exactExtensionOrigins(extensionIds),
  });
  return { manifestPath, launcherPath, configPath };
}

function exactExtensionOrigins(extensionIds: readonly string[]): string[] {
  const unique = [...new Set(extensionIds)];
  if (unique.length > 16) {
    throw new Error(
      "Browser native host cannot allow more than 16 extensions.",
    );
  }
  for (const extensionId of unique) assertChromeExtensionId(extensionId);
  return unique.map((extensionId) => `chrome-extension://${extensionId}/`);
}

export function parseAdditionalChromeExtensionIds(
  value: string | undefined,
): string[] {
  if (!value?.trim()) return [];
  const extensionIds = [
    ...new Set(
      value
        .split(",")
        .map((extensionId) => extensionId.trim())
        .filter(Boolean),
    ),
  ];
  if (extensionIds.length > 15) {
    throw new Error(
      "Browser native host cannot allow more than 15 additional extensions.",
    );
  }
  for (const extensionId of extensionIds) assertChromeExtensionId(extensionId);
  return extensionIds;
}

function assertChromeExtensionId(extensionId: string): void {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(
      "Chrome extension id must contain exactly 32 a-p characters.",
    );
  }
}

function assertLoopbackBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/"
  ) {
    throw new Error("Browser bridge must use a loopback base URL.");
  }
  return url.origin;
}

function writePrivateJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
