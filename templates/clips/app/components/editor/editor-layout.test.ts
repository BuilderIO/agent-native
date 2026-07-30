import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(): string {
  return readFileSync(new URL("./editor-layout.tsx", import.meta.url), "utf8");
}

describe("EditorLayout media loading", () => {
  it("does not force anonymous CORS on the same-origin video proxy", () => {
    const source = readSource();
    const previewVideo = source.match(
      /<video\s+ref=\{videoRef\}[\s\S]*?\/>/,
    )?.[0];

    expect(previewVideo).toContain("src={videoUrl}");
    expect(previewVideo).not.toContain("crossOrigin");
  });
});
