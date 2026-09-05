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

  it("opens on transcript editing and progressively discloses the timeline", () => {
    const source = readSource();

    expect(source).toContain('>("transcript")');
    expect(source).toContain('value="transcript"');
    expect(source).toContain('value="timeline"');
    expect(source).toContain('editingSurface === "transcript"');
    expect(source).toContain(
      'editingSurface !== "timeline" || filmstripSprite',
    );
    expect(source).toContain('timelineActive={editingSurface === "timeline"}');
  });
});
