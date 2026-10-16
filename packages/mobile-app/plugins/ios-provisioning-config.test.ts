import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import configureApp from "../app.config";

const require = createRequire(import.meta.url);
const packageRoot = new URL("..", import.meta.url);

type AppExtensionConfig = {
  bundleIdentifier: string;
  entitlements?: Record<string, unknown>;
  targetName: string;
};

function readPublicExpoConfig({
  appleTeamId = "",
  disableAppExtensions = false,
}: {
  appleTeamId?: string;
  disableAppExtensions?: boolean;
} = {}) {
  const expoCli = require.resolve("expo/bin/cli");
  const output = execFileSync(
    process.execPath,
    [expoCli, "config", "--type", "public", "--json"],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_NATIVE_APPLE_TEAM_ID: appleTeamId,
        AGENT_NATIVE_MOBILE_DISABLE_APP_EXTENSIONS: disableAppExtensions
          ? "1"
          : "",
      },
    },
  );
  return JSON.parse(output) as {
    plugins?: unknown[];
    extra?: {
      eas?: {
        build?: {
          experimental?: {
            ios?: { appExtensions?: AppExtensionConfig[] };
          };
        };
      };
    };
    ios?: {
      appleTeamId?: string;
      entitlements?: Record<string, unknown>;
    };
  };
}

describe("iOS EAS provisioning metadata", () => {
  it("uses the current static config when Expo reloads it in the same process", () => {
    const config = {
      name: "Config reload fixture",
      slug: "config-reload-fixture",
      plugins: ["./plugins/removed-plugin"],
    };
    const context = {
      projectRoot: packageRoot.pathname,
      staticConfigPath: new URL("../app.json", import.meta.url).pathname,
      packageJsonPath: new URL("../package.json", import.meta.url).pathname,
      config,
    };
    expect(configureApp(context).plugins).toContain("./plugins/removed-plugin");
    expect(
      configureApp({ ...context, config: { ...config, plugins: [] } }).plugins,
    ).toEqual([]);
  });

  it("keeps the public config contributor-neutral and declares every Apple target", () => {
    const config = readPublicExpoConfig();
    const appExtensions =
      config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
    const extensionsByBundleId = Object.fromEntries(
      appExtensions.map((extension) => [extension.bundleIdentifier, extension]),
    );

    expect(config.ios?.appleTeamId).toBeUndefined();
    expect(config.plugins).toContainEqual([
      "expo-build-properties",
      expect.objectContaining({ ios: { enableSceneSupport: true } }),
    ]);
    expect(appExtensions).toHaveLength(4);
    expect(extensionsByBundleId).toMatchObject({
      "com.agentnative.mobile.broadcast": {
        targetName: "AgentNativeBroadcast",
      },
      "com.agentnative.mobile.keyboard": {
        targetName: "AgentNativeKeyboard",
      },
      "com.agentnative.mobile.watch": { targetName: "AgentNativeWatch" },
      "com.agentnative.mobile.widgets": { targetName: "AgentNativeWidgets" },
    });

    for (const bundleIdentifier of [
      "com.agentnative.mobile.broadcast",
      "com.agentnative.mobile.keyboard",
      "com.agentnative.mobile.widgets",
    ]) {
      expect(
        extensionsByBundleId[bundleIdentifier]?.entitlements?.[
          "com.apple.security.application-groups"
        ],
      ).toEqual(["group.com.agentnative.mobile"]);
    }
  }, 15_000);

  it("accepts a release team only through the build environment", () => {
    expect(
      readPublicExpoConfig({ appleTeamId: "example-team-id" }).ios?.appleTeamId,
    ).toBe("example-team-id");
  });

  it("can build the main iPhone app without optional extension targets", () => {
    const config = readPublicExpoConfig({ disableAppExtensions: true });
    expect(
      config.extra?.eas?.build?.experimental?.ios?.appExtensions,
    ).toBeUndefined();
    expect(
      config.ios?.entitlements?.["com.apple.security.application-groups"],
    ).toBeUndefined();
  }, 15_000);
});
