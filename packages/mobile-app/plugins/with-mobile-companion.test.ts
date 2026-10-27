import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { addIosShortcutRouting } from "./with-mobile-companion";

const require = createRequire(import.meta.url);
const EXPO_TEMPLATE_ARCHIVE_PATHS = {
  appDelegate: "package/ios/HelloWorld/AppDelegate.swift",
  sceneDelegate: "package/ios/HelloWorld/SceneDelegate.swift",
};
const expoTemplateArchive = require.resolve("expo/template.tgz");
const expoSdk58AppDelegate = readFileSync(
  new URL("./fixtures/expo-sdk-58.0.19/AppDelegate.swift", import.meta.url),
  "utf8",
);
const expoSdk58SceneDelegate = readFileSync(
  new URL("./fixtures/expo-sdk-58.0.19/SceneDelegate.swift", import.meta.url),
  "utf8",
);

function readPinnedExpoTemplate(path: string) {
  return execFileSync("tar", ["-xOzf", expoTemplateArchive, path], {
    encoding: "utf8",
  });
}

describe("with-mobile-companion iOS template anchors", () => {
  it("keeps its fixture identical to the pinned Expo template archive", () => {
    expect(
      expoSdk58AppDelegate,
      "Refresh plugins/fixtures/expo-sdk-58.0.19 from expo/template.tgz when upgrading Expo.",
    ).toBe(readPinnedExpoTemplate(EXPO_TEMPLATE_ARCHIVE_PATHS.appDelegate));
    expect(expoSdk58SceneDelegate).toBe(
      readPinnedExpoTemplate(EXPO_TEMPLATE_ARCHIVE_PATHS.sceneDelegate),
    );
  });

  it("queues allowlisted quick actions through the Expo SDK 58 scene callback", () => {
    const result = addIosShortcutRouting(expoSdk58AppDelegate);

    expect(result).toContain("enum AgentNativeShortcutRouter");
    expect(result).toContain("performActionFor shortcutItem");
    expect(result).toContain(
      "AgentNativeIOSCompanion.enqueueQuickActionPath(path)",
    );
    expect(result).toContain('return "/" + host + url.path');
    expect(result).not.toContain("agentNativeLaunchOptions");
    expect(result).not.toContain("RCTLinkingManager.application");
    expect(result.indexOf("performActionFor shortcutItem")).toBeLessThan(
      result.indexOf("class ReactNativeDelegate"),
    );
  });

  it("is idempotent", () => {
    const once = addIosShortcutRouting(expoSdk58AppDelegate);
    expect(addIosShortcutRouting(once)).toBe(once);
  });

  it("fails closed when Expo changes the AppDelegate anchors", () => {
    expect(() =>
      addIosShortcutRouting(
        expoSdk58AppDelegate.replace("@main", "@main_removed"),
      ),
    ).toThrow(/Failed to match/);
  });
});
