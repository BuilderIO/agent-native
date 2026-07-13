import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __clipsUpdaterTest,
  hasAllRequiredPlatforms,
  INERT_MANIFEST,
  REQUIRED_PLATFORM_KEYS,
} from "../server/routes/api/clips-updater.json.get";

const signedPlatform = {
  url: "https://example.test/clips-update",
  signature: "test-signature",
};

function completeManifest(version: string) {
  return {
    version,
    platforms: Object.fromEntries(
      REQUIRED_PLATFORM_KEYS.map((key) => [key, signedPlatform]),
    ),
  };
}

function manifestResponse(manifest: unknown) {
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Clips updater platform coverage", () => {
  afterEach(() => {
    __clipsUpdaterTest.reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("requires the released macOS, Windows, and Linux targets", () => {
    expect(REQUIRED_PLATFORM_KEYS).toContain("linux-x86_64");
    expect(hasAllRequiredPlatforms(INERT_MANIFEST)).toBe(true);
  });

  it("rejects a signed manifest that omits Linux", () => {
    expect(
      hasAllRequiredPlatforms({
        version: "1.0.0",
        platforms: {
          "darwin-aarch64": signedPlatform,
          "darwin-x86_64": signedPlatform,
          "windows-x86_64": signedPlatform,
        },
      }),
    ).toBe(false);
  });

  it("does not refresh a stale cache TTL after incomplete Linux coverage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(manifestResponse(completeManifest("1.0.0")))
      .mockResolvedValueOnce(
        manifestResponse({
          version: "2.0.0",
          platforms: {
            "darwin-aarch64": signedPlatform,
            "darwin-x86_64": signedPlatform,
            "windows-x86_64": signedPlatform,
          },
        }),
      )
      .mockResolvedValueOnce(manifestResponse(completeManifest("2.0.1")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(__clipsUpdaterTest.getManifest()).resolves.toMatchObject({
      version: "1.0.0",
    });
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(__clipsUpdaterTest.getManifest()).resolves.toMatchObject({
      version: "1.0.0",
    });
    await expect(__clipsUpdaterTest.getManifest()).resolves.toMatchObject({
      version: "2.0.1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache an inert fallback after validation fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(manifestResponse({ version: "2.0.0" }))
      .mockResolvedValueOnce(manifestResponse(completeManifest("2.0.1")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(__clipsUpdaterTest.getManifest()).resolves.toEqual(
      INERT_MANIFEST,
    );
    await expect(__clipsUpdaterTest.getManifest()).resolves.toMatchObject({
      version: "2.0.1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
