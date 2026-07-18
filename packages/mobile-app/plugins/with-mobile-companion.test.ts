import { describe, expect, it } from "vitest";

import { addIosShortcutRouting } from "./with-mobile-companion";

const EXPO_SDK_57_APP_DELEGATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    true
  }
}
`;

describe("with-mobile-companion iOS template anchors", () => {
  it("routes cold and warm quick actions against the Expo SDK 57 AppDelegate", () => {
    const result = addIosShortcutRouting(EXPO_SDK_57_APP_DELEGATE);

    expect(result).toContain("private enum AgentNativeShortcutRouter");
    expect(result).toContain("launchOptions: agentNativeLaunchOptions");
    expect(result).toContain("performActionFor shortcutItem");
    expect(result).toContain(
      "return agentNativeShortcutURL == nil ? didFinish : false",
    );
  });

  it("is idempotent", () => {
    const once = addIosShortcutRouting(EXPO_SDK_57_APP_DELEGATE);
    expect(addIosShortcutRouting(once)).toBe(once);
  });

  it("fails closed when Expo changes the AppDelegate anchors", () => {
    expect(() =>
      addIosShortcutRouting(
        EXPO_SDK_57_APP_DELEGATE.replace(
          "    let delegate = ReactNativeDelegate()",
          "    let delegate = NewReactNativeDelegate()",
        ),
      ),
    ).toThrow(/Failed to match/);
  });
});
