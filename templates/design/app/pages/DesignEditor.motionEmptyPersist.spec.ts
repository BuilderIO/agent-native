import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readSource(relative: string): string {
  return readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), relative),
    "utf8",
  );
}

describe("motion empty-track persistence (Item 2)", () => {
  const editorSrc = readSource("./DesignEditor.tsx");
  const autosaveSrc = readSource("./design-editor/effects/motion-autosave.ts");

  it("wires the remove-motion-timeline action mutation", () => {
    expect(editorSrc).toContain("useActionMutation(");
    expect(editorSrc).toContain('"remove-motion-timeline"');
    expect(editorSrc).toContain("removeMotionTimelineMutation");
  });

  it("routes the empty-tracks autosave case through removeMotionTimeline", () => {
    const emptyBranchIdx = autosaveSrc.indexOf(
      "if (motionTracks.length === 0)",
    );
    expect(emptyBranchIdx).toBeGreaterThan(-1);
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

  it("does NOT loosen apply-motion-edit's min(1) tracks schema", () => {
    const actionSrc = readSource("../../actions/apply-motion-edit.ts");
    expect(actionSrc).toContain("z.array(trackSchema).min(1)");
  });
});
