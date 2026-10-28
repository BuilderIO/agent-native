import { describe, expect, it } from "vitest";

import {
  builderRefreshKey,
  isDesignSystemUsableForGeneration,
  shouldRefreshBuilderDesignSystem,
} from "../lib/design-system-data";

describe("shouldRefreshBuilderDesignSystem", () => {
  it("refreshes only editable Builder systems that are still indexing", () => {
    expect(
      shouldRefreshBuilderDesignSystem({
        accessRole: "editor",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
        }),
      }),
    ).toBe(true);
  });

  it("does not refresh a system with a recorded, indexed docCount and a synced timestamp", () => {
    expect(
      shouldRefreshBuilderDesignSystem({
        accessRole: "editor",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "ready",
          docCount: 12,
          builderSyncedAt: "2026-08-21T00:00:00.000Z",
        }),
      }),
    ).toBe(false);
    expect(
      shouldRefreshBuilderDesignSystem({
        accessRole: "viewer",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
        }),
      }),
    ).toBe(false);
  });

  it("refreshes a legacy row with a synced timestamp but no recorded docCount", () => {
    expect(
      shouldRefreshBuilderDesignSystem({
        accessRole: "editor",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "ready",
          builderSyncedAt: "2026-08-21T00:00:00.000Z",
        }),
      }),
    ).toBe(true);
  });

  it("refreshes terminal Builder imports that have not synced local values", () => {
    expect(
      shouldRefreshBuilderDesignSystem({
        accessRole: "editor",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "complete",
        }),
      }),
    ).toBe(true);
  });

  it("starts a new refresh cycle for a re-indexed Builder job", () => {
    expect(
      builderRefreshKey({
        id: "local-1",
        data: JSON.stringify({
          source: "builder",
          builderJobId: "job-1",
          builderStatus: "in-progress",
        }),
      }),
    ).not.toBe(
      builderRefreshKey({
        id: "local-1",
        data: JSON.stringify({
          source: "builder",
          builderJobId: "job-2",
          builderStatus: "in-progress",
        }),
      }),
    );
  });
});

describe("isDesignSystemUsableForGeneration", () => {
  it("excludes Builder proxies until Builder reports an indexed document", () => {
    expect(
      isDesignSystemUsableForGeneration(
        JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
      ),
    ).toBe(false);
    expect(
      isDesignSystemUsableForGeneration(
        JSON.stringify({
          source: "builder",
          builderStatus: "ready",
          docCount: 0,
        }),
      ),
    ).toBe(false);
  });

  it("ignores a stale in-progress status once documents exist", () => {
    expect(
      isDesignSystemUsableForGeneration(
        JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
          docCount: 12,
        }),
      ),
    ).toBe(true);
  });

  it("treats a legacy sync timestamp without docCount as not ready", () => {
    expect(
      isDesignSystemUsableForGeneration(
        JSON.stringify({
          source: "builder",
          builderStatus: "ready",
          builderSyncedAt: "2026-08-21T00:00:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("keeps ordinary local systems eligible", () => {
    expect(isDesignSystemUsableForGeneration("{}")).toBe(true);
  });
});
