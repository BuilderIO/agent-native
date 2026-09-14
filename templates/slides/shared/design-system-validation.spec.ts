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

  it("treats a confirmed-complete Builder status as ready", () => {
    for (const status of ["ready", "complete", "completed", "READY"]) {
      expect(
        getDesignSystemIndexingStatus({
          source: "builder",
          builderStatus: status,
        }),
      ).toBe("ready");
    }
  });

  it("treats a failed Builder status as unavailable", () => {
    for (const status of ["error", "failed", "cancelled", "canceled"]) {
      expect(
        getDesignSystemIndexingStatus({
          source: "builder",
          builderStatus: status,
        }),
      ).toBe("unavailable");
    }
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
