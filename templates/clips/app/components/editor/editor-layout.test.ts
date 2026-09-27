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

  it("opens on the timeline, with the transcript the other way in", () => {
    const source = readSource();

    expect(source).toContain('>("timeline")');
    expect(source).toContain('value="transcript"');
    expect(source).toContain('value="timeline"');
    expect(source.indexOf('value="timeline"')).toBeLessThan(
      source.indexOf('value="transcript"'),
    );
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

    expect(source).toContain("onCutRange={callTrim}");
    expect(source).toMatch(
      /const callTrim = useCallback\([\s\S]*?setSelection\(null\)/,
    );
    expect(cut).toMatch(
      /await runEdit\(\(\) => onCutRange\(selectionRange\)\)/,
    );
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

  it("checks storage before requesting or exporting Rewind history", () => {
    const source = readFileSync(
      new URL("./rewind-extension-dialog.tsx", import.meta.url),
      "utf8",
    );
    const checkIndex = source.indexOf("await storageStatus.refetch()");
    const requestIndex = source.indexOf("requestExtension.mutateAsync({");
    const exportIndex = source.indexOf("await exportConcat(");

    expect(checkIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(requestIndex);
    expect(checkIndex).toBeLessThan(exportIndex);
    expect(source).toContain("<FileStorageSetupCard />");
  });
});
