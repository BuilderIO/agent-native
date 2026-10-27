import { describe, expect, it } from "vitest";

import {
  getDesignSystemIndexingStatus,
  parseDesignSystemIndexingStatus,
} from "./design-system-validation";

describe("getDesignSystemIndexingStatus", () => {
  it("treats a locally authored design system as always ready", () => {
    expect(getDesignSystemIndexingStatus({ colors: {} })).toBe("ready");
    expect(getDesignSystemIndexingStatus(null)).toBe("ready");
    expect(getDesignSystemIndexingStatus(undefined)).toBe("ready");
  });

  it("treats an in-progress Builder-indexed system as indexing", () => {
    expect(
      getDesignSystemIndexingStatus({
        source: "builder",
        builderStatus: "in-progress",
      }),
    ).toBe("indexing");
  });

  it("treats a missing or unrecognized Builder status as still indexing", () => {
    expect(getDesignSystemIndexingStatus({ source: "builder" })).toBe(
      "indexing",
    );
    expect(
      getDesignSystemIndexingStatus({
        source: "builder",
        builderStatus: "queued",
      }),
    ).toBe("indexing");
  });

  it("treats a Builder system as ready if colors/typography exist (proof of work)", () => {
    expect(
      getDesignSystemIndexingStatus({
        source: "builder",
        builderStatus: "in-progress",
        colors: { primary: "#fff" },
        typography: { headingFont: "sans-serif" },
      }),
    ).toBe("ready");
  });

  it("treats a Builder system as unavailable if warning is set and no colors/typography", () => {
    expect(
      getDesignSystemIndexingStatus({
        source: "builder",
        builderStatus: "error",
        warning: "Some error occurred",
      }),
    ).toBe("unavailable");
  });
});

describe("parseDesignSystemIndexingStatus", () => {
  it("parses the persisted data JSON string", () => {
    expect(
      parseDesignSystemIndexingStatus(
        JSON.stringify({ source: "builder", builderStatus: "in-progress" }),
      ),
    ).toBe("indexing");
  });

  it("falls back to ready for missing data (a legacy row predating this column)", () => {
    expect(parseDesignSystemIndexingStatus(null)).toBe("ready");
    expect(parseDesignSystemIndexingStatus(undefined)).toBe("ready");
  });

  it("fails closed to unavailable for malformed, non-empty data", () => {
    expect(parseDesignSystemIndexingStatus("not json")).toBe("unavailable");
  });
});
