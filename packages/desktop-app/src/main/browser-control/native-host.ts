import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENT_NATIVE_CHROME_EXTENSION_ID =
  "oflpdgfpegnhakjociddiffecjnbnnad";
export const AGENT_NATIVE_BROWSER_HOST_NAME = "com.agent_native.dispatch";

export interface InstallBrowserNativeHostOptions {
  baseUrl: string;
  bearerToken: string;
  executablePath: string;
  hostEntryPath: string;
  stateDirectory: string;
  homeDirectory?: string;
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
  writePrivateJson(manifestPath, {
    name: AGENT_NATIVE_BROWSER_HOST_NAME,
    description: "Agent Native browser control bridge",
    path: launcherPath,
    type: "stdio",
    allowed_origins: [
      `chrome-extension://${AGENT_NATIVE_CHROME_EXTENSION_ID}/`,
    ],
  });
  return { manifestPath, launcherPath, configPath };
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
