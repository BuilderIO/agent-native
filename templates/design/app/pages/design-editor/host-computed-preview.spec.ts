import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// These compute on the host and never patch the live iframe, so they cannot
// satisfy what `skipPreview` promises.
const HOST_COMPUTED_COMMANDS = [
  "add-auto-layout",
  "change-selected-z-index",
  "frame-selection",
  "group-selection",
  "nudge-selection",
  "ungroup-selection",
] as const;

const CALLER_OWNS_PREVIEW_COMMANDS = [
  "overview-primitive-reparent",
  "screen-text-content-change",
  "screen-visual-duplicate-change",
  "screen-visual-structure-change",
  "screen-visual-style-change",
  "text-content-change",
  "visual-structure-change",
] as const;

function commandSource(name: string): string {
  return readFileSync(
    new URL(`./commands/${name}.ts`, import.meta.url),
    "utf8",
  );
}

describe("host-computed edits must not suppress the canvas repaint", () => {
  it.each(HOST_COMPUTED_COMMANDS)("%s does not pass skipPreview", (name) => {
    expect(commandSource(name)).not.toContain("skipPreview: true");
  });

  it.each(HOST_COMPUTED_COMMANDS)(
    "%s replaces the whole document, since it can change more than the selection",
    (name) => {
      expect(commandSource(name)).toContain("forcePreviewFullDocument: true");
    },
  );

  it("a forced replacement cannot fall into the single-subtree fast path", () => {
    const bridge = readFileSync(
      new URL(
        "../../components/design/bridge/editor-chrome.bridge.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(bridge).toContain(
      "!forceFullDocument &&\n      nextHeadHtml === currentHeadHtml &&",
    );
  });

  it("align, distribute and tidy repaint after committing positions", () => {
    const editorSource = readFileSync(
      new URL("../DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const commit = editorSource.slice(
      editorSource.indexOf("const commitNodePositions"),
      editorSource.indexOf("// Item 3: Figma's Alignment row"),
    );
    expect(commit).toContain(
      "applyLocalContentUpdate(content, { forcePreviewFullDocument: true })",
    );
    expect(commit).not.toContain("skipPreview");
  });

  it.each(CALLER_OWNS_PREVIEW_COMMANDS)(
    "%s still owns its own preview",
    (name) => {
      expect(commandSource(name)).toContain("skipPreview: true");
    },
  );

  it("reports a skipped preview as skipped rather than applied", () => {
    const applySource = commandSource("apply-local-content-update");
    expect(applySource).toContain(
      'options.skipPreview\n    ? "skipped-caller-owns-preview"',
    );
    expect(applySource).not.toContain('options.skipPreview\n    ? "applied"');
  });

  it("both preview channels push the same document shape", () => {
    const canvas = readFileSync(
      new URL("../../components/design/DesignCanvas.tsx", import.meta.url),
      "utf8",
    );
    const channel = (start: string, end: string) => {
      const from = canvas.indexOf(start);
      expect(from).toBeGreaterThan(-1);
      const to = canvas.indexOf(end, from);
      expect(to).toBeGreaterThan(from);
      return canvas.slice(from, to);
    };
    const hostChannel = channel(
      "const replacePreviewContentFromHost",
      "const replaceRuntimeContentInPlace",
    );
    const inPlaceChannel = channel(
      "const replaceRuntimeContentInPlace",
      "useEffect(",
    );
    for (const source of [hostChannel, inPlaceChannel]) {
      expect(source).toContain("getEmbeddedFrameDocumentContent({");
      expect(source).toContain("content: withLocalRuntimes(nextContent)");
      expect(source).toContain("contentOffsetX: embeddedFrame?.contentOffsetX");
      expect(source).toContain("contentOffsetY: embeddedFrame?.contentOffsetY");
    }
  });
});
