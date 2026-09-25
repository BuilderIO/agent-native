import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
  resolveFirstRunOnboardingBuildReplacement,
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

  it("lets environment fragments override an explicit project config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    const previousRuntime = process.env.AGENT_NATIVE_CONFIG_RUNTIME;
    process.env.AGENT_NATIVE_CONFIG_RUNTIME = JSON.stringify({
      auth: { enabled: false },
      database: { required: false },
    });

    try {
      await expect(
        loadResolvedAgentNativeConfig(
          root,
          createAgentNativeConfigContext("serve", "test"),
          {
            projectConfig: { runtime: { auth: { enabled: true } } },
          },
        ),
      ).resolves.toEqual({
        runtime: {
          auth: { enabled: false },
          database: { required: false },
        },
      });
    } finally {
      if (previousRuntime === undefined) {
        delete process.env.AGENT_NATIVE_CONFIG_RUNTIME;
      } else {
        process.env.AGENT_NATIVE_CONFIG_RUNTIME = previousRuntime;
      }
    }
  });

  it("accepts Vite-loaded environment values for secondary config consumers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);

    await expect(
      loadResolvedAgentNativeConfig(
        root,
        createAgentNativeConfigContext("build", "production"),
        {
          environment: {
            AGENT_NATIVE_CONFIG_TRANSLATIONS_LOCALES: JSON.stringify([
              "en-US",
              "es-ES",
            ]),
          },
        },
      ),
    ).resolves.toEqual({
      translations: { locales: ["en-US", "es-ES"] },
    });
  });

  it("does not let the legacy deployment variable override explicit JSON config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    fs.writeFileSync(
      path.join(root, "agent-native.json"),
      JSON.stringify({ deployment: { environment: "production" } }),
    );

    await expect(
      loadResolvedAgentNativeConfig(
        root,
        createAgentNativeConfigContext("build", "production"),
        { environment: { AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "beta" } },
      ),
    ).resolves.toEqual({ deployment: { environment: "production" } });
  });
});

describe("resolveFirstRunOnboardingBuildReplacement", () => {
  it("resolves 'off' for a project whose agent-native.json turns onboarding off", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    fs.writeFileSync(
      path.join(root, "agent-native.json"),
      JSON.stringify({ onboarding: { firstRun: "off" } }),
    );

    expect(resolveFirstRunOnboardingBuildReplacement(root, {})).toBe("off");
  });

  it("resolves the production mode for a per-environment setting", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    fs.writeFileSync(
      path.join(root, "agent-native.json"),
      JSON.stringify({
        onboarding: {
          firstRun: {
            development: "off",
            production: "connect-and-integrations",
          },
        },
      }),
    );

    expect(
      resolveFirstRunOnboardingBuildReplacement(root, {
        NODE_ENV: "production",
      }),
    ).toBe("connect-and-integrations");
    expect(
      resolveFirstRunOnboardingBuildReplacement(root, {
        NODE_ENV: "development",
      }),
    ).toBe("off");
  });

  it("reports unknown for a project that does not configure onboarding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);

    expect(resolveFirstRunOnboardingBuildReplacement(root, {})).toBe("");
  });

  it("reports unknown when a TS config could override agent-native.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    fs.writeFileSync(
      path.join(root, "agent-native.json"),
      JSON.stringify({ onboarding: { firstRun: "off" } }),
    );
    fs.writeFileSync(
      path.join(root, "agent-native.config.ts"),
      `export default ${JSON.stringify({ onboarding: { firstRun: "connect" } })};\n`,
    );

    expect(resolveFirstRunOnboardingBuildReplacement(root, {})).toBe("");
  });

  it("lets the client's env override win over the configured mode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    fs.writeFileSync(
      path.join(root, "agent-native.json"),
      JSON.stringify({ onboarding: { firstRun: "connect" } }),
    );

    expect(
      resolveFirstRunOnboardingBuildReplacement(root, {
        VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING: "false",
      }),
    ).toBe("off");
  });

  it("embeds '' (unknown) instead of guessing when agent-native.json is malformed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-config-"));
    temporaryRoots.push(root);
    fs.writeFileSync(path.join(root, "agent-native.json"), "{ not valid json");

    expect(resolveFirstRunOnboardingBuildReplacement(root, {})).toBe("");
  });
});
