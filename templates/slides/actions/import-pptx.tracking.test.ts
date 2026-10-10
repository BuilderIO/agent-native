import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import { trackPptxImport } from "./import-pptx";

const ctx = { caller: "frontend" } as never;

describe("trackPptxImport", () => {
  beforeEach(() => mockTrack.mockClear());

  it("counts a PPTX imported as a new deck as a creation", () => {
    trackPptxImport(
      { id: "deck-new", slideCount: 4 },
      { purpose: "direct" },
      ctx,
    );

    expect(mockTrack.mock.calls.map(([name]) => name)).toEqual([
      "deck_created",
    ]);
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      output_id: "deck-new",
      creation_method: "import_pptx",
      purpose: "direct",
      slide_count: 4,
    });
  });

  it("counts a PPTX imported into an existing deck as an edit, not a creation", () => {
    trackPptxImport({ id: "deck-1", slideCount: 3 }, { deckId: "deck-1" }, ctx);

    expect(mockTrack.mock.calls.map(([name]) => name)).toEqual(["deck_edited"]);
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      output_id: "deck-1",
      edit_mode: "import_pptx",
      change_kinds: ["content"],
      slide_count: 3,
    });
  });
});
