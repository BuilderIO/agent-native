import { describe, expect, it } from "vitest";

import {
  readSlideClipboard,
  writeSlideClipboard,
} from "../lib/slide-clipboard";
import {
  isSlideClipboardStillArmed,
  SLIDE_CLIPBOARD_ARM_WINDOW_MS,
} from "./DeckEditor";

function createStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

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

describe("slide clipboard storage", () => {
  const slide = {
    id: "slide-1",
    content: "<div>Copied</div>",
    notes: "Speaker note",
    layout: "content" as const,
    skipped: true,
  };

  it("round-trips a slide snapshot and copy timestamp", () => {
    const storage = createStorage();

    expect(writeSlideClipboard(slide, 1_000, storage)).toBe(true);
    expect(readSlideClipboard(storage)).toEqual({
      status: "ready",
      slide,
      copiedAt: 1_000,
    });
  });

  it("distinguishes an empty or malformed clipboard", () => {
    expect(readSlideClipboard(createStorage())).toEqual({
      status: "empty",
      slide: null,
      copiedAt: null,
    });
    expect(
      readSlideClipboard(
        createStorage({
          "slides:slide-clipboard": JSON.stringify({ version: 1 }),
        }),
      ),
    ).toEqual({
      status: "unreadable",
      slide: null,
      copiedAt: null,
    });
  });

  it("normalizes omitted notes and layout from older slides", () => {
    const result = readSlideClipboard(
      createStorage({
        "slides:slide-clipboard": JSON.stringify({
          version: 1,
          slide: { ...slide, notes: null, layout: null },
          copiedAt: 2_000,
        }),
      }),
    );

    expect(result).toEqual({
      status: "ready",
      slide: { ...slide, notes: "", layout: "content" },
      copiedAt: 2_000,
    });
  });
});
