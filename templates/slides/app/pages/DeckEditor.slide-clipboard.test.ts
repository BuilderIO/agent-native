import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  getSlideClipboardNativeMarker,
  getSlideClipboardNativeMarkerHtml,
  hasClipboardPayloadBeyondSlideMarker,
  getSlideClipboardStorageKey,
  hasImageClipboardPayload,
  isSlideClipboardPasteSurface,
  normalizeSlideClipboard,
  normalizeSlideClipboards,
  readSlideClipboard,
  readSlideClipboards,
  readSlideClipboardNativeMarker,
  resolveSlideClipboardForPaste,
  resolveSlideClipboardsForPaste,
  shouldHandleSlideClipboardPaste,
  shouldHandleSlideClipboardShortcut,
  writeSlideClipboardMarkerToEvent,
  writeSlideClipboard,
  writeSlideClipboards,
} from "../lib/slide-clipboard";
import {
  isSlideClipboardStillArmed,
  constrainSlideDragToVerticalAxis,
  getAltDragPlacement,
  SLIDE_CLIPBOARD_ARM_WINDOW_MS,
  syncSlideContentSnapshots,
} from "./DeckEditor";

const deckEditorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "DeckEditor.tsx"),
  "utf8",
);

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

describe("slide thumbnail shortcuts", () => {
  it("limits rail shortcuts to focused thumbnails and leaves paste native", () => {
    expect(shouldHandleSlideClipboardShortcut("v", false)).toBe(false);
    expect(shouldHandleSlideClipboardShortcut("v", true)).toBe(false);
    expect(shouldHandleSlideClipboardShortcut("c", false)).toBe(false);
    expect(shouldHandleSlideClipboardShortcut("x", false)).toBe(false);
    expect(shouldHandleSlideClipboardShortcut("d", false)).toBe(false);
    expect(shouldHandleSlideClipboardShortcut("x", true)).toBe(true);
    expect(shouldHandleSlideClipboardShortcut("d", true)).toBe(true);
    expect(shouldHandleSlideClipboardShortcut("c", true)).toBe(true);
  });

  it("keeps cut slides when the native clipboard marker cannot be written", () => {
    const cutStart = deckEditorSource.indexOf("const cutSlides = useCallback(");
    const cutEnd = deckEditorSource.indexOf("const pasteSlideAfter", cutStart);
    const cutBody = deckEditorSource.slice(cutStart, cutEnd);

    expect(cutBody).toContain("if (!saveSlidesToClipboard(slides)) return;");
    expect(cutBody.indexOf("saveSlidesToClipboard(slides)")).toBeLessThan(
      cutBody.indexOf("deleteSlideIds(slideIds)"),
    );
  });

  it("persists multi-slide copies for another deck tab to paste", () => {
    expect(deckEditorSource).toContain(
      "if (!saveSlidesToClipboard(slides)) return;",
    );
    expect(deckEditorSource).toContain(
      "readSlideClipboards(slideClipboardStorageKey)",
    );
  });
});

describe("slide paste event decision", () => {
  const copiedSlides = [{ id: "source-slide-1" }, { id: "source-slide-2" }];
  const marker = getSlideClipboardNativeMarker(copiedSlides, 1_000);
  const canvasPaste = {
    hasMatchingSlideClipboardMarker: true,
    hasImage: false,
    hasNonMarkerPayload: false,
    isTextEntrySurface: false,
    hasSelectedCanvasElement: false,
    hasBlockingOverlay: false,
    isSlideToolActive: false,
  };

  it("pastes only when the native clipboard proves the slide copy is current", () => {
    expect(shouldHandleSlideClipboardPaste(canvasPaste)).toBe(true);
    expect(
      shouldHandleSlideClipboardPaste({
        ...canvasPaste,
        hasMatchingSlideClipboardMarker: false,
      }),
    ).toBe(false);
  });

  it("preserves object paste when a canvas element is selected", () => {
    expect(
      shouldHandleSlideClipboardPaste({
        ...canvasPaste,
        hasSelectedCanvasElement: true,
      }),
    ).toBe(false);
  });

  it("round-trips a native marker without adding visible clipboard text", () => {
    const html = getSlideClipboardNativeMarkerHtml(marker);
    expect(readSlideClipboardNativeMarker(html)).toBe(marker);
    expect(readSlideClipboardNativeMarker("<p>newer native text</p>")).toBe(
      null,
    );
  });

  it("distinguishes a marker-only clipboard from newer native text", () => {
    const html = getSlideClipboardNativeMarkerHtml(marker);
    expect(
      hasClipboardPayloadBeyondSlideMarker({
        types: ["text/html", "text/plain"],
        itemTypes: ["text/html", "text/plain"],
        fileTypes: [],
        html,
        plainText: "",
        marker,
      }),
    ).toBe(false);
    expect(
      hasClipboardPayloadBeyondSlideMarker({
        types: ["text/html", "text/plain"],
        itemTypes: ["text/html", "text/plain"],
        fileTypes: [],
        html,
        plainText: "newer text",
        marker,
      }),
    ).toBe(true);
    expect(
      hasClipboardPayloadBeyondSlideMarker({
        types: ["text/html"],
        itemTypes: ["text/html"],
        fileTypes: [],
        html: `${html}<p>newer text</p>`,
        plainText: "",
        marker,
      }),
    ).toBe(true);
  });

  it.each([
    ["image paste", { hasImage: true }],
    ["newer native text with a stale marker", { hasNonMarkerPayload: true }],
    [
      "HTML-only image paste",
      {
        hasImage: hasImageClipboardPayload({
          types: ["text/html"],
          itemTypes: [],
          fileTypes: [],
          html: '<img src="data:image/png;base64,AA==">',
        }),
      },
    ],
    ["text entry", { isTextEntrySurface: true }],
    ["blocking overlay", { hasBlockingOverlay: true }],
    ["pin or draw mode", { isSlideToolActive: true }],
  ])("preserves %s", (_name, context) => {
    expect(
      shouldHandleSlideClipboardPaste({ ...canvasPaste, ...context }),
    ).toBe(false);
  });
});

