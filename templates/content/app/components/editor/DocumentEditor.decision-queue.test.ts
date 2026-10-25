// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  queuedAcceptedPresentations,
  queuedDecisionTransition,
  suggestionsWithQueuedDecisions,
} from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import type { QueuedSuggestionDecision } from "./suggestion-decision-queue";
import { markdownSuggestionOperation } from "./suggestions/markdown-operation";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
} from "./VisualEditor";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const source = "First.\n\nSecond.\n\nThird.";

function record(word: string, replacement: string): ResourceSuggestion {
  return {
    id: word,
    status: "pending",
    revision: 1,
    baseRevision: "revision",
    operations: [
      defined(
        markdownSuggestionOperation(
          source,
          source.replace(`${word}.`, `${replacement}.`),
        ),
      ),
    ],
  } as ResourceSuggestion;
}

function queued(
  decision: QueuedSuggestionDecision["decision"],
  members: ResourceSuggestion[],
  proposalId: string | null = null,
): QueuedSuggestionDecision {
  return {
    key: members.map((member) => member.id).join(),
    proposalId,
    decision,
    members,
    beforeContent: source,
  };
}

describe("queued suggestion decisions", () => {
  const first = record("First", "One");
  const second = record("Second", "Two");
  const third = record("Third", "Three");

  it("shows each queued decision on its suggestions at once", () => {
    const all = [first, second, third];
    expect(suggestionsWithQueuedDecisions(all, [])).toBe(all);
    expect(
      suggestionsWithQueuedDecisions(all, [
        queued("accepted", [first]),
        queued("rejected", [second]),
      ]).map((suggestion) => suggestion.status),
    ).toEqual(["accepted", "rejected", "pending"]);
  });

  it("keeps the status the server already gave a suggestion", () => {
    expect(
      suggestionsWithQueuedDecisions(
        [{ ...first, status: "rejected" }],
        [queued("accepted", [first])],
      )[0]?.status,
    ).toBe("rejected");
  });

  it("shows accepted text over the original until the server's change arrives", () => {
    const presentations = queuedAcceptedPresentations([
      queued("accepted", [first]),
      queued("rejected", [second]),
    ]);
    expect(
      presentations.map((presentation) => [
        presentation.id,
        presentation.presentation,
      ]),
    ).toEqual([["First", "settling"]]);

    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc(source),
    });
    const accepted = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc(source.replace("First.", "One.")),
    });
    try {
      setSuggestionHighlights(editor.view, {
        specs: presentations.map((presentation) =>
          defined(suggestionHighlightSpec(editor.state.doc, presentation)),
        ),
      });
      expect(
        editor.view.dom.querySelector(".suggestion-settling-original")
          ?.textContent,
      ).toBe("First");
      expect(
        editor.view.dom.querySelector(".suggestion-settling-text")?.textContent,
      ).toBe("One");
      // Once live sync brings the accepted text, nothing is drawn over it.
      expect(
        suggestionHighlightSpec(accepted.state.doc, defined(presentations[0])),
      ).toBeNull();
    } finally {
      editor.destroy();
      accepted.destroy();
    }
  });

  it("holds the words of an accepted suggestion it can't draw as accepted", () => {
    const page = "First.\nSecond.\nThird.";
    const split = {
      ...first,
      id: "split",
      operations: [
        defined(
          markdownSuggestionOperation(
            page,
            page.replace("Second.", "Two.\nMore."),
          ),
        ),
      ],
    } as ResourceSuggestion;
    const presentation = defined(
      queuedAcceptedPresentations([queued("accepted", [split])])[0],
    );
    expect(presentation.presentation).toBe("canonical");
    expect(presentation.frozen).toBe(true);
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc(page),
    });
    try {
      expect(
        suggestionHighlightSpec(editor.state.doc, presentation)?.frozen,
      ).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("shows every accepted member of a group", () => {
    expect(
      queuedAcceptedPresentations([
        queued("accepted", [first, third], "proposal"),
      ]).map((presentation) => presentation.id),
    ).toEqual(["First", "Third"]);
  });

  it("observes only the accepted suggestions", () => {
    expect(queuedDecisionTransition([])).toBeUndefined();
    expect(
      queuedDecisionTransition([queued("rejected", [first])]),
    ).toBeUndefined();
    expect(
      queuedDecisionTransition([
        queued("rejected", [second]),
        queued("accepted", [first]),
      ])?.after,
    ).toBe(source.replace("First.", "One."));
  });
});
