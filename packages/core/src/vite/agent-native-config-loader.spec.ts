import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "./agent-native-config-loader.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent-native config loading", () => {
  it("inherits workspace config and lets an app override its policy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    const appDir = path.join(root, "apps", "mail");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "workspace",
        "agent-native": { workspaceCore: "@workspace/shared" },
      }),
    );
    fs.writeFileSync(
      path.join(root, "agent-native.mts"),
      `export default ${JSON.stringify({
        translations: { locales: ["en-US", "es-ES"] },
        changelog: { enabled: false },
      })};\n`,
    );
    fs.writeFileSync(
      path.join(appDir, "agent-native.mts"),
      `export default ${JSON.stringify({
        translations: { locales: ["en-US", "fr-FR"] },
      })};\n`,
    );

    await expect(
      loadResolvedAgentNativeConfig(
        appDir,
        createAgentNativeConfigContext("serve", "test"),
      ),
    ).resolves.toEqual({
      translations: { locales: ["en-US", "fr-FR"] },
      changelog: { enabled: false },
    });
  });
});
