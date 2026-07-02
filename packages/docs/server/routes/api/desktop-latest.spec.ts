import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyDesktopAsset,
  getDesktopDownloadManifest,
  isDesktopUpdateMetadataAsset,
  isDesktopUpdaterAsset,
  resetDesktopDownloadManifestCacheForTests,
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

function release(tag: string, publishedAt: string) {
  return {
    tag_name: tag,
    name: tag,
    published_at: publishedAt,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "Agent-Native-arm64.dmg",
        browser_download_url: `https://example.com/${tag}.dmg`,
        size: 123,
      },
    ],
  };
}

function jsonResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as Response;
}

async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("getDesktopDownloadManifest", () => {
  beforeEach(() => {
    resetDesktopDownloadManifestCacheForTests();
  });

  afterEach(() => {
    resetDesktopDownloadManifestCacheForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("serves stale manifests immediately while revalidating in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(
      jsonResponse([release("v1.0.0", "2026-01-01T00:00:00Z")]),
    );
    await expect(getDesktopDownloadManifest()).resolves.toMatchObject({
      version: "1.0.0",
    });

    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));

    let resolveRefresh!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    await expect(getDesktopDownloadManifest()).resolves.toMatchObject({
      version: "1.0.0",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveRefresh(jsonResponse([release("v1.1.0", "2026-01-01T00:06:00Z")]));
    await flushPromises();

    await expect(getDesktopDownloadManifest()).resolves.toMatchObject({
      version: "1.1.0",
    });
  });
});
