/**
 * The model menu's offset must clear the whole composer, not just the trigger.
 * Example geometry: composer top 268, trigger top 375, so a 6px offset put the menu's
 * bottom at 369 and covered the reply box by 102px; the computed offset (107 + 8) puts it at 259.
 */
import { describe, expect, it } from "vitest";

import { modelMenuRoom } from "./model-menu-room";

describe("modelMenuRoom", () => {
  it("clears the composer when the trigger sits inside a tall composer", () => {
    const room = modelMenuRoom({ triggerTop: 375, composerTop: 268 });
    expect(room.offset).toBe(115);
    // The menu may not extend past the composer's top edge: 375 - 115 = 260, above 268.
    expect(375 - room.offset).toBeLessThanOrEqual(268);
  });

  it("keeps the minimum gap when the trigger is already above the composer", () => {
    expect(modelMenuRoom({ triggerTop: 100, composerTop: 140 }).offset).toBe(6);
  });

  it("caps the height to the room above the trigger and the window's top padding", () => {
    expect(modelMenuRoom({ triggerTop: 400, composerTop: 300 }).maxHeight).toBe(
      384,
    );
    expect(modelMenuRoom({ triggerTop: 60, composerTop: 20 }).maxHeight).toBe(
      160,
    );
  });

  it("treats a missing composer root as no clearance, not as a negative offset", () => {
    expect(modelMenuRoom({ triggerTop: 200, composerTop: null }).offset).toBe(
      6,
    );
  });
});
