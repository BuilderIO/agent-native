// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  documentEditorSuggestionPresentations,
  createDocumentSuggestionDraftSession,
  observedSuggestionDecisionTransition,
  suggestionDraftHasChanges,
  visibleSavedSuggestionsDuringDraftMaterialization,
} from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import {
  createSuggestionDraftSession,
  draftSuggestionsForSession,
  suggestionOperationKey,
  suggestionSessionVisuals,
  unpersistedDraftSuggestions,
  previewSuggestionDraft,
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
    "First.\n\nSecond.\n\nThird.\n\nFourth.\n\nFifth.",
    "First accepted.\n\nSecond.\n\nThird.\n\nFourth.\n\nFifth.",
    "First accepted.\n\nSecond accepted.\n\nThird.\n\nFourth.\n\nFifth.",
  ])(
    "starts an unchanged ordinary draft without separator operations: %s",
    (baseContent) => {
      const initial = createDocumentSuggestionDraftSession({
        id: "session",
        baseContent,
        baseRevision: "revision",
        startedAt: "2026-10-01T00:00:00.000Z",
      });
      const native = docToNfm(nfmToDoc(baseContent));
      expect(initial.content).toBe(native);
      expect(initial.session.initialContent).toBe(native);
      expect(initial.session.baseContent).toBe(baseContent);
      expect(initial.session.baseRevision).toBe("revision");
      expect(suggestionDraftHasChanges(initial.session, initial.content)).toBe(
        false,
      );
      expect(
        suggestionDraftHasChanges(initial.session, `${initial.content} Typed.`),
      ).toBe(true);
      expect(suggestionDraftHasChanges(initial.session, initial.content)).toBe(
        false,
      );
      expect(
        previewSuggestionDraft(initial.session, initial.content, null),
      ).toEqual({ status: "ready", suggestions: [] });
      expect(previewSuggestionDraft(initial.session, native, null)).toEqual({
        status: "ready",
        suggestions: [],
      });
    },
  );

  it("keeps an amendment's exact initial proposal as its dirty baseline", () => {
    const amendment = {
      baseContent: "Before.",
      initialContent: "Before proposed.",
    };
    expect(suggestionDraftHasChanges(amendment, amendment.initialContent)).toBe(
      false,
    );
    expect(suggestionDraftHasChanges(amendment, "Before amended.")).toBe(true);
    expect(suggestionDraftHasChanges(amendment, amendment.initialContent)).toBe(
      false,
    );
    expect(
      suggestionDraftHasChanges(
        { baseContent: "First.\n\nSecond." },
        "First.\nSecond.",
      ),
    ).toBe(false);
  });

  it("preserves a supported typed insertion and marks while rejecting unsupported formatting", () => {
    const baseContent = "**First.**\nSecond.\nThird.\nFourth.\nFifth.";
    const initial = createDocumentSuggestionDraftSession({
      id: "marked",
      baseContent,
      baseRevision: "revision",
      startedAt: "2026-10-01T00:00:00.000Z",
    });
    const typed = `Note. ${initial.content}`;
    const preview = previewSuggestionDraft(initial.session, typed, null);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready")
      throw new Error("Expected supported insertion");
    expect(preview.suggestions).toHaveLength(1);
    expect(preview.suggestions[0]!.operations[0]).toMatchObject({
      kind: "insert_text",
      before: { markdown: baseContent, changedText: "" },
      after: { markdown: typed, changedText: "Note. " },
      anchor: { from: 0, to: 0 },
    });
    expect(
      nfmToDoc(typed).content?.[0]?.content?.some((node) =>
        node.marks?.some((mark) => mark.type === "bold"),
      ),
    ).toBe(true);
    expect(initial.session.baseContent).toBe(baseContent);
    expect(() =>
      createDocumentSuggestionDraftSession({
        id: "unsupported",
        baseContent: "<span underline=true color=red>Echo</span>",
        baseRevision: "revision",
        startedAt: "2026-10-01T00:00:00.000Z",
      }),
    ).toThrow("cannot be mapped faithfully");
    expect(
      previewSuggestionDraft(
        initial.session,
        "<span underline=true color=red>Unsupported</span>",
        null,
      ).status,
    ).toBe("unsupported-formatting");
  });

  it.each(["single", "proposal"] as const)(
    "keeps unrelated saved widgets during an optimistic %s acceptance in Suggesting mode",
    (owner) => {
      const source = "First.\n\nSecond.\n\nThird.\n\nFourth.\n\nFifth.";
      const records = ["First", "Second", "Third", "Fourth", "Fifth"].map(
        (word) =>
          ({
            id: word,
            status: "pending",
            operations: [
              markdownSuggestionOperation(
                source,
                source.replace(`${word}.`, `${word} accepted.`),
              )!,
            ],
          }) as ResourceSuggestion,
      );
      const first = records[0]!;
      const current = first.operations[0]!.after as { markdown: string };
      const observed = observedSuggestionDecisionTransition(
        owner === "single"
          ? {
              decision: "accepted",
              optimistic: true,
              continueSuggesting: true,
              suggestion: first,
            }
          : null,
        owner === "proposal"
          ? { accepted: true, continueSuggesting: true, members: [first] }
          : null,
      );
      const editor = new Editor({
        extensions: createVisualEditorExtensions(),
        content: nfmToDoc(current.markdown),
      });
      try {
        const canonical = editor.getJSON();
        const presentations = documentEditorSuggestionPresentations({
          savedSuggestions: [
            { ...first, status: "accepted" },
            ...records.slice(1),
          ],
          drafts: [],
          currentMarkdown: docToNfm(canonical as any),
          editingSuggestionId: null,
          pendingSuggestionId: first.id,
          transitions: new Map(),
          observedTransition: observed,
        });
        const specs = presentations.map((presentation) =>
          suggestionHighlightSpec(editor.state.doc, presentation),
        );
        expect(specs.every((spec) => spec !== null)).toBe(true);
        setSuggestionHighlights(editor.view, {
          specs: specs.map((spec) => spec!),
        });
        expect(
          [...editor.view.dom.querySelectorAll("[data-suggestion-id]")].map(
            (node) => node.getAttribute("data-suggestion-id"),
          ),
        ).toEqual(["Second", "Third", "Fourth", "Fifth"]);
        expect(editor.view.dom.textContent).toBe(
          "First accepted.Second accepted.Third accepted.Fourth accepted.Fifth accepted.",
        );
        expect(editor.getJSON()).toEqual(canonical);
      } finally {
        editor.destroy();
      }
    },
  );

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
