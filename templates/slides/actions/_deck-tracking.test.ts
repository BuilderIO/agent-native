import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import {
  slideChangeSummary,
  trackDeckCreated,
  trackDeckCreationStarted,
  trackSlideContentEdited,
} from "./_deck-tracking";

const ctx = {
  caller: "tool",
  runId: "run-1",
  turnId: "turn-1",
  threadId: "thread-1",
} as never;

beforeEach(() => mockTrack.mockClear());

describe("slideChangeSummary", () => {
  const a = { id: "a", content: "A", notes: "", layout: "title" };
  const b = { id: "b", content: "B", notes: "", layout: "content" };
  const c = { id: "c", content: "C" };

  it("ignores fields that do not change slide content", () => {
    expect(
      slideChangeSummary([a, b], [{ ...a, layoutFitRevision: "new" }, b]),
    ).toEqual({ changeKinds: [], slidesChanged: 0 });
  });

  it("counts visual slide changes as content edits", () => {
    const animated = { ...a, animations: [{ id: "x", type: "fade" }] };
    expect(
      slideChangeSummary(
        [a, b, c],
        [
          { ...a, background: "#000" },
          { ...b, transition: "fade" },
          { ...c, skipped: true },
        ],
      ),
    ).toEqual({ changeKinds: ["content"], slidesChanged: 3 });
    expect(slideChangeSummary([a], [animated])).toEqual({
      changeKinds: ["content"],
      slidesChanged: 1,
    });
  });

  it("compares list fields by value, not by reference", () => {
    const animations = () => [{ id: "x", type: "fade" }];
    expect(
      slideChangeSummary(
        [{ ...a, animations: animations() }],
        [{ ...a, animations: animations(), imageLoading: true }],
      ),
    ).toEqual({ changeKinds: [], slidesChanged: 0 });
  });

  it("classifies content, notes and layout changes as content", () => {
    expect(
      slideChangeSummary(
        [a, b],
        [
          { ...a, notes: "speak" },
          { ...b, layout: "statement" },
        ],
      ),
    ).toEqual({ changeKinds: ["content"], slidesChanged: 2 });
  });

  it("detects added, deleted and reordered slides", () => {
    expect(slideChangeSummary([a, b], [a, b, c])).toEqual({
      changeKinds: ["add_slide"],
      slidesChanged: 1,
    });
    expect(slideChangeSummary([a, b, c], [a, c])).toEqual({
      changeKinds: ["delete_slide"],
      slidesChanged: 1,
    });
    expect(slideChangeSummary([a, b], [b, a])).toEqual({
      changeKinds: ["reorder"],
      slidesChanged: 1,
    });
  });

  it("counts any reorder once, however many slides shifted", () => {
    const d = { id: "d", content: "D" };
    expect(slideChangeSummary([a, b, c, d], [d, a, b, c])).toEqual({
      changeKinds: ["reorder"],
      slidesChanged: 1,
    });
    expect(slideChangeSummary([a, b, c, d], [b, a, d, c])).toEqual({
      changeKinds: ["reorder"],
      slidesChanged: 1,
    });
  });
});

describe("trackSlideContentEdited", () => {
  it("never throws into the write it describes, even on malformed slides", () => {
    const hostile = {
      get id(): string {
        throw new Error("boom");
      },
    };

    expect(() =>
      trackSlideContentEdited(
        "save_deck",
        "deck-1",
        [hostile],
        { slides: [hostile] },
        ctx,
      ),
    ).not.toThrow();
    expect(() =>
      trackDeckCreationStarted("deck-1", undefined, hostile, ctx),
    ).not.toThrow();
  });

  it("emits nothing when slide content is unchanged", () => {
    trackSlideContentEdited(
      "patch_deck",
      "deck-1",
      [{ id: "a", content: "A" }],
      { slides: [{ id: "a", content: "A" }] },
      ctx,
    );
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("emits deck_edited with join keys and the attempt id", () => {
    trackSlideContentEdited(
      "patch_deck",
      "deck-1",
      [{ id: "a", content: "A" }],
      {
        slides: [{ id: "a", content: "A2" }],
        generationContext: { generationAttemptId: "attempt-1" },
      },
      ctx,
    );
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack.mock.calls[0]?.[0]).toBe("deck_edited");
    expect(mockTrack.mock.calls[0]?.[1]).toEqual({
      app_name: "slides",
      template_name: "slides",
      run_id: "run-1",
      turn_id: "turn-1",
      thread_id: "thread-1",
      caller: "tool",
      output_id: "deck-1",
      output_type: "deck",
      edit_mode: "patch_deck",
      change_kinds: ["content"],
      slides_changed: 1,
      slide_count: 1,
      generation_attempt_id: "attempt-1",
    });
  });
});

describe("trackDeckCreated", () => {
  it("emits deck_created with method, purpose and slide count", () => {
    trackDeckCreated(
      "deck-1",
      { creationMethod: "import_pptx", purpose: "unknown", slideCount: 4 },
      ctx,
    );
    expect(mockTrack.mock.calls[0]?.[0]).toBe("deck_created");
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      output_id: "deck-1",
      output_type: "deck",
      creation_method: "import_pptx",
      purpose: "unknown",
      slide_count: 4,
      caller: "tool",
    });
  });
});

describe("trackDeckCreationStarted", () => {
  const context = {
    originalPrompt: "Make a 5 slide deck about our secret roadmap",
    files: [
      {
        path: "uploads/abc/roadmap.PDF",
        originalName: "Secret Roadmap.PDF",
        type: "application/pdf",
      },
      { path: "uploads/abc/logo.png", originalName: "logo.png", type: "" },
      { path: "uploads/abc/other.png", originalName: "other.png", type: "" },
    ],
    designSystemId: "ds-1",
    referenceDeckId: null,
    mode: "source-preserving",
    targetSlideCount: 5,
    generationAttemptId: "attempt-2",
  };

  it("emits nothing when the attempt id is unchanged or absent", () => {
    trackDeckCreationStarted("deck-1", context, context, ctx);
    trackDeckCreationStarted("deck-1", undefined, { originalPrompt: "x" }, ctx);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("describes a new attempt without prompt text or file names", () => {
    trackDeckCreationStarted("deck-1", undefined, context, ctx);
    expect(mockTrack.mock.calls[0]?.[0]).toBe("deck_creation_started");
    const properties = mockTrack.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(properties).toEqual({
      app_name: "slides",
      template_name: "slides",
      run_id: "run-1",
      turn_id: "turn-1",
      thread_id: "thread-1",
      caller: "tool",
      output_id: "deck-1",
      output_type: "deck",
      generation_attempt_id: "attempt-2",
      creation_method: "generated",
      mode: "source_preserving",
      has_text_prompt: true,
      prompt_length_bucket: "1-50",
      attachment_count: 3,
      attachment_types: ["pdf", "png"],
      has_reference_deck: false,
      has_design_system: true,
      target_slide_count: 5,
      is_retry: false,
    });
    const serialized = JSON.stringify(properties);
    expect(serialized).not.toContain("roadmap");
    expect(serialized).not.toContain("Roadmap");
    expect(serialized).not.toContain("uploads");
  });

  it("marks a replacement attempt as a retry", () => {
    trackDeckCreationStarted(
      "deck-1",
      { generationAttemptId: "attempt-1" },
      context,
      ctx,
    );
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      generation_attempt_id: "attempt-2",
      is_retry: true,
    });
  });
});
