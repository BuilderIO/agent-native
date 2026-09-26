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

    // The preview plays the versioned URL, not the bare one: the file can be
    // replaced while its URL stays the same (a redaction burn uploads under a
    // stable name), and the browser would otherwise keep the copy it has.
    expect(previewVideo).toContain("src={editorVideoUrl ?? undefined}");
    expect(source).toContain("withMediaVersion(");
    expect(previewVideo).not.toContain("crossOrigin");
  });

  it("opens on the timeline, with the transcript the other way in", () => {
    const source = readSource();

    expect(source).toContain('>("timeline")');
    expect(source).toContain('value="transcript"');
    expect(source).toContain('value="timeline"');
    // Timeline first in the tab strip, since that is what opens.
    expect(source.indexOf('value="timeline"')).toBeLessThan(
      source.indexOf('value="transcript"'),
    );
  });

  it("shows the timeline while redacting, whichever tab was open", () => {
    const source = readSource();

    // Redacting is a timeline job, so the tabs are not offered while the tool
    // is armed — and the panel must then show the timeline rather than
    // whichever surface was last chosen, or arming Redact from the transcript
    // would leave no way back to the picture.
    expect(source).toContain(
      'const activeSurface = redactMode ? "timeline" : editingSurface;',
    );
    expect(source).toContain('activeSurface === "transcript"');
    expect(source).toContain('activeSurface !== "timeline" || filmstripSprite');
    expect(source).toContain('timelineActive={activeSurface === "timeline"}');
    // Derived, not forced into state: leaving Redact puts the transcript back.
    expect(source).not.toContain('setEditingSurface("timeline")');
    // The tabs are inside the not-redacting branch of that row.
    expect(source.indexOf("{redactMode ? (")).toBeLessThan(
      source.indexOf("<TabsList"),
    );
  });

  it("keeps the panel's instructions behind an icon, not under the timeline", () => {
    const source = readSource();

    // Several permanent lines of small grey help text under the timeline cost
    // height that belongs to the picture on a laptop screen.
    expect(source).toContain("<HelpPopover");
    expect(source).toContain('t("redaction.helpDraw")');
    expect(source).toContain('t("timelineTrack.helpSplit")');
    expect(source).not.toMatch(
      /<p[^>]*>\s*\{t\("(redaction|timelineTrack)\.hint"\)\}/,
    );
    // The sentence that matters leads the redaction help rather than sitting
    // among the instructions for drawing boxes.
    expect(source).toContain('lead={t("redaction.helpLead")}');
    // The warning that nothing is hidden yet is not help, and stays on show.
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

    // Same intent as upstream's `onSelectionCut`, wired the other way round:
    // the cut is owned by the layout so it lands in the undo history, the
    // toolbar delegates through `onCutRange`, and `callTrim` clears the
    // selection itself rather than the toolbar calling back to say it should.
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

    // `clientWidth` includes the container's padding, which drew the track
    // wider than the space it had: the end of the clip, and the handle of
    // anything ending there, fell outside the visible box.
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
