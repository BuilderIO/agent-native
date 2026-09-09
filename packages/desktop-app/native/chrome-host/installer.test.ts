import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installChromeNativeHost } from "./installer";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Chrome native host installer", () => {
  it("writes an owner-only config and one exact allowed extension origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-native-chrome-host-"));
    roots.push(root);
    const executablePath = join(root, "agent-native-chrome-host");
    const configPath = join(root, "private", "native-host.json");
    const manifestPath = join(root, "chrome", "com.agent_native.dispatch.json");
    await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(executablePath, 0o700);

    await installChromeNativeHost({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      executablePath,
      bridge: {
        baseUrl: "http://127.0.0.1:43123",
        bearerToken: "example-browser-host-token-32-chars-long",
      },
      configPath,
      manifestPath,
    });

    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      version: 1,
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "example-browser-host-token-32-chars-long",
    });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      name: "com.agent_native.dispatch",
      path: executablePath,
      type: "stdio",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    });
    expect(JSON.stringify(manifest)).not.toContain("*");
  });

  it("rejects wildcard-like ids and non-loopback bridge URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-native-chrome-host-"));
    roots.push(root);
    const executablePath = join(root, "host");
    await writeFile(executablePath, "host", "utf8");
    await chmod(executablePath, 0o700);
    const base = {
      executablePath,
      bridge: {
        baseUrl: "http://127.0.0.1:1234",
        bearerToken: "example-browser-host-token-32-chars-long",
      },
      configPath: join(root, "config.json"),
      manifestPath: join(root, "manifest.json"),
    };

    await expect(
      installChromeNativeHost({ ...base, extensionId: "*" }),
    ).rejects.toThrow(/extension id/);
    await expect(
      installChromeNativeHost({
        ...base,
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        bridge: { ...base.bridge, baseUrl: "http://localhost:1234" },
      }),
    ).rejects.toThrow(/loopback/);
  });
});
