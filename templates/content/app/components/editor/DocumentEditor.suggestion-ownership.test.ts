// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  documentEditorSuggestionPresentations,
  visibleSavedSuggestionsDuringDraftMaterialization,
} from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import {
  createSuggestionDraftSession,
  draftSuggestionsForSession,
  suggestionOperationKey,
  suggestionSessionVisuals,
  unpersistedDraftSuggestions,
  type DraftSuggestion,
} from "./suggestions/draft-session";
import { markdownSuggestionOperation } from "./suggestions/markdown-operation";
import { createObservedSuggestionPresentationTransition } from "./suggestions/presentation-rebase";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
} from "./VisualEditor";

function materializedSession(before: string, after: string) {
  const session = createSuggestionDraftSession({
    id: "session",
    baseContent: before,
    baseRevision: "revision",
    startedAt: "2026-10-01T00:00:00.000Z",
  });
  const drafts = draftSuggestionsForSession(session, after, null);
  const operation = drafts[0]!.operations[0]!;
  const saved = {
    id: "saved",
    threadId: "saved-thread",
    status: "pending",
    operations: [operation],
  } as ResourceSuggestion;
  const entries = new Map([
    [
      suggestionOperationKey(operation),
      { idempotencyKey: "materialize", operation, suggestion: saved },
    ],
  ]);
  return {
    saved,
    drafts: suggestionSessionVisuals(drafts, entries),
    sidebarSaved: visibleSavedSuggestionsDuringDraftMaterialization(
      [saved],
      unpersistedDraftSuggestions(drafts, entries),
      false,
      new Set([saved.id]),
    ),
  };
}

describe("document suggestion presentation ownership", () => {
  it.each([
    {
      kind: "insert_text",
      before: "BeforexAdded",
      after: "BeforexAddedq",
      rendered: "BeforexAddedq",
    },
    {
      kind: "delete_text",
      before: "BeforexAddedq",
      after: "BeforexAdded",
      rendered: "BeforexAddedq",
    },
  ])(
    "restores one materialized $kind draft and its saved card after a rejected decision fails",
    ({ kind, before, after, rendered }) => {
      const { saved, drafts, sidebarSaved } = materializedSession(
        before,
        after,
      );
      const assembling = {
        savedSuggestions: sidebarSaved,
        drafts,
        currentMarkdown: after,
        editingSuggestionId: null,
        pendingSuggestionId: null,
        transitions: new Map(),
      };
      expect(
        documentEditorSuggestionPresentations({
          ...assembling,
          savedSuggestions: [{ ...saved, status: "rejected" }],
          currentMarkdown: before,
          pendingSuggestionId: saved.id,
        }),
      ).toEqual([]);

      const editor = new Editor({
        extensions: createVisualEditorExtensions(),
        content: nfmToDoc(after),
      });
      try {
        const beforeProjection = editor.getJSON();
        const presentations = documentEditorSuggestionPresentations(assembling);
        const specs = presentations.map((presentation) =>
          suggestionHighlightSpec(editor.state.doc, presentation),
        );
        expect(specs.every((spec) => spec !== null)).toBe(true);
        setSuggestionHighlights(editor.view, {
          specs: specs.map((spec) => spec!),
        });

        expect(editor.view.dom.textContent).toBe(rendered);
        expect(presentations).toHaveLength(1);
        expect(presentations[0]).toMatchObject({
          id: saved.id,
          kind,
          presentation: "draft",
        });
        expect(editor.getJSON()).toEqual(beforeProjection);
        expect(docToNfm(editor.getJSON() as any)).toBe(after);
        expect(sidebarSaved).toEqual([saved]);
        expect(specs.map((spec) => spec!.suggestionId)).toEqual([saved.id]);
        expect(
          editor.view.dom.querySelectorAll('[data-suggestion-id="saved"]'),
        ).toHaveLength(1);
        if (kind === "insert_text") {
          expect(
            editor.view.dom.querySelector(".suggestion-insert"),
          ).toBeNull();
        } else {
          expect(
            editor.view.dom.querySelectorAll(".suggestion-delete-widget"),
          ).toHaveLength(1);
        }
      } finally {
        editor.destroy();
      }
    },
  );

  it("keeps every precise span of a broad materialized draft and an unrelated gap suggestion", () => {
    const before = "We shipped quickly, and the results were good.";
    const after = "We shipped quickly and the results were excellent.";
    const operation = markdownSuggestionOperation(before, after)!;
    const saved = {
      id: "broad",
      status: "pending",
      operations: [operation],
    } as ResourceSuggestion;
    const unrelated = {
      id: "gap",
      status: "pending",
      operations: [
        markdownSuggestionOperation(
          before,
          before.replace("results", "findings"),
        )!,
      ],
    } as ResourceSuggestion;
    const draft: DraftSuggestion = {
      durability: "draft",
      id: saved.id,
      threadId: "broad-thread",
      authorEmail: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      operations: [operation],
      anchor: {
        from: operation.anchor.from,
        to: operation.anchor.from + operation.after.changedText.length,
        prefix: operation.anchor.prefix,
        suffix: operation.anchor.suffix,
      },
    };
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc(after),
    });
    try {
      const presentations = documentEditorSuggestionPresentations({
        savedSuggestions: [saved, unrelated],
        drafts: [draft],
        currentMarkdown: after,
        editingSuggestionId: null,
        pendingSuggestionId: null,
        transitions: new Map(),
        observedTransition:
          createObservedSuggestionPresentationTransition([saved]) ?? undefined,
      });
      const broad = presentations.filter(
        (presentation) => presentation.id === saved.id,
      );
      expect(broad).toHaveLength(2);
      expect(broad.map((presentation) => presentation.presentation)).toEqual([
        "draft",
        "draft",
      ]);
      expect(broad.map((presentation) => presentation.beforeText)).toEqual([
        ",",
        "good",
      ]);
      const specs = presentations.map((presentation) =>
        suggestionHighlightSpec(editor.state.doc, presentation),
      );
      expect(specs.every((spec) => spec !== null)).toBe(true);
      setSuggestionHighlights(editor.view, {
        specs: specs.map((spec) => spec!),
      });
      expect(
        editor.view.dom.querySelector(
          '[data-suggestion-id="gap"][data-suggestion-widget="true"]',
        )?.textContent,
      ).toBe("finding");
      expect(
        [
          ...editor.view.dom.querySelectorAll('[data-suggestion-id="broad"]'),
        ].every((node) => !node.textContent?.includes("results")),
      ).toBe(true);
      expect(docToNfm(editor.getJSON() as any)).toBe(after);
    } finally {
      editor.destroy();
    }
  });
});
