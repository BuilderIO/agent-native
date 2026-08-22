import { describe, expect, it } from "vitest";

import {
  builderRefreshKey,
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

  it("does not refresh ready systems or viewers", () => {
    expect(
      shouldRefreshBuilderDesignSystem({
        accessRole: "editor",
        data: JSON.stringify({ source: "builder", builderStatus: "ready" }),
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
