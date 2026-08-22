import { describe, expect, it } from "vitest";

import { shouldRefreshBuilderDesignSystem } from "./DesignSystems";

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
});
