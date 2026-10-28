import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger, createServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
  clearAgentNativeBuildConfigMarker,
  readAgentNativeBuildConfigMarker,
  resolveFirstRunOnboardingBuildReplacement,
  resolveHarnessBuildReplacement,
  writeAgentNativeBuildConfigMarker,
} from "./agent-native-config-loader.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent-native config loading", () => {
  it("keeps runtime config imports outside Vite analysis", async () => {
    const warnings: string[] = [];
    const logger = createLogger();
    logger.warn = (message) => warnings.push(message);
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    const server = await createServer({
      root,
      configFile: false,
      customLogger: logger,
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });

    try {
      await server.transformRequest("/src/vite/agent-native-config-loader.ts", {
        ssr: true,
      });
    } finally {
      await server.close();
    }

    expect(warnings.join("\n")).not.toContain(
      "The above dynamic import cannot be analyzed by Vite",
    );
  });

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
  it("embeds the configured mode", () => {
    expect(
      resolveFirstRunOnboardingBuildReplacement(
        { onboarding: { firstRun: "off" } },
        {},
      ),
    ).toBe("off");
    expect(
      resolveFirstRunOnboardingBuildReplacement(
        { onboarding: { firstRun: "connect-and-integrations" } },
        {},
      ),
    ).toBe("connect-and-integrations");
  });

  it("reports unknown when neither config nor env sets onboarding", () => {
    expect(resolveFirstRunOnboardingBuildReplacement({}, {})).toBe("");
  });

  it("lets the client's env override win over the configured mode", () => {
    expect(
      resolveFirstRunOnboardingBuildReplacement(
        { onboarding: { firstRun: "connect" } },
        { VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING: "false" },
      ),
    ).toBe("off");
    expect(
      resolveFirstRunOnboardingBuildReplacement(
        { onboarding: { firstRun: "off" } },
        { VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING: "true" },
      ),
    ).toBe("connect");
  });
});

describe("resolveHarnessBuildReplacement", () => {
  it("embeds the configured setting", () => {
    expect(resolveHarnessBuildReplacement({ harness: true })).toBe("true");
    expect(
      resolveHarnessBuildReplacement({ harness: { runtimes: ["codex"] } }),
    ).toBe(JSON.stringify({ runtimes: ["codex"] }));
  });

  it('embeds null (positively "not configured") when harness is unset', () => {
    expect(resolveHarnessBuildReplacement({})).toBe("null");
  });
});

describe("agent-native build config marker", () => {
  it("round-trips first-run onboarding and harness together", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-marker-"));
    temporaryRoots.push(root);

    expect(readAgentNativeBuildConfigMarker(root)).toBeUndefined();
    writeAgentNativeBuildConfigMarker(root, {
      firstRunOnboarding: "off",
      harness: "true",
    });
    expect(readAgentNativeBuildConfigMarker(root)).toEqual({
      firstRunOnboarding: "off",
      harness: "true",
    });
    writeAgentNativeBuildConfigMarker(root, {
      firstRunOnboarding: "",
      harness: "null",
    });
    expect(readAgentNativeBuildConfigMarker(root)).toEqual({
      firstRunOnboarding: "",
      harness: "null",
    });
  });

  it("drops a previous build's marker when a new build starts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-marker-"));
    temporaryRoots.push(root);
    writeAgentNativeBuildConfigMarker(root, {
      firstRunOnboarding: "off",
      harness: "null",
    });

    clearAgentNativeBuildConfigMarker(root);

    expect(readAgentNativeBuildConfigMarker(root)).toBeUndefined();
    expect(() => clearAgentNativeBuildConfigMarker(root)).not.toThrow();
  });

  it("rejects a marker with an unknown first-run mode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-marker-"));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, ".agent-native"));
    fs.writeFileSync(
      path.join(root, ".agent-native", "build-config.json"),
      JSON.stringify({ firstRunOnboarding: "sometimes", harness: "null" }),
    );

    expect(() => readAgentNativeBuildConfigMarker(root)).toThrow(
      /Invalid agent-native build config marker/,
    );
  });

  it("rejects a marker whose harness field is not a string", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-marker-"));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, ".agent-native"));
    fs.writeFileSync(
      path.join(root, ".agent-native", "build-config.json"),
      JSON.stringify({ firstRunOnboarding: "off", harness: true }),
    );

    expect(() => readAgentNativeBuildConfigMarker(root)).toThrow(
      /Invalid agent-native build config marker/,
    );
  });

  it("rejects a marker whose harness value would not parse at runtime", () => {
    for (const harness of ["not-json", "[1]", "42"]) {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-native-marker-"),
      );
      temporaryRoots.push(root);
      fs.mkdirSync(path.join(root, ".agent-native"));
      fs.writeFileSync(
        path.join(root, ".agent-native", "build-config.json"),
        JSON.stringify({ firstRunOnboarding: "off", harness }),
      );

      expect(() => readAgentNativeBuildConfigMarker(root)).toThrow(
        /Invalid agent-native build config marker/,
      );
    }
  });

  it("rejects a marker that is not valid JSON", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-marker-"));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, ".agent-native"));
    fs.writeFileSync(
      path.join(root, ".agent-native", "build-config.json"),
      "not json",
    );

    expect(() => readAgentNativeBuildConfigMarker(root)).toThrow(
      /Invalid agent-native build config marker/,
    );
  });
});
