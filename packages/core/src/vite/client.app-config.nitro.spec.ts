import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { agentNative } from "./client.js";

function flatPlugins(plugins: any[] | undefined): any[] {
  return (plugins ?? []).flat().filter(Boolean) as any[];
}

async function buildConfig(options: Parameters<typeof agentNative>[0]) {
  const configPlugin = flatPlugins(agentNative(options)).find(
    (plugin) => plugin?.name === "agent-native-config",
  );
  return (await configPlugin.config(
    {},
    { command: "build", mode: "production" },
  )) as any;
}

/**
 * choosing the Agent-Native theme family answered
 * "This theme family is not enabled for the current app." even though the app
 * config lists both families.
 *
 * The action that saves the choice runs on the server, and it reads the app
 * config through `injectedAgentNativeConfig()`. The client bundle receives that
 * config as a compile-time define; the server bundle received nothing, so the
 * allow list fell back to the default family alone and refused the other one.
 * This check pins the server replacement to the resolved app config, so the
 * server-run action validates against the families the app actually enables.
 */
describe("server bundle carries the app config", () => {
  it("replaces the app-config identifier with the resolved config in the server bundle", async () => {
    const previousCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-nitro-app-config-"),
    );
    fs.writeFileSync(
      path.join(tmpDir, "agent-native.json"),
      JSON.stringify({
        version: 1,
        themeFamily: {
          families: ["original", "agent-native"],
          defaultFamily: "original",
        },
      }),
    );
    try {
      process.chdir(tmpDir);
      const config = await buildConfig({});

      const replaced = config.nitro?.replace?.__AGENT_NATIVE_APP_CONFIG__;
      expect(typeof replaced).toBe("string");
      const serverConfig = JSON.parse(replaced);
      expect(serverConfig.themeFamily).toEqual({
        families: ["original", "agent-native"],
        defaultFamily: "original",
      });

      // The client keeps its own define, and the two must describe the same config.
      expect(
        JSON.parse(String(config.define.__AGENT_NATIVE_APP_CONFIG__)),
      ).toEqual(serverConfig);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps the server replacement a plain object literal", async () => {
    const previousCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-nitro-app-config-"),
    );
    try {
      process.chdir(tmpDir);
      const config = await buildConfig({});
      const replaced = String(
        config.nitro?.replace?.__AGENT_NATIVE_APP_CONFIG__,
      );
      // Nitro substitutes the identifier as raw source, so the value must be a
      // self-contained expression: an object literal, never a bare identifier.
      expect(replaced.startsWith("{")).toBe(true);
      expect(() => new Function(`return (${replaced});`)).not.toThrow();
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
