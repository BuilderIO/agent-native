import { describe, expect, it } from "vitest";
import {
  builderReviewDefaultPublicationEffectLabel,
  builderReviewPublicationIntentSummary,
  builderReviewPublicationTransitionsMap,
} from "./BuilderSourceReviewDialog";

describe("BuilderSourceReviewDialog publication intent helpers", () => {
  it("labels the default Builder publication effect from the source tier", () => {
    expect(builderReviewDefaultPublicationEffectLabel("stage_only")).toBe(
      "Stage autosave",
    );
    expect(builderReviewDefaultPublicationEffectLabel("publish_updates")).toBe(
      "Update in place (keeps current published/draft state)",
    );
  });

  it("summarizes per-row publication intent selections", () => {
    expect(
      builderReviewPublicationIntentSummary(
        ["change-1", "change-2", "change-3"],
        {
          "change-2": { publicationTransition: "publish" },
          "change-3": {
            publicationTransition: "unpublish",
            confirmUnpublish: true,
          },
        },
        "publish_updates",
      ),
    ).toBe("1 update in place · 1 publish · 1 unpublish");
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
});
