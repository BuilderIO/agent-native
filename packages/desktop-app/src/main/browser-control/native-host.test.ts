import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_NATIVE_BROWSER_HOST_NAME,
  AGENT_NATIVE_CHROME_EXTENSION_ID,
  installBrowserNativeHost,
} from "./native-host";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("installBrowserNativeHost", () => {
  it("installs a private launcher and exact-extension Chrome manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-host-"));
    directories.push(root);
    const installed = installBrowserNativeHost({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "x".repeat(43),
      executablePath:
        "/Applications/Agent Native.app/Contents/MacOS/Agent Native",
      hostEntryPath: "/example/app.asar/out/main/browser-control-host.js",
      stateDirectory: path.join(root, "state"),
      homeDirectory: path.join(root, "home"),
    });
    const manifest = JSON.parse(
      fs.readFileSync(installed.manifestPath, "utf8"),
    );
    expect(path.basename(installed.manifestPath)).toBe(
      `${AGENT_NATIVE_BROWSER_HOST_NAME}.json`,
    );
    expect(manifest).toMatchObject({
      name: AGENT_NATIVE_BROWSER_HOST_NAME,
      path: installed.launcherPath,
      allowed_origins: [
        `chrome-extension://${AGENT_NATIVE_CHROME_EXTENSION_ID}/`,
      ],
    });
    expect(fs.statSync(installed.configPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(installed.launcherPath).mode & 0o777).toBe(0o700);
  });

  it("rejects non-loopback bridge configuration", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-host-"));
    directories.push(root);
    expect(() =>
      installBrowserNativeHost({
        baseUrl: "https://example.com",
        bearerToken: "x".repeat(43),
        executablePath: "/example/electron",
        hostEntryPath: "/example/host.js",
        stateDirectory: path.join(root, "state"),
        homeDirectory: path.join(root, "home"),
      }),
    ).toThrow("loopback");
  });
});
