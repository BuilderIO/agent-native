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
  it("combines in the browser only when the server has no ffmpeg", () => {
    const source = readSource();

    expect(source).toContain("if (!isServerStitchUnavailable(err)) throw err;");
    expect(source).toContain("result = await stitchInBrowser();");
  });

  it("asks the server to stitch and opens the new recording", () => {
    const source = readSource();

    expect(source).toContain("result = await stitch.mutateAsync({");
    expect(source).toContain('t("stitchManager.processingDescription")');
    expect(source).toContain(
      "navigate(`/r/${encodeURIComponent(newRecordingId)}`)",
    );
  });
});
