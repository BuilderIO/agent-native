import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const packageRoot = new URL("..", import.meta.url);

type AppExtensionConfig = {
  bundleIdentifier: string;
  entitlements?: Record<string, unknown>;
  targetName: string;
};

function readPublicExpoConfig(appleTeamId = "") {
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
      },
    },
  );
  return JSON.parse(output) as {
    extra?: {
      eas?: {
        build?: {
          experimental?: {
            ios?: { appExtensions?: AppExtensionConfig[] };
          };
        };
      };
    };
    ios?: { appleTeamId?: string };
  };
}

describe("iOS EAS provisioning metadata", () => {
  it("keeps the public config contributor-neutral and declares every Apple target", () => {
    const config = readPublicExpoConfig();
    const appExtensions =
      config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
    const extensionsByBundleId = Object.fromEntries(
      appExtensions.map((extension) => [extension.bundleIdentifier, extension]),
    );

    expect(config.ios?.appleTeamId).toBeUndefined();
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
    expect(readPublicExpoConfig("example-team-id").ios?.appleTeamId).toBe(
      "example-team-id",
    );
  }, 15_000);
});
