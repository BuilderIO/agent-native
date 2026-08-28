import { describe, expect, it } from "vitest";

import {
  getSlideClipboardStorageKey,
  normalizeSlideClipboard,
  readSlideClipboard,
  resolveSlideClipboardForPaste,
  writeSlideClipboard,
} from "../lib/slide-clipboard";
import {
  isSlideClipboardStillArmed,
  SLIDE_CLIPBOARD_ARM_WINDOW_MS,
  syncSlideContentSnapshots,
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

describe("syncSlideContentSnapshots", () => {
  it("adopts an inactive slide update without losing a queued local edit", () => {
    const latestContent = new Map<string, string>();
    const renderedContent = new Map<string, string>();
    const initialSlides = [
      { id: "slide-a", content: "A initial" },
      { id: "slide-b", content: "B initial" },
    ];

    syncSlideContentSnapshots(initialSlides, latestContent, renderedContent);
    latestContent.set("slide-a", "A queued local edit");
    syncSlideContentSnapshots(initialSlides, latestContent, renderedContent);

    expect(latestContent.get("slide-a")).toBe("A queued local edit");

    syncSlideContentSnapshots(
      [
        { id: "slide-a", content: "A intervening update" },
        { id: "slide-b", content: "B initial" },
      ],
      latestContent,
      renderedContent,
    );

    expect(latestContent.get("slide-a")).toBe("A intervening update");
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
    const storageKey = getSlideClipboardStorageKey("alice@example.com");

    expect(writeSlideClipboard(storageKey, slide, 1_000, storage)).toBe(true);
    expect(readSlideClipboard(storageKey, storage)).toEqual({
      status: "ready",
      slide,
      copiedAt: 1_000,
    });
  });

  it("distinguishes an empty or malformed clipboard", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    expect(readSlideClipboard(storageKey, createStorage())).toEqual({
      status: "empty",
      slide: null,
      copiedAt: null,
    });
    expect(
      readSlideClipboard(
        storageKey,
        createStorage({
          [storageKey]: JSON.stringify({ version: 1 }),
        }),
      ),
    ).toEqual({
      status: "unreadable",
      slide: null,
      copiedAt: null,
    });
  });

  it("normalizes omitted notes and layout from older slides", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    const result = readSlideClipboard(
      storageKey,
      createStorage({
        [storageKey]: JSON.stringify({
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

  it("keeps only validated optional fields and drops transient data", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    const result = readSlideClipboard(
      storageKey,
      createStorage({
        [storageKey]: JSON.stringify({
          version: 1,
          slide: {
            ...slide,
            imageLoading: true,
            unexpected: "stale data",
            animations: [{ id: "animation-1", elementIndex: 0, type: "fade" }],
          },
          copiedAt: 2_500,
        }),
      }),
    );

    expect(result).toEqual({
      status: "ready",
      slide: {
        ...slide,
        animations: [{ id: "animation-1", elementIndex: 0, type: "fade" }],
      },
      copiedAt: 2_500,
    });
  });

  it("normalizes the in-memory fallback before paste", () => {
    expect(
      normalizeSlideClipboard({
        ...slide,
        imageLoading: true,
        unexpected: true,
      }),
    ).toEqual(slide);
  });

  it("rejects malformed optional fields", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    expect(
      readSlideClipboard(
        storageKey,
        createStorage({
          [storageKey]: JSON.stringify({
            version: 1,
            slide: { ...slide, animations: [{ id: "bad" }] },
            copiedAt: 2_500,
          }),
        }),
      ),
    ).toEqual({
      status: "unreadable",
      slide: null,
      copiedAt: null,
    });
  });

  it("keeps clipboard snapshots isolated by signed-in user", () => {
    const storage = createStorage();
    const aliceKey = getSlideClipboardStorageKey("alice@example.com");
    const bobKey = getSlideClipboardStorageKey("bob@example.com");

    expect(writeSlideClipboard(aliceKey, slide, 3_000, storage)).toBe(true);
    expect(readSlideClipboard(bobKey, storage)).toEqual({
      status: "empty",
      slide: null,
      copiedAt: null,
    });
    expect(readSlideClipboard(aliceKey, storage).status).toBe("ready");
  });

  it("uses a newer cross-tab snapshot instead of a stale cached slide", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    const cachedSlide = { ...slide, content: "Cached" };
    const latestSlide = { ...slide, content: "Latest" };

    expect(
      resolveSlideClipboardForPaste(
        { status: "ready", slide: latestSlide, copiedAt: 4_000 },
        cachedSlide,
        storageKey,
        storageKey,
      ),
    ).toEqual(latestSlide);
  });

  it("keeps a fresh in-memory snapshot when persistence is rejected", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    const cachedSlide = { ...slide, content: "Fresh cached copy" };
    const olderSlide = { ...slide, content: "Older persisted copy" };
    const rejectedStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage write rejected");
      },
    };

    expect(
      writeSlideClipboard(storageKey, cachedSlide, 4_000, rejectedStorage),
    ).toBe(false);

    expect(
      resolveSlideClipboardForPaste(
        { status: "ready", slide: olderSlide, copiedAt: 3_000 },
        cachedSlide,
        storageKey,
        storageKey,
        4_000,
        true,
      ),
    ).toEqual(cachedSlide);
    expect(
      resolveSlideClipboardForPaste(
        { status: "empty", slide: null, copiedAt: null },
        cachedSlide,
        storageKey,
        storageKey,
        4_000,
        true,
      ),
    ).toEqual(cachedSlide);
  });

  it("keeps a pending copy while the session scope hydrates", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    const cachedSlide = { ...slide, content: "Copied before session loaded" };
    const olderSlide = { ...slide, content: "Older persisted copy" };

    expect(
      resolveSlideClipboardForPaste(
        { status: "ready", slide: olderSlide, copiedAt: 3_000 },
        cachedSlide,
        null,
        storageKey,
        4_000,
      ),
    ).toEqual(cachedSlide);
    expect(
      resolveSlideClipboardForPaste(
        { status: "empty", slide: null, copiedAt: null },
        cachedSlide,
        null,
        storageKey,
        4_000,
      ),
    ).toEqual(cachedSlide);
  });
});
