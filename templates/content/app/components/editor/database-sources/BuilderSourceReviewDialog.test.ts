import { describe, expect, it } from "vitest";

import {
  builderReviewDestinationLine,
  builderReviewEffectiveRowEffect,
  builderReviewIntentSummary,
  builderReviewHasUnconfirmedUnpublish,
  builderReviewPublicationTransitionsMap,
  builderReviewResultStatus,
  builderReviewRowEffectLabel,
  builderReviewScopedTransitionSelections,
} from "./BuilderSourceReviewDialog";

describe("BuilderSourceReviewDialog publication intent helpers", () => {
  it("labels each write effect in plain language", () => {
    expect(builderReviewRowEffectLabel("create_draft")).toEqual({
      tag: "New",
      sentence: "Creates a new draft entry",
    });
    expect(builderReviewRowEffectLabel("update_in_place").tag).toBe("Edit");
    expect(builderReviewRowEffectLabel("unpublish").tag).toBe("Unpublish");
  });

  it("lets a chosen transition override the base effect", () => {
    expect(builderReviewEffectiveRowEffect("create_draft", undefined)).toBe(
      "create_draft",
    );
    expect(
      builderReviewEffectiveRowEffect("update_in_place", {
        publicationTransition: "publish",
      }),
    ).toBe("publish");
    expect(
      builderReviewEffectiveRowEffect("update_in_place", {
        publicationTransition: "unpublish",
        confirmUnpublish: true,
      }),
    ).toBe("unpublish");
  });

  it("summarizes per-row intent in plain language, honoring transitions", () => {
    expect(
      builderReviewIntentSummary(
        [
          { changeSetId: "change-1", effect: "create_draft" },
          { changeSetId: "change-2", effect: "update_in_place" },
          { changeSetId: "change-3", effect: "update_in_place" },
        ],
        {
          "change-2": { publicationTransition: "publish" },
          "change-3": {
            publicationTransition: "unpublish",
            confirmUnpublish: true,
          },
        },
      ),
    ).toBe("1 draft to create · 1 to publish · 1 to unpublish");
  });

  it("describes the destination from the dominant effect", () => {
    expect(
      builderReviewDestinationLine({
        rows: [{ changeSetId: "change-1", effect: "create_draft" }],
        selections: {},
        liveWritesEnabled: true,
      }),
    ).toBe("Writes a new draft to Builder — won't publish.");

    expect(
      builderReviewDestinationLine({
        rows: [{ changeSetId: "change-1", effect: "update_in_place" }],
        selections: {},
        liveWritesEnabled: true,
      }),
    ).toBe("Updates content in Builder — publication state is preserved.");

    expect(
      builderReviewDestinationLine({
        rows: [{ changeSetId: "change-1", effect: "create_draft" }],
        selections: {},
        liveWritesEnabled: false,
      }),
    ).toBe("Checks the update only — nothing is sent to Builder.");
  });

  it("maps execution status to plain-language result labels", () => {
    expect(builderReviewResultStatus("succeeded")).toEqual({
      labelKey: "pushed",
      tone: "ok",
    });
    expect(builderReviewResultStatus("validated").labelKey).toBe("ready");
    expect(builderReviewResultStatus("blocked")).toEqual({
      labelKey: "needsAttention",
      tone: "warn",
    });
    expect(builderReviewResultStatus("reconciliation_required")).toEqual({
      labelKey: "reconciliationRequired",
      tone: "warn",
    });
    expect(builderReviewResultStatus("write_disabled").labelKey).toBe(
      "checksOnly",
    );
  });

  it("builds a batch transition map without defaulting unselected rows", () => {
    expect(
      builderReviewPublicationTransitionsMap({
        "change-2": { publicationTransition: "publish" },
        "change-3": {
          publicationTransition: "unpublish",
          confirmUnpublish: true,
        },
        "change-4": {
          publicationTransition: "unpublish",
          confirmUnpublish: false,
        },
      }),
    ).toEqual({
      "change-2": { publicationTransition: "publish" },
      "change-3": {
        publicationTransition: "unpublish",
        confirmUnpublish: true,
      },
    });
  });

  it("clears latent transitions when a row is deselected", () => {
    expect(
      builderReviewScopedTransitionSelections(["change-1"], {
        "change-1": { publicationTransition: "publish" },
        "change-2": {
          publicationTransition: "unpublish",
          confirmUnpublish: false,
        },
      }),
    ).toEqual({
      "change-1": { publicationTransition: "publish" },
    });
  });

  it("does not let an unselected unpublish block the selected rows", () => {
    expect(
      builderReviewHasUnconfirmedUnpublish(["change-1"], {
        "change-2": {
          publicationTransition: "unpublish",
          confirmUnpublish: false,
        },
      }),
    ).toBe(false);
    expect(
      builderReviewHasUnconfirmedUnpublish(["change-2"], {
        "change-2": {
          publicationTransition: "unpublish",
          confirmUnpublish: false,
        },
      }),
    ).toBe(true);
  });
});
