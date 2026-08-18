import { describe, expect, it } from "vitest";

import {
  isSlideClipboardStillArmed,
  SLIDE_CLIPBOARD_ARM_WINDOW_MS,
} from "./DeckEditor";

// Reproduces the Andrew Rohman Slack thread (C0ATH3CCZT4 / 1786711059459639):
// a slide copied once early in the session kept silently re-duplicating on
// unrelated, much-later Cmd/Ctrl+V presses that landed outside every
// recognized text-input safe zone. The ambient document-level shortcut can
// never enumerate every safe zone, so it must stop trusting an
// indefinitely-armed clipboard instead.
describe("isSlideClipboardStillArmed", () => {
  it("stays armed immediately after a copy", () => {
    const armedAt = 1_000;
    expect(isSlideClipboardStillArmed(armedAt, armedAt)).toBe(true);
  });

  it("stays armed for a normal copy-then-paste within the window", () => {
    const armedAt = 1_000;
    expect(isSlideClipboardStillArmed(armedAt, armedAt + 2_000)).toBe(true);
  });

  it("disarms once the window has elapsed, so a stale copy can't silently duplicate a slide on an unrelated later paste", () => {
    const armedAt = 1_000;
    const now = armedAt + SLIDE_CLIPBOARD_ARM_WINDOW_MS + 1;
    expect(isSlideClipboardStillArmed(armedAt, now)).toBe(false);
  });

  it("is never armed when nothing has been copied", () => {
    expect(isSlideClipboardStillArmed(null, Date.now())).toBe(false);
  });
});
