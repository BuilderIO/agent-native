import { describe, expect, it } from "vitest";

import { addExportSnapshotBaseUrl } from "./export-snapshot-frame";

describe("addExportSnapshotBaseUrl", () => {
  it("adds a base URL to runtime snapshots without a head element", () => {
    expect(
      addExportSnapshotBaseUrl(
        "<!doctype html><html><body><img src='/image.png'></body></html>",
        "http://localhost:5173/nested/page?tab=home",
      ),
    ).toBe(
      "<!doctype html><html><head><base href=\"http://localhost:5173/nested/page?tab=home\"></head><body><img src='/image.png'></body></html>",
    );
  });

  it("places the base URL before existing relative resource references", () => {
    expect(
      addExportSnapshotBaseUrl(
        "<html><head><title>Preview</title></head><body></body></html>",
        "http://localhost:5173/?a=1&b=2",
      ),
    ).toContain(
      '<head><base href="http://localhost:5173/?a=1&amp;b=2"><title>Preview</title></head>',
    );
  });

  it("rejects non-HTTP base URLs", () => {
    expect(() =>
      addExportSnapshotBaseUrl(
        "<html><body></body></html>",
        "javascript:alert(1)",
      ),
    ).toThrowError("PNG capture blob-failed");
  });
});
