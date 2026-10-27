import { describe, expect, it } from "vitest";

import { messagesByLocale } from "../../../i18n-data";
import {
  builderReviewDestinationLine,
  builderReviewEffectiveRowEffect,
  builderReviewIntentSummary,
  builderReviewHasUnconfirmedUnpublish,
  builderReviewPublicationTransitionsMap,
  builderReviewPushVerb,
  builderReviewResultStatus,
  builderReviewRowEffectLabel,
  builderReviewScopedTransitionSelections,
} from "./BuilderSourceReviewDialog";

function english(message: { key: string; count: number }) {
  const database = messagesByLocale["en-US"].database as Partial<
    Record<string, string>
  >;
  const text = database[message.key];
  if (text === undefined) throw new Error(`No English message ${message.key}`);
  return text.replace("{{count}}", String(message.count));
}

describe("BuilderSourceReviewDialog publication intent helpers", () => {
  it("labels each write effect in plain language", () => {
    expect(builderReviewRowEffectLabel("create_draft")).toEqual({
      tagKey: "builderEffectNewTag",
      sentenceKey: "builderEffectNewSentence",
    });
    expect(builderReviewRowEffectLabel("update_in_place").tagKey).toBe(
      "builderEffectEditTag",
    );
    expect(builderReviewRowEffectLabel("unpublish").tagKey).toBe(
      "builderEffectUnpublishTag",
    );
    // Saving to a published entry doesn't make it a draft in Builder.
    expect(builderReviewRowEffectLabel("autosave")).toEqual({
      tagKey: "builderEffectSaveTag",
      sentenceKey: "builderEffectAutosaveSentence",
    });
    expect(
      messagesByLocale["en-US"].database.builderEffectAutosaveSentence,
    ).toBe("Saved, not live until you publish in Builder");
    expect(
      messagesByLocale["en-US"].database.builderEffectSaveDraftSentence,
    ).toBe("Saves the draft");
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
    const summary = (
      rows: Parameters<typeof builderReviewIntentSummary>[0],
      selections: Parameters<typeof builderReviewIntentSummary>[1] = {},
    ) => builderReviewIntentSummary(rows, selections).map(english).join(" · ");
    expect(
      summary(
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
    // A save to a published entry isn't a draft, so the footer matches the rows.
    expect(
      summary([
        { changeSetId: "change-1", effect: "autosave" },
        { changeSetId: "change-2", effect: "save_draft" },
      ]),
    ).toBe("2 saves");
    expect(summary([])).toBe("No changes");
  });

  it("names the send button for what the selected rows do", () => {
    const verb = (
      effects: Parameters<
        typeof builderReviewPushVerb
      >[0]["rows"][number]["effect"][],
      liveWritesEnabled = true,
    ) =>
      english(
        builderReviewPushVerb({
          rows: effects.map((effect, index) => ({
            changeSetId: `change-${index}`,
            effect,
          })),
          selections: {},
          liveWritesEnabled,
        }),
      );
    expect(verb(["autosave", "save_draft"])).toBe("Save 2 to Builder");
    expect(verb(["autosave"])).toBe("Save to Builder");
    expect(verb(["create_draft", "create_draft"])).toBe("Create 2 drafts");
    expect(verb(["autosave", "update_in_place"])).toBe("Push 2 updates");
    expect(verb(["update_in_place"])).toBe("Push update");
    expect(verb(["publish", "autosave"])).toBe("Publish");
    expect(verb(["autosave"], false)).toBe("Check");
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
