import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(): string {
  return readFileSync(new URL("./stitch-manager.tsx", import.meta.url), "utf8");
}

describe("StitchManager layout", () => {
  it("loads playable media fields for the stitch queue", () => {
    const source = readSource();

    expect(source).toContain(
      'useActionQuery("list-recordings", {\n    includeMedia: true,\n  })',
    );
  });
});

describe("StitchManager server stitch", () => {
  it("no longer combines videos in the browser", () => {
    const source = readSource();

    expect(source).not.toContain("exportConcat");
    expect(source).not.toContain("uploadFileClient");
  });

  it("asks the server to stitch and opens the new recording", () => {
    const source = readSource();

    expect(source).toContain("stitch.mutateAsync({");
    expect(source).not.toMatch(/mutateAsync\(\{[^}]*videoUrl/);
    expect(source).toContain('t("stitchManager.processingDescription")');
    expect(source).toContain(
      "navigate(`/r/${encodeURIComponent(newRecordingId)}`)",
    );
  });
});
