import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyClipsAsset,
  compareClipsReleaseTags,
  __clipsLatestTest,
  CLIPS_RELEASE_CACHE_HEADERS,
  isClipsReleaseForChannel,
  normalizeClipsReleaseChannel,
} from "../server/routes/api/clips-latest.json.get";

function jsonResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as Response;
}

describe("classifyClipsAsset", () => {
  it("recognizes Clips installer assets", () => {
    expect(classifyClipsAsset("Clips_0.1.56_universal.dmg")).toBe(
      "mac-universal",
    );
    expect(classifyClipsAsset("Clips_0.1.56_aarch64.dmg")).toBe("mac-arm64");
    expect(classifyClipsAsset("Clips_0.1.56_x64.dmg")).toBe("mac-x64");
    expect(classifyClipsAsset("Clips_0.1.56_x64_en-US.msi")).toBe(
      "windows-msi",
    );
    expect(classifyClipsAsset("Clips_0.1.56_amd64.AppImage")).toBe(
      "linux-appimage",
    );
    expect(classifyClipsAsset("Clips_0.1.56_amd64.deb")).toBe("linux-deb");
    expect(classifyClipsAsset("Clips-0.1.56-1.x86_64.rpm")).toBe("linux-rpm");
  });

  it("ignores updater bundles and signatures", () => {
    expect(classifyClipsAsset("Clips_universal.app.tar.gz")).toBe("unknown");
    expect(classifyClipsAsset("Clips_0.1.56_x64_en-US.msi.sig")).toBe(
      "unknown",
    );
    expect(classifyClipsAsset("Clips_0.1.56_x64-setup.exe")).toBe("unknown");
    expect(classifyClipsAsset("latest.json")).toBe("unknown");
  });
});

describe("compareClipsReleaseTags", () => {
  it("orders releases by semantic version instead of lexical order", () => {
    expect(
      compareClipsReleaseTags("clips-v0.1.56", "clips-v0.1.9"),
    ).toBeGreaterThan(0);
    expect(
      compareClipsReleaseTags("clips-v0.2.0", "clips-v0.1.99"),
    ).toBeGreaterThan(0);
    expect(
      compareClipsReleaseTags("clips-v1.0.0", "clips-v0.99.999"),
    ).toBeGreaterThan(0);
    expect(
      compareClipsReleaseTags(
        "clips-nightly-v0.1.298-0",
        "clips-nightly-v0.1.297-nightly.0",
      ),
    ).toBeGreaterThan(0);
  });
});

describe("Clips release channels", () => {
  const release = (tag_name: string, prerelease: boolean) => ({
    tag_name,
    name: tag_name,
    published_at: "2026-08-20T00:00:00Z",
    draft: false,
    prerelease,
    assets: [
      {
        name: "Clips_0.1.298_universal.dmg",
        browser_download_url: "https://downloads.example.com/clips.dmg",
        size: 1,
      },
    ],
  });

  it("keeps stable and Nightly releases in separate channels", () => {
    expect(
      isClipsReleaseForChannel(release("clips-v0.1.298", false), "production"),
    ).toBe(true);
    expect(
      isClipsReleaseForChannel(
        release("clips-nightly-v0.1.298-0", true),
        "nightly",
      ),
    ).toBe(true);
    expect(
      isClipsReleaseForChannel(
        release("clips-nightly-v0.1.298-0", true),
        "production",
      ),
    ).toBe(false);
    expect(
      isClipsReleaseForChannel(release("clips-v0.1.298", false), "nightly"),
    ).toBe(false);
  });

  it("normalizes unknown query values to the stable channel", () => {
    expect(normalizeClipsReleaseChannel("nightly")).toBe("nightly");
    expect(normalizeClipsReleaseChannel("production")).toBe("production");
    expect(normalizeClipsReleaseChannel("other")).toBe("production");
  });
});

describe("Clips release manifest cache", () => {
  afterEach(() => {
    __clipsLatestTest.reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("serves stale manifests immediately while revalidating", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
    const release = (tag_name: string) => ({
      tag_name,
      name: tag_name,
      published_at: "2026-08-28T00:00:00Z",
      draft: false,
      prerelease: false,
      assets: [
        {
          name: "Clips_universal.dmg",
          browser_download_url: `https://downloads.example.com/${tag_name}.dmg`,
          size: 1,
        },
      ],
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("pointer unavailable"))
      .mockResolvedValueOnce(jsonResponse([release("clips-v1.0.0")]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(__clipsLatestTest.getManifest()).resolves.toMatchObject({
      version: "1.0.0",
    });

    vi.advanceTimersByTime(5 * 60_000 + 1);
    let resolveRefresh!: (response: Response) => void;
    fetchMock
      .mockRejectedValueOnce(new Error("pointer unavailable"))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
      );

    await expect(__clipsLatestTest.getManifest()).resolves.toMatchObject({
      version: "1.0.0",
    });
    await Promise.resolve();
    resolveRefresh(jsonResponse([release("clips-v1.1.0")]));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    await expect(__clipsLatestTest.getManifest()).resolves.toMatchObject({
      version: "1.1.0",
    });
  });

  it("exposes durable stale-while-revalidate headers", () => {
    expect(CLIPS_RELEASE_CACHE_HEADERS).toEqual({
      "cache-control":
        "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
      "cdn-cache-control":
        "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
      "netlify-cdn-cache-control":
        "public, durable, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400",
    });
  });
});
