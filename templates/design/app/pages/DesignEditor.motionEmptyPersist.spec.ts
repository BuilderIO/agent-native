/**
 * DesignEditor.motionEmptyPersist.spec.ts
 *
 * Item 2 regression — deleting the FINAL motion track could not persist.
 *
 * When the last keyframe of the last track is deleted, MotionDock removes the
 * whole track and motionTracks becomes empty. The motion autosave effect used
 * to early-return on `motionTracks.length === 0`, and apply-motion-edit's
 * schema rejects an empty tracks array — so the cleared state was never
 * persisted and a reload restored the old animation/CSS.
 *
 * The fix routes the empty case through remove-motion-timeline (which deletes
 * the timeline row AND strips the managed <style data-agent-native-motion>
 * block) instead of no-op'ing, WITHOUT loosening apply-motion-edit's min(1)
 * schema. These are source-contract assertions (the behavior lives inside a
 * React effect + live DB, so we pin the wiring the same way the Issue 2 write-
 * ordering test does).
 */

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

  it("wires the remove-motion-timeline action mutation", () => {
    // Formatting may wrap the call across lines, so match on the distinctive
    // pieces rather than a single-line literal.
    expect(editorSrc).toContain("useActionMutation(");
    expect(editorSrc).toContain('"remove-motion-timeline"');
    expect(editorSrc).toContain("removeMotionTimelineMutation");
  });

  it("routes the empty-tracks autosave case through removeMotionTimeline", () => {
    // The empty branch must call removeMotionTimeline with designId + timelineId
    // rather than silently returning.
    const emptyBranchIdx = editorSrc.indexOf("if (motionTracks.length === 0)");
    expect(emptyBranchIdx).toBeGreaterThan(-1);
    // removeMotionTimeline is invoked somewhere after that guard.
    const removeCallIdx = editorSrc.indexOf(
      "removeMotionTimeline(",
      emptyBranchIdx,
    );
    expect(removeCallIdx).toBeGreaterThan(emptyBranchIdx);
    expect(editorSrc).toContain("timelineId: timelineIdAtSchedule");
  });

  it("only removes when a persisted timeline exists (else just clears dirty)", () => {
    // No timeline id → nothing to remove, so it clears the dirty flag instead
    // of erroring against a non-existent row.
    expect(editorSrc).toContain("if (!motionTimelineId) {");
  });

  it("does NOT loosen apply-motion-edit's min(1) tracks schema", () => {
    const actionSrc = readSource("../../actions/apply-motion-edit.ts");
    // The empty path goes through remove-motion-timeline, so the apply schema
    // must still reject an empty tracks array.
    expect(actionSrc).toContain("z.array(trackSchema).min(1)");
  });
});