describe("slide paste event target", () => {
  it("only handles paste events from the slide rail or editor canvas", () => {
    const toolbarButton = { closest: () => null } as unknown as Element;
    const thumbnail = { closest: () => ({}) } as unknown as Element;
    const canvas = { closest: () => ({}) } as unknown as Element;

    expect(isSlideClipboardPasteSurface(toolbarButton, toolbarButton)).toBe(
      false,
    );
    expect(isSlideClipboardPasteSurface(thumbnail, null)).toBe(true);
    expect(isSlideClipboardPasteSurface(null, canvas)).toBe(true);
  });
});

describe("native slide clipboard marker writes", () => {
  it("writes an HTML marker and clears plain text", () => {
    const values = new Map<string, string>();
    const event = {
      clipboardData: {
        setData: (type: string, value: string) => values.set(type, value),
      },
    } as unknown as ClipboardEvent;
    const marker = getSlideClipboardNativeMarker([{ id: "slide-1" }], 1_000);

    expect(writeSlideClipboardMarkerToEvent(event, marker)).toBe(true);
    expect(values.get("text/html")).toBe(
      getSlideClipboardNativeMarkerHtml(marker),
    );
    expect(values.get("text/plain")).toBe("");
  });

  it("reports when the browser rejects the HTML marker write", () => {
    const event = {
      clipboardData: {
        setData: () => {
          throw new Error("clipboard denied");
        },
      },
    } as unknown as ClipboardEvent;

    expect(
      writeSlideClipboardMarkerToEvent(
        event,
        getSlideClipboardNativeMarker([{ id: "slide-1" }], 1_000),
      ),
    ).toBe(false);
  });
});

describe("alt-drag slide placement", () => {
  const slides = [{ id: "slide-1" }, { id: "slide-2" }, { id: "slide-3" }];

  it("inserts a copy before the drop target when dragged upward", () => {
    expect(getAltDragPlacement(slides, "slide-3", "slide-1")).toEqual({
      afterSlideId: "slide-1",
      beforeSlideId: "slide-1",
    });
  });

  it("inserts a copy after the drop target when dragged downward", () => {
    expect(getAltDragPlacement(slides, "slide-1", "slide-3")).toEqual({
      afterSlideId: "slide-3",
    });
  });

  it("keeps slide drag transforms on the vertical axis", () => {
    expect(
      constrainSlideDragToVerticalAxis({
        x: 48,
        y: 24,
        scaleX: 1,
        scaleY: 1,
      }),
    ).toEqual({ x: 0, y: 24, scaleX: 1, scaleY: 1 });
  });

  it("uses an Alt-only drag overlay for the copied thumbnail", () => {
    expect(deckEditorSource).toContain('data-slide-drag-overlay="copy"');
    expect(deckEditorSource).toContain(
      "altDragSlideId={altDragState?.slideId}",
    );
    expect(deckEditorSource).toContain(
      "modifiers={[verticalSlideDragModifier]}",
    );
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

  it("round-trips an ordered multi-slide snapshot", () => {
    const storage = createStorage();
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    const slides = [
      slide,
      { ...slide, id: "slide-2", content: "<div>Second</div>" },
    ];

    expect(writeSlideClipboards(storageKey, slides, 1_500, storage)).toBe(true);
    expect(readSlideClipboards(storageKey, storage)).toEqual({
      status: "ready",
      slides,
      copiedAt: 1_500,
    });
    expect(readSlideClipboard(storageKey, storage)).toEqual({
      status: "ready",
      slide,
      copiedAt: 1_500,
    });
  });

  it("reads legacy single-slide snapshots as one-slide clipboards", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    expect(
      readSlideClipboards(
        storageKey,
        createStorage({
          [storageKey]: JSON.stringify({
            version: 1,
            slide,
            copiedAt: 1_750,
          }),
        }),
      ),
    ).toEqual({
      status: "ready",
      slides: [slide],
      copiedAt: 1_750,
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

  it("normalizes the deck's null transition default", () => {
    expect(normalizeSlideClipboard({ ...slide, transition: null })).toEqual(
      slide,
    );
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
            layoutWarningDismissed: true,
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
        layoutWarningDismissed: true,
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
    expect(normalizeSlideClipboards([slide])).toEqual([slide]);
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

  it("uses a newer multi-slide cross-tab snapshot instead of stale cached slides", () => {
    const storageKey = getSlideClipboardStorageKey("alice@example.com");
    const cachedSlides = [{ ...slide, content: "Cached" }];
    const latestSlides = [
      { ...slide, content: "Latest" },
      { ...slide, id: "slide-2", content: "Second" },
    ];

    expect(
      resolveSlideClipboardsForPaste(
        { status: "ready", slides: latestSlides, copiedAt: 4_000 },
        cachedSlides,
        storageKey,
        storageKey,
      ),
    ).toEqual(latestSlides);
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
