import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { addIosShortcutRouting } from "./with-mobile-companion";

const require = createRequire(import.meta.url);
const EXPO_APP_DELEGATE_ARCHIVE_PATH =
  "package/ios/HelloWorld/AppDelegate.swift";
const expoTemplateArchive = require.resolve("expo/template.tgz");
const expoSdk57AppDelegate = readFileSync(
  new URL("./fixtures/expo-sdk-57.0.6/AppDelegate.swift", import.meta.url),
  "utf8",
);

function readPinnedExpoAppDelegate() {
  return execFileSync(
    "tar",
    ["-xOzf", expoTemplateArchive, EXPO_APP_DELEGATE_ARCHIVE_PATH],
    { encoding: "utf8" },
  );
}

describe("with-mobile-companion iOS template anchors", () => {
  it("keeps its fixture identical to the pinned Expo template archive", () => {
    expect(
      expoSdk57AppDelegate,
      "Refresh plugins/fixtures/expo-sdk-57.0.6 from expo/template.tgz when upgrading Expo.",
    ).toBe(readPinnedExpoAppDelegate());
  });

  it("routes cold and warm quick actions against the Expo SDK 57 AppDelegate", () => {
    const result = addIosShortcutRouting(expoSdk57AppDelegate);

    expect(result).toContain("private enum AgentNativeShortcutRouter");
    expect(result).toContain("launchOptions: agentNativeLaunchOptions");
    expect(result).toContain("performActionFor shortcutItem");
    expect(result).toContain(
      "return agentNativeShortcutURL == nil ? didFinish : false",
    );
  });

  it("is idempotent", () => {
    const once = addIosShortcutRouting(expoSdk57AppDelegate);
    expect(addIosShortcutRouting(once)).toBe(once);
  });

  it("fails closed when Expo changes the AppDelegate anchors", () => {
    expect(() =>
      addIosShortcutRouting(
        expoSdk57AppDelegate.replace(
          "    let delegate = ReactNativeDelegate()",
          "    let delegate = NewReactNativeDelegate()",
        ),
      ),
    ).toThrow(/Failed to match/);
  });
});
