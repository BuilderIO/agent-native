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

  it("renders the editor toolbar below the preview and above the surface tabs", () => {
    const source = readSource();

    expect(source.indexOf("overflow-hidden bg-black p-4")).toBeLessThan(
      source.indexOf("<EditorToolbar"),
    );
    expect(source.indexOf("<EditorToolbar")).toBeLessThan(
      source.indexOf("<Tabs\n"),
    );
  });

  it("resets a completed toolbar cut to the playhead-following selection", () => {
    const source = readSource();
    const toolbar = readFileSync(
      new URL("./editor-toolbar.tsx", import.meta.url),
      "utf8",
    );
    const cut = toolbar
      .split("const handleTrimSelection = async () => {")[1]
      ?.split("const handleTrimStart")[0];

    expect(source).toContain("onSelectionCut={() => setSelectionRange(null)}");
    expect(cut).toMatch(/await trim\.mutateAsync\([\s\S]*?onSelectionCut\(\)/);
  });
});
