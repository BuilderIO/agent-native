import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseNativeCreativeArtifactKey,
  registerNativeResourceCaptureAdapter,
  resolveNativeCreativeResourceUpdateStatuses,
  unregisterNativeResourceCaptureAdapter,
} from "./native-resource-capture.js";

describe("native creative resource update status", () => {
  afterEach(() => {
    unregisterNativeResourceCaptureAdapter("slides", "deck");
  });

  it("parses only complete native artifact identities", () => {
    expect(parseNativeCreativeArtifactKey("slides:deck:deck-1")).toEqual({
      appId: "slides",
      resourceType: "deck",
      resourceId: "deck-1",
    });
    expect(parseNativeCreativeArtifactKey("slides:deck:")).toBeNull();
    expect(parseNativeCreativeArtifactKey("not-native")).toBeNull();
  });

  it("checks a resource type in one bounded adapter call", async () => {
    const listResourceVersions = vi.fn(async (resourceIds: readonly string[]) =>
      resourceIds.map((resourceId) => ({
        resourceId,
        sourceModifiedAt:
          resourceId === "deck-current"
            ? "2026-07-17T10:00:00Z"
            : "2026-07-18T10:00:00Z",
      })),
    );
    registerNativeResourceCaptureAdapter({
      appId: "slides",
      resourceType: "deck",
      listResourceVersions,
      async capture() {
        throw new Error("not used");
      },
    });

    const statuses = await resolveNativeCreativeResourceUpdateStatuses([
      {
        key: "membership-current",
        appId: "slides",
        resourceType: "deck",
        resourceId: "deck-current",
        publishedSourceModifiedAt: "2026-07-17T10:00:00Z",
      },
      {
        key: "membership-stale",
        appId: "slides",
        resourceType: "deck",
        resourceId: "deck-stale",
        publishedSourceModifiedAt: "2026-07-17T10:00:00Z",
      },
    ]);

    expect(listResourceVersions).toHaveBeenCalledOnce();
    expect(listResourceVersions).toHaveBeenCalledWith([
      "deck-current",
      "deck-stale",
    ]);
    expect(statuses.get("membership-current")?.state).toBe("current");
    expect(statuses.get("membership-stale")).toEqual({
      key: "membership-stale",
      state: "update-available",
      reference: {
        appId: "slides",
        resourceType: "deck",
        resourceId: "deck-stale",
        expectedUpdatedAt: "2026-07-18T10:00:00Z",
      },
    });
  });

  it("omits inaccessible rows and fails closed when the adapter read fails", async () => {
    const listResourceVersions = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("database unavailable"));
    registerNativeResourceCaptureAdapter({
      appId: "slides",
      resourceType: "deck",
      listResourceVersions,
      async capture() {
        throw new Error("not used");
      },
    });
    const reference = {
      key: "membership-1",
      appId: "slides",
      resourceType: "deck",
      resourceId: "deck-1",
      publishedSourceModifiedAt: "2026-07-17T10:00:00Z",
    };

    expect(
      await resolveNativeCreativeResourceUpdateStatuses([reference]),
    ).toEqual(new Map());
    expect(
      await resolveNativeCreativeResourceUpdateStatuses([reference]),
    ).toEqual(new Map());
  });

  it("rejects unbounded status batches", async () => {
    await expect(
      resolveNativeCreativeResourceUpdateStatuses(
        Array.from({ length: 101 }, (_, index) => ({
          key: `membership-${index}`,
          appId: "slides",
          resourceType: "deck",
          resourceId: `deck-${index}`,
          publishedSourceModifiedAt: "2026-07-17T10:00:00Z",
        })),
      ),
    ).rejects.toThrow("limited to 100 resources");
  });
});
