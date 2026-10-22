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

    expect(previewVideo).toContain("src={editorVideoUrl ?? undefined}");
    expect(source).toContain("withMediaVersion(");
    expect(previewVideo).not.toContain("crossOrigin");
  });

  it("shows the timeline while redacting, whichever tab was open", () => {
    const source = readSource();

    expect(source).toContain(
      'const activeSurface = redactMode ? "timeline" : editingSurface;',
    );
    expect(source).toContain('activeSurface === "transcript"');
    expect(source).toContain('activeSurface !== "timeline" || filmstripSprite');
    expect(source).toContain('timelineActive={activeSurface === "timeline"}');
    expect(source).not.toContain('setEditingSurface("timeline")');
    expect(source.indexOf("{redactMode ? (")).toBeLessThan(
      source.indexOf("<TabsList"),
    );
  });

  it("keeps the panel's instructions behind an icon, not under the timeline", () => {
    const source = readSource();

    expect(source).toContain("<HelpPopover");
    expect(source).toContain('t("redaction.helpDraw")');
    expect(source).toContain('t("timelineTrack.helpSplit")');
    expect(source).not.toMatch(
      /<p[^>]*>\s*\{t\("(redaction|timelineTrack)\.hint"\)\}/,
    );
    expect(source).toContain('lead={t("redaction.helpLead")}');
    expect(source).toContain('t("redaction.notYetBurned"');
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

    expect(source).toContain("onCutRange={callTrim}");
    expect(source).toMatch(
      /const callTrim = useCallback\([\s\S]*?setSelection\(null\)/,
    );
    expect(cut).toMatch(
      /await runEdit\(\(\) => onCutRange\(selectionRange\)\)/,
    );
  });

  it("passes an exact timeline range to Cut Selection and Delete", () => {
    const source = readSource();
    const deleteSelection = source
      .split("const deleteSelection = useCallback(async () => {")[1]
      ?.split("const seek = useCallback(")[0];

    expect(source).toContain('selection?.kind === "range"');
    expect(source).toContain("selection.startMs, endMs: selection.endMs");
    expect(source).toContain("selectionRange={selectedRange}");
    expect(deleteSelection).toContain(
      "addCut(savedEdits, selectedRange.startMs",
    );
    expect(deleteSelection).toContain("selectedRange.endMs");
  });
});

describe("EditorLayout timeline geometry", () => {
  it("measures the track against the content box, not the padded one", () => {
    const source = readSource();

    expect(source).toContain("entry?.contentRect.width");
    expect(source).toContain("contentWidthOf(el)");
    expect(source).not.toContain(
      "setViewportWidth(Math.max(1, el.clientWidth))",
    );
  });
});

describe("EditorLayout storage preflight", () => {
  it("checks storage before starting a redaction burn", () => {
    const source = readSource();
    const burnStart = source.indexOf(
      "const burnIn = useCallback(async () => {",
    );
    const burnEnd = source.indexOf(
      "// The toast carries the percentage",
      burnStart,
    );
    const burnHandler = source.slice(burnStart, burnEnd);

    expect(burnHandler.indexOf("videoStorageStatus.refetch()")).toBeGreaterThan(
      -1,
    );
    expect(burnHandler.indexOf("videoStorageStatus.refetch()")).toBeLessThan(
      burnHandler.indexOf("setBurning(true)"),
    );
    expect(burnHandler.indexOf("videoStorageStatus.refetch()")).toBeLessThan(
      burnHandler.indexOf("burnRedactions.mutateAsync({ recordingId })"),
    );
  });
});
