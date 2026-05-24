import { describe, expect, it } from "vitest";
import {
  classifyDesktopAsset,
  isDesktopUpdateMetadataAsset,
  isDesktopUpdaterAsset,
} from "../../../lib/desktop-releases";

describe("classifyDesktopAsset", () => {
  it("recognizes Agent Native desktop installers", () => {
    expect(classifyDesktopAsset("Agent-Native-arm64.dmg")).toBe("mac-arm64");
    expect(classifyDesktopAsset("Agent Native-x64.dmg")).toBe("mac-x64");
    expect(classifyDesktopAsset("Agent-Native-x64.exe")).toBe("windows-x64");
    expect(classifyDesktopAsset("Agent-Native-arm64.exe")).toBe(
      "windows-arm64",
    );
    expect(classifyDesktopAsset("Agent-Native-x64.tar.xz")).toBe(
      "linux-tar-x64",
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

  it("recognizes updater metadata and blockmaps for the filtered feed", () => {
    expect(isDesktopUpdateMetadataAsset("latest-mac.yml")).toBe(true);
    expect(isDesktopUpdateMetadataAsset("latest.yml")).toBe(true);
    expect(isDesktopUpdaterAsset("latest-linux-arm64.yml")).toBe(true);
    expect(isDesktopUpdaterAsset("Agent.Native-0.1.7-85-arm64-mac.zip")).toBe(
      true,
    );
    expect(isDesktopUpdaterAsset("Agent-Native-x64.exe.blockmap")).toBe(true);
    expect(
      isDesktopUpdaterAsset("Agent.Native-0.1.7-85-arm64-mac.zip.blockmap"),
    ).toBe(true);
    expect(isDesktopUpdaterAsset("agent-native-core-0.8.2.tgz")).toBe(false);
  });
});
