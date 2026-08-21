import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyDesktopAsset,
  DESKTOP_RELEASE_CACHE_HEADERS,
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

function release(
  tag: string,
  publishedAt: string,
  options: { assetName?: string; prerelease?: boolean } = {},
) {
  return {
    tag_name: tag,
    name: tag,
    published_at: publishedAt,
    draft: false,
    prerelease: options.prerelease ?? false,
    assets: [
      {
        name: options.assetName ?? "Agent-Native-arm64.dmg",
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

  it("keeps Nightly releases out of production and serves them separately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          release("v2.0.0-nightly.4", "2026-01-02T00:00:00Z", {
            assetName: "Agent Native Nightly-arm64.dmg",
            prerelease: true,
          }),
          release("v1.0.0", "2026-01-01T00:00:00Z"),
        ]),
      ),
    );

    await expect(getDesktopDownloadManifest()).resolves.toMatchObject({
      version: "1.0.0",
      tag: "v1.0.0",
    });
    await expect(getDesktopDownloadManifest("nightly")).resolves.toMatchObject({
      version: "2.0.0-nightly.4",
      tag: "v2.0.0-nightly.4",
    });
  });

  it("does not walk older release pages after finding a desktop release", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([release("v1.0.0", "2026-01-01T00:00:00Z")]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDesktopDownloadManifest()).resolves.toMatchObject({
      version: "1.0.0",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("page=1");
  });

  it("bounds the fallback scan at GitHub's supported release pages", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      return jsonResponse(
        Array.from({ length: 100 }, (_, index) =>
          release(`unrelated-${page}-${index}`, "2026-01-01T00:00:00Z"),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDesktopDownloadManifest()).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("exposes durable stale-while-revalidate headers for the public endpoint", () => {
    expect(DESKTOP_RELEASE_CACHE_HEADERS).toEqual({
      "cache-control":
        "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
      "cdn-cache-control":
        "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
      "netlify-cdn-cache-control":
        "public, durable, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400",
    });
  });
});
