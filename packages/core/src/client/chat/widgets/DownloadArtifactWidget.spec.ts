import { describe, expect, it } from "vitest";

import {
  formatArtifactSize,
  normalizeArtifactData,
} from "./DownloadArtifactWidget.js";

describe("formatArtifactSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatArtifactSize(512)).toBe("512 B");
    expect(formatArtifactSize(2048)).toBe("2.0 KB");
    expect(formatArtifactSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns nothing for an unknown size rather than inventing one", () => {
    expect(formatArtifactSize(-1)).toBe("");
    expect(formatArtifactSize(Number.NaN)).toBe("");
  });
});

describe("normalizeArtifactData", () => {
  const valid = {
    path: "exports/credits.csv",
    filename: "credits.csv",
    url: "/_agent-native/resources/r1?download",
    sizeBytes: 1024,
    contentType: "text/csv",
  };

  it("accepts a well-formed result", () => {
    expect(normalizeArtifactData(valid)).toMatchObject({
      filename: "credits.csv",
      contentType: "text/csv",
    });
  });

  it("rejects a result with no url, so no card points at nothing", () => {
    expect(normalizeArtifactData({ ...valid, url: "" })).toBeNull();
  });

  it("rejects a result with no filename", () => {
    expect(normalizeArtifactData({ ...valid, filename: "  " })).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(normalizeArtifactData(null)).toBeNull();
    expect(normalizeArtifactData("credits.csv")).toBeNull();
    expect(normalizeArtifactData([valid])).toBeNull();
  });

  it("marks an unknown size instead of defaulting it to zero", () => {
    expect(normalizeArtifactData({ ...valid, sizeBytes: "big" })).toMatchObject(
      { sizeBytes: -1 },
    );
  });
});
