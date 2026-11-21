import { describe, expect, it } from "vitest";

import { builderArticleAutosaveOutcomeForError } from "./_builder-article-autosave";
import {
  builderArticleAutosaveAllowsEffect,
  builderArticleAutosaveAllowsPublication,
  builderArticleAutosaveLiveStop,
} from "./_builder-article-autosave-rules";
import type { BuilderCmsEntryLiveState } from "./_builder-cms-read-client";
import { withBuilderCmsUnpublishedChanges } from "./_builder-cms-unpublished-changes";

const liveDraft: BuilderCmsEntryLiveState = {
  exists: true,
  published: "draft",
  lastUpdated: 1782328870774,
  blocksHash: null,
  id: "builder-entry-1",
  values: { "data.title": "Draft title" },
};

describe("Builder article autosave rules", () => {
  it("only creates and saves drafts", () => {
    expect(builderArticleAutosaveAllowsEffect("create_draft")).toBe(true);
    expect(builderArticleAutosaveAllowsEffect("save_draft")).toBe(true);
    for (const effect of [
      "autosave",
      "update_in_place",
      "publish",
      "unpublish",
    ] as const) {
      expect(builderArticleAutosaveAllowsEffect(effect)).toBe(false);
    }
  });

  it("allows a new entry or a draft, and nothing once published", () => {
    expect(
      builderArticleAutosaveAllowsPublication(undefined, {
        entryExists: false,
      }),
    ).toBe(true);
    expect(
      builderArticleAutosaveAllowsPublication("draft", { entryExists: true }),
    ).toBe(true);
    for (const published of ["published", "archived", undefined]) {
      expect(
        builderArticleAutosaveAllowsPublication(published, {
          entryExists: true,
        }),
      ).toBe(false);
    }
  });

  it("lets a live draft save", () => {
    expect(
      builderArticleAutosaveLiveStop({
        liveState: liveDraft,
        baselineValues: { published: "draft" },
      }),
    ).toBeNull();
  });

  it("stops once the live entry reads as published", () => {
    expect(
      builderArticleAutosaveLiveStop({
        liveState: { ...liveDraft, published: "published" },
        baselineValues: { published: "draft" },
      }),
    ).toMatchObject({
      errorCode: "builder_autosave_published",
      reason: "published",
    });
  });

  it("waits for editor autosaves Content's own record doesn't account for", () => {
    expect(
      builderArticleAutosaveLiveStop({
        liveState: { ...liveDraft, hasAutosaves: true },
        baselineValues: { published: "draft" },
      }),
    ).toMatchObject({
      errorCode: "builder_autosave_editor_changes",
      reason: "builder_editor_changes",
    });
    expect(
      builderArticleAutosaveLiveStop({
        liveState: { ...liveDraft, hasAutosaves: true },
        baselineValues: withBuilderCmsUnpublishedChanges(
          { published: "draft", "data.title": "Saved title" },
          { liveValues: { "data.title": "Draft title" } },
        ),
      }),
    ).toBeNull();
  });

  it("leaves a missing entry to the live preflight", () => {
    expect(
      builderArticleAutosaveLiveStop({
        liveState: { ...liveDraft, exists: false, published: null },
        baselineValues: { published: "draft" },
      }),
    ).toBeNull();
  });
});

describe("Builder article autosave outcomes", () => {
  const coded = (errorCode: string, message = "Stopped.") =>
    Object.assign(new Error(message), { errorCode, statusCode: 409 });

  it("maps each stop to what the row says and what clears it", () => {
    expect(
      builderArticleAutosaveOutcomeForError(
        coded("builder_autosave_published"),
      ),
    ).toEqual({ state: "review", reason: "published", disable: true });
    expect(
      builderArticleAutosaveOutcomeForError(
        coded("builder_autosave_editor_changes"),
      ),
    ).toEqual({ state: "waiting", reason: "builder_editor_changes" });
    expect(
      builderArticleAutosaveOutcomeForError(
        coded("builder_autosave_needs_review"),
      ),
    ).toEqual({ state: "review", reason: "needs_review" });
    expect(
      builderArticleAutosaveOutcomeForError(
        coded(
          "builder_entry_changed_since_review",
          "Title changed in Builder since you edited it; refresh and re-review.",
        ),
      ),
    ).toEqual({
      state: "failed",
      reason: "builder_changed",
      error:
        "Title changed in Builder since you edited it; refresh and re-review.",
    });
  });

  it("waits to check Builder's copy after an unknown outcome", () => {
    for (const message of [
      "Builder write timed out after 30000ms; remote outcome is unknown.",
      "Builder reconciliation required; wait for the recovery window before a read-only lookup. Do not retry.",
      "Builder write succeeded, but local reconciliation failed: disk full",
    ]) {
      expect(builderArticleAutosaveOutcomeForError(new Error(message))).toEqual(
        { state: "waiting", reason: "checking_last_save" },
      );
    }
  });

  it("fails with the message when the check can't settle it", () => {
    for (const message of [
      "Builder reconciliation required: more than one remote draft matches this execution intent.",
      "Builder reconciliation required: the remote draft marker exists, but its intended fields drifted. Do not retry.",
      "Builder accepted the write, but its response could not be saved for reconciliation. Do not retry this execution; inspect the live Builder entry before preparing another write.",
    ]) {
      expect(builderArticleAutosaveOutcomeForError(new Error(message))).toEqual(
        { state: "failed", reason: "save_failed", error: message },
      );
    }
  });

  it("shows any other failure with its message", () => {
    expect(
      builderArticleAutosaveOutcomeForError(new Error("Builder returned 500.")),
    ).toEqual({
      state: "failed",
      reason: "save_failed",
      error: "Builder returned 500.",
    });
  });
});
