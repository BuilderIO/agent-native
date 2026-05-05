import { describe, expect, it } from "vitest";
import { classifyDesktopAsset } from "./desktop-latest.json.get";

describe("classifyDesktopAsset", () => {
  it("recognizes Agent Native desktop installers", () => {
    expect(classifyDesktopAsset("Agent-Native-arm64.dmg")).toBe("mac-arm64");
    expect(classifyDesktopAsset("Agent Native-x64.dmg")).toBe("mac-x64");
    expect(classifyDesktopAsset("Agent-Native-x64.exe")).toBe("windows-x64");
    expect(classifyDesktopAsset("Agent-Native-arm64.exe")).toBe(
      "windows-arm64",
    );
    expect(classifyDesktopAsset("Agent-Native-x86_64.AppImage")).toBe(
      "linux-appimage-x64",
    );
    expect(classifyDesktopAsset("Agent-Native-arm64.deb")).toBe(
      "linux-deb-arm64",
    );
  });

  it("ignores package releases and update metadata", () => {
    expect(classifyDesktopAsset("agent-native-core-0.8.2.tgz")).toBe("unknown");
    expect(classifyDesktopAsset("latest-mac.yml")).toBe("unknown");
  });
});
