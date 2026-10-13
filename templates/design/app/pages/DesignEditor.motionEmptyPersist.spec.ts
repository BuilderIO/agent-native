import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

function readSource(relative: string): string {
  return readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), relative),
    "utf8",
  );
}

describe("motion empty-track persistence (Item 2)", () => {
  const editorSrc = readDesignEditorSource();
  const autosaveSrc = readSource("./design-editor/effects/motion-autosave.ts");

  it("wires the remove-motion-timeline action mutation", () => {
    expect(editorSrc).toContain("useActionMutation(");
    expect(editorSrc).toContain('"remove-motion-timeline"');
    expect(editorSrc).toContain("removeMotionTimelineMutation");
  });

  it("routes the empty-tracks autosave case through removeMotionTimeline", () => {
    const emptyBranchIdx = autosaveSrc.indexOf(
      "motionTracks.length === 0 &&\n    !motionTextDocument",
    );
    expect(emptyBranchIdx).toBeGreaterThan(-1);
    expect(autosaveSrc).toContain("motionAnimationStyles.length === 0");
    expect(autosaveSrc).toContain("motionNativeStyles.length === 0");
    expect(autosaveSrc).toContain("motionEasingVariables.length === 0");
    const removeCallIdx = autosaveSrc.indexOf(
      "removeMotionTimeline(",
      emptyBranchIdx,
    );
    expect(removeCallIdx).toBeGreaterThan(emptyBranchIdx);
    expect(autosaveSrc).toContain("timelineId: timelineIdAtSchedule");
  });

  it("only removes when a persisted timeline exists (else just clears dirty)", () => {
    expect(autosaveSrc).toContain("if (!motionTimelineId) {");
  });

  it("allows empty CSS tracks for timelines with authored Motion content", () => {
    const actionSrc = readSource("../../actions/apply-motion-edit.ts");
    expect(actionSrc).toContain("z.array(trackSchema)");
    expect(actionSrc).toContain("inputTracks.length === 0 &&");
    expect(actionSrc).toContain("!textDocument");
    expect(actionSrc).toContain("animationStyles.length === 0");
    expect(actionSrc).toContain("nativeStyles.length === 0");
    expect(actionSrc).toContain(".animations");
  });
});
