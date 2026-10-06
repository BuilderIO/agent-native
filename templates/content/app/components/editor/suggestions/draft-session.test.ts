import type { ResourceSuggestion } from "@agent-native/core/review";
import { canonicalizeNfm } from "@shared/nfm";
import { describe, expect, it } from "vitest";

import {
  canonicalSuggestionRevision,
  createSuggestionDraftSession,
  draftSuggestionsForSession,
  editableSuggestionDraft,
  freshestSavedSuggestions,
  planSuggestionDraftPersistence,
  previewSuggestionDraft,
  recordSuggestionReplacementIntent,
  saveUnlessSuggestionChanged,
  suggestionAmendmentIdempotencyKey,
  suggestionDraftOperations,
  suggestionOperationKey,
  suggestionSessionVisuals,
  unpersistedDraftSuggestions,
  withdrawnSessionSuggestionIds,
  type SuggestionPersistenceEntry,
} from "./draft-session";

describe("suggestion draft session", () => {
  it.each(["", "<empty-block/>"])(
    "starts an empty %s body without a formatting warning and proposes its first text block",
    (baseContent) => {
      const session = createSuggestionDraftSession({
        id: "empty-body",
        baseContent,
        baseRevision: "body:empty",
        startedAt: "2026-09-24T00:00:00.000Z",
      });
      expect(previewSuggestionDraft(session, baseContent, null)).toEqual({
        status: "ready",
        suggestions: [],
      });
      expect(previewSuggestionDraft(session, "<empty-block/>", null)).toEqual({
        status: "ready",
        suggestions: [],
      });
      expect(
        previewSuggestionDraft(session, "First paragraph", null),
      ).toMatchObject({
        status: "ready",
        suggestions: [
          {
            operations: [
              {
                kind: "add_text_block",
                before: { markdown: baseContent },
                after: { markdown: "First paragraph" },
                anchor: { from: 0, to: baseContent.length },
              },
            ],
          },
        ],
      });
      expect(
        previewSuggestionDraft(
          session,
          "<span underline=true color=red>Unsupported</span>",
          null,
        ).status,
      ).toBe("unsupported-formatting");
    },
  );

  it("uses the body token for new drafts and preserves only a matching legacy basis", () => {
    const document = {
      revision: "body:3:sha256:example",
      updatedAt: "timestamp",
    };
    expect(canonicalSuggestionRevision(document)).toBe(document.revision);
    expect(
      canonicalSuggestionRevision(document, { baseRevision: "timestamp" }),
    ).toBe("timestamp");
    expect(
      canonicalSuggestionRevision(document, {
        baseRevision: "older-timestamp",
      }),
    ).toBe(document.revision);
    expect(canonicalSuggestionRevision({ updatedAt: "legacy-api" })).toBe(
      "legacy-api",
    );
  });

  it("exposes unsupported formatting without producing persistable partial operations", () => {
    const baseContent = "<span underline=true color=red>Echo</span>";
    const session = createSuggestionDraftSession({
      id: "unsupported",
      baseContent,
      baseRevision: "one",
      startedAt: "2026-09-08T00:00:00.000Z",
    });
    const content = baseContent.replace("Echo", "ECHO");
    expect(previewSuggestionDraft(session, content, null)).toEqual({
      status: "unsupported-formatting",
      content,
    });
    expect(() => suggestionDraftOperations(session, content)).toThrow(
      "cannot be mapped faithfully",
    );
    expect(session.baseContent).toBe(baseContent);
  });
  it("keeps a multi-location amendment within the saved single proposal", () => {
    const session = createSuggestionDraftSession({
      id: "amendment",
      baseContent: "Use workflow.\nAnother paragraph.",
      baseRevision: "one",
      startedAt: "now",
      existingSuggestion: {
        id: "saved",
        threadId: "thread",
        revision: 1,
        baseRevision: "one",
      },
    });
    const content = "Use workflows!\nAnother edited paragraph.";
    const operations = suggestionDraftOperations(session, content);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.after.markdown).toBe(content);
    expect(draftSuggestionsForSession(session, content, null)[0]!.id).toBe(
      "saved",
    );
  });

  function savedSuggestion(
    overrides: Partial<ResourceSuggestion> = {},
  ): ResourceSuggestion {
    return {
      id: "suggestion-one",
      resourceType: "document",
      resourceId: "document-one",
      adapterKind: "content.document-markdown",
      adapterVersion: 1,
      threadId: "thread-one",
      authorEmail: "reviewer@example.test",
      actorKind: "human",
      baseRevision: "revision-one",
      revision: 2,
      status: "pending",
      summary: "Suggested edits",
      ownerEmail: null,
      orgId: null,
      visibility: "private",
      createdAt: "2026-09-06T12:00:00.000Z",
      updatedAt: "2026-09-06T12:01:00.000Z",
      metadata: null,
      operations: [
        {
          ordinal: 0,
          kind: "insert_text",
          targetId: "body",
          before: { markdown: "An example", changedText: "" },
          after: { markdown: "An edited example", changedText: " edited" },
          anchor: { from: 2, to: 2, prefix: "An", suffix: " example" },
          schemaVersion: 1,
        },
      ],
      ...overrides,
    };
  }

  it("reopens the current user's pending suggestion as the same draft identity", () => {
    const reopened = editableSuggestionDraft({
      suggestion: savedSuggestion(),
      currentUserEmail: "reviewer@example.test",
      canonicalContent: "An example",
      canonicalRevision: "revision-one",
    });

    expect(reopened).toMatchObject({
      content: "An edited example",
      session: {
        baseContent: "An example",
        baseRevision: "revision-one",
        initialContent: "An edited example",
        existingSuggestion: {
          id: "suggestion-one",
          threadId: "thread-one",
          revision: 2,
          baseRevision: "revision-one",
        },
      },
      caret: { from: 9, prefix: "An edited", suffix: " example" },
    });
    expect(
      draftSuggestionsForSession(
        reopened!.session,
        "And edited example",
        "reviewer@example.test",
      )[0],
    ).toMatchObject({ id: "suggestion-one", threadId: "thread-one" });
  });

  it("does not let a stale query overwrite a confirmed local amendment", () => {
    const local = savedSuggestion({ revision: 2, summary: "Amended" });
    const staleRemote = savedSuggestion({ revision: 1, summary: "Original" });
    expect(freshestSavedSuggestions([local], [staleRemote])).toEqual([local]);

    // A decision keeps the revision, so the refreshed row must still win.
    for (const status of ["accepted", "rejected", "withdrawn"] as const) {
      const decidedRemote = savedSuggestion({ revision: 2, status });
      expect(freshestSavedSuggestions([local], [decidedRemote])).toEqual([
        decidedRemote,
      ]);
    }
  });

  it("keeps a reopened addition as the same Add while typing continues", () => {
    const suggestion = savedSuggestion({
      operations: [
        {
          ordinal: 0,
          kind: "insert_text",
          targetId: "body",
          before: { markdown: "An", changedText: "" },
          after: { markdown: "An ", changedText: " " },
          anchor: { from: 2, to: 2, prefix: "An", suffix: "" },
          schemaVersion: 1,
        },
      ],
    });
    const reopened = editableSuggestionDraft({
      suggestion,
      currentUserEmail: "reviewer@example.test",
      canonicalContent: "An",
      canonicalRevision: "revision-one",
    })!;
    const [continued] = draftSuggestionsForSession(
      reopened.session,
      "And ",
      "reviewer@example.test",
    );

    expect(continued).toMatchObject({
      id: "suggestion-one",
      threadId: "thread-one",
      operations: [
        {
          kind: "insert_text",
          before: { changedText: "" },
          after: { changedText: "d " },
        },
      ],
    });
  });

  it("preserves a native selected-text replacement envelope as typing continues", () => {
    const session = createSuggestionDraftSession({
      id: "replacement-session",
      baseContent: "Use this workflow today.",
      baseRevision: "revision-one",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    expect(
      recordSuggestionReplacementIntent(session, {
        beforeText: "workflow",
        startOffset: 9,
      }),
    ).toBe(true);
    expect(session.replacementIntents).toEqual([
      {
        from: 9,
        to: 17,
        beforeText: "workflow",
      },
    ]);
    expect(
      recordSuggestionReplacementIntent(
        session,
        {
          beforeText: "s",
          startOffset: 17,
        },
        "Use this workflows today.",
      ),
    ).toBe(true);

    expect(
      suggestionDraftOperations(session, "Use this workflows today."),
    ).toMatchObject([
      {
        kind: "replace_text",
        before: { changedText: "workflow" },
        after: { changedText: "workflows" },
      },
    ]);
    expect(
      suggestionDraftOperations(session, "Use this workflows! today."),
    ).toMatchObject([
      {
        kind: "replace_text",
        before: { changedText: "workflow" },
        after: { changedText: "workflows!" },
      },
    ]);
  });

  it("seeds a reopened replacement envelope from the saved proposal", () => {
    const canonical = "Use this workflow today.";
    const reopened = editableSuggestionDraft({
      suggestion: savedSuggestion({
        operations: [
          {
            ordinal: 0,
            kind: "replace_text",
            targetId: "body",
            before: { markdown: canonical, changedText: "workflow" },
            after: {
              markdown: "Use this workflows today.",
              changedText: "workflows",
            },
            anchor: {
              from: 9,
              to: 17,
              prefix: "Use this ",
              suffix: " today.",
            },
            schemaVersion: 1,
          },
        ],
      }),
      currentUserEmail: "reviewer@example.test",
      canonicalContent: canonical,
      canonicalRevision: "revision-one",
    })!;

    expect(
      suggestionDraftOperations(reopened.session, "Use this workflows! today."),
    ).toMatchObject([
      {
        kind: "replace_text",
        before: { changedText: "workflow" },
        after: { changedText: "workflows!" },
      },
    ]);
  });

  it("keeps a whole replacement independent of edits elsewhere in the same draft", () => {
    const original = "This reads better compared to the original.";
    const replacement = "This reads more clearly than the original.";
    const baseContent = `${original}\nEditors publish carefully.\nThe draft is ready.`;
    const session = createSuggestionDraftSession({
      id: "multi-location",
      baseContent,
      baseRevision: "revision-one",
      startedAt: "2026-09-08T12:00:00.000Z",
    });
    recordSuggestionReplacementIntent(session, {
      beforeText: original,
      startOffset: 0,
    });
    const content = `${replacement}\nEditors  carefully.\nThe draft is ready. Ready for review.`;
    const operations = suggestionDraftOperations(session, content);
    expect(operations).toHaveLength(3);
    expect(operations[0]).toMatchObject({
      kind: "replace_text",
      before: { changedText: original },
      after: { changedText: replacement },
    });
    expect(operations[1]).toMatchObject({
      kind: "delete_text",
      before: { changedText: "publish" },
    });
    expect(operations[2]).toMatchObject({ kind: "insert_text" });
    let applied = baseContent;
    for (const operation of [...operations].reverse()) {
      applied =
        applied.slice(0, operation.anchor.from) +
        operation.after.changedText +
        applied.slice(operation.anchor.to);
    }
    expect(applied).toBe(content);
    expect(
      draftSuggestionsForSession(session, content, null).map(
        (draft) => draft.operations[0],
      ),
    ).toEqual(operations);
  });

  it("records another selected replacement after an earlier edit shifts its position", () => {
    const baseContent = "Keep this workflow.\nUse this workflow too.";
    const session = createSuggestionDraftSession({
      id: "multiple-selections",
      baseContent,
      baseRevision: "revision-one",
      startedAt: "2026-09-08T12:00:00.000Z",
    });
    recordSuggestionReplacementIntent(session, {
      beforeText: "Keep this workflow.",
      startOffset: 0,
    });
    const firstDraft =
      "Keep this much clearer workflow.\nUse this workflow too.";
    recordSuggestionReplacementIntent(
      session,
      {
        beforeText: "Use this workflow too.",
        startOffset: firstDraft.indexOf("Use this"),
      },
      firstDraft,
    );
    const operations = suggestionDraftOperations(
      session,
      "Keep this much clearer workflow.\nUse this revised workflow too.",
    );
    expect(operations).toHaveLength(2);
    expect(
      operations.map((operation) => [
        operation.before.changedText,
        operation.after.changedText,
      ]),
    ).toEqual([
      ["Keep this workflow.", "Keep this much clearer workflow."],
      ["Use this workflow too.", "Use this revised workflow too."],
    ]);
    expect(operations[1]!.anchor.from).toBe(baseContent.indexOf("Use this"));
  });

  it("does not resurrect a reverted replacement when another edit remains", () => {
    const baseContent = "Keep this workflow.\nAnother paragraph.";
    const session = createSuggestionDraftSession({
      id: "reverted-selection",
      baseContent,
      baseRevision: "revision-one",
      startedAt: "2026-09-08T12:00:00.000Z",
    });
    recordSuggestionReplacementIntent(session, {
      beforeText: "Keep this workflow.",
      startOffset: 0,
    });
    const operations = suggestionDraftOperations(
      session,
      baseContent + " Extra.",
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: "insert_text",
      before: { changedText: "" },
      after: { changedText: " Extra." },
    });
  });

  it("keeps editing inside a replacement attached to its original selection", () => {
    const baseContent = "Choose the old workflow.\nLeave this note.";
    const session = createSuggestionDraftSession({
      id: "inside-replacement",
      baseContent,
      baseRevision: "one",
      startedAt: "2026-09-08T12:00:00Z",
    });
    recordSuggestionReplacementIntent(session, {
      beforeText: "old workflow",
      startOffset: 11,
    });
    const draft = "Choose the much better workflow.\nLeave this note.";
    recordSuggestionReplacementIntent(
      session,
      { beforeText: "better", startOffset: draft.indexOf("better") },
      draft,
    );
    expect(
      suggestionDraftOperations(
        session,
        "Choose the much clearer workflow.\nLeave this new note.",
      ).map((operation) => [
        operation.kind,
        operation.before.changedText,
        operation.after.changedText,
      ]),
    ).toEqual([
      ["replace_text", "old workflow", "much clearer workflow"],
      ["insert_text", "", " new"],
    ]);
  });

  it("maps a later duplicate selection back through a preceding insertion", () => {
    const baseContent = "The workflow stays.\nThe workflow changes.";
    const draft = "A longer introduction.\n" + baseContent;
    const session = createSuggestionDraftSession({
      id: "shifted-duplicate",
      baseContent,
      baseRevision: "one",
      startedAt: "2026-09-08T12:00:00Z",
    });
    recordSuggestionReplacementIntent(
      session,
      { beforeText: "workflow", startOffset: draft.lastIndexOf("workflow") },
      draft,
    );
    const changed =
      draft.slice(0, draft.lastIndexOf("workflow")) + "workflows changes.";
    const operations = suggestionDraftOperations(session, changed);
    expect(operations).toHaveLength(2);
    expect(operations[0]!.kind).toBe("add_text_block");
    expect(operations[1]).toMatchObject({
      kind: "replace_text",
      anchor: { from: baseContent.lastIndexOf("workflow") },
      before: { changedText: "workflow" },
      after: { changedText: "workflows" },
    });
  });

  it("does not turn editing wholly new text into a canonical replacement", () => {
    const baseContent = "Original.\nAnother paragraph.";
    const draft = "Original. Added text.\nAnother paragraph.";
    const session = createSuggestionDraftSession({
      id: "edit-addition",
      baseContent,
      baseRevision: "one",
      startedAt: "2026-09-08T12:00:00Z",
    });
    recordSuggestionReplacementIntent(
      session,
      { beforeText: "Added", startOffset: draft.indexOf("Added") },
      draft,
    );
    expect(
      suggestionDraftOperations(
        session,
        "Original. Revised text.\nAnother paragraph.",
      ),
    ).toMatchObject([
      {
        kind: "insert_text",
        before: { changedText: "" },
        after: { changedText: " Revised text." },
      },
    ]);
  });

  it("preserves the exact final document when selected ranges overlap generic changes", () => {
    const baseContent =
      "Alpha beta gamma.\nSecond phrase here.\nThird paragraph stays.";
    for (const draft of [
      "Alpha revised gamma.\nSecond new phrase here.\nThird paragraph stays.",
      "PREFIX Alpha beta gamma.\nSecond phrase here.\nThird paragraph stays. SUFFIX",
      "Alpha beta.\nSecond phrase here.\nThird stays.",
      "Alpha beta gamma.\nSecond phrase here.\nThird paragraph stays.",
    ]) {
      const session = createSuggestionDraftSession({
        id: "reconstruction",
        baseContent,
        baseRevision: "one",
        startedAt: "2026-09-08T12:00:00Z",
        replacementIntents: [
          { from: 0, to: 17, beforeText: baseContent.slice(0, 17) },
          { from: 6, to: 10, beforeText: "beta" },
          { from: 18, to: 37, beforeText: baseContent.slice(18, 37) },
        ],
      });
      const operations = suggestionDraftOperations(session, draft);
      let applied = baseContent;
      for (const operation of [...operations].reverse())
        applied =
          applied.slice(0, operation.anchor.from) +
          operation.after.changedText +
          applied.slice(operation.anchor.to);
      expect(applied).toBe(draft);
      for (let i = 1; i < operations.length; i++)
        expect(operations[i]!.anchor.from).toBeGreaterThanOrEqual(
          operations[i - 1]!.anchor.to,
        );
    }
  });

  it("turns typing at a reopened deletion boundary into one replacement", () => {
    const canonical = "We run a workflow.";
    const reopened = editableSuggestionDraft({
      suggestion: savedSuggestion({
        operations: [
          {
            ordinal: 0,
            kind: "delete_text",
            targetId: "body",
            before: { markdown: canonical, changedText: "run" },
            after: { markdown: "We  a workflow.", changedText: "" },
            anchor: {
              from: 3,
              to: 6,
              prefix: "We ",
              suffix: " a workflow.",
            },
            schemaVersion: 1,
          },
        ],
      }),
      currentUserEmail: "reviewer@example.test",
      canonicalContent: canonical,
      canonicalRevision: "revision-one",
    })!;

    expect(
      suggestionDraftOperations(reopened.session, "We manage a workflow."),
    ).toEqual([
      expect.objectContaining({
        kind: "replace_text",
        before: { markdown: canonical, changedText: "run" },
        after: { markdown: "We manage a workflow.", changedText: "manage" },
      }),
    ]);
    expect(
      draftSuggestionsForSession(
        reopened.session,
        "We manage a workflow.",
        "reviewer@example.test",
      ),
    ).toHaveLength(1);
  });

  it("keeps an ordinary unselected suffix keystroke as an Add", () => {
    const session = createSuggestionDraftSession({
      id: "addition-session",
      baseContent: "Use this workflow today.",
      baseRevision: "revision-one",
      startedAt: "2026-09-06T12:00:00.000Z",
    });

    expect(
      suggestionDraftOperations(session, "Use this workflows today."),
    ).toMatchObject([
      {
        kind: "insert_text",
        before: { changedText: "" },
        after: { changedText: "s" },
      },
    ]);
  });

  it.each([
    ["another author", { authorEmail: "other@example.test" }],
    ["a differently-cased author", { authorEmail: "Reviewer@example.test" }],
    ["an agent", { actorKind: "agent" as const }],
    ["another adapter", { adapterKind: "other.markdown" }],
    ["another adapter version", { adapterVersion: 2 }],
    ["a decided suggestion", { status: "accepted" as const }],
    ["a stale base revision", { baseRevision: "older-revision" }],
    [
      "stale canonical content",
      {
        operations: [
          {
            ...savedSuggestion().operations[0]!,
            before: { markdown: "Older content", changedText: "" },
          },
        ],
      },
    ],
  ])("does not reopen %s", (_label, overrides) => {
    expect(
      editableSuggestionDraft({
        suggestion: savedSuggestion(overrides),
        currentUserEmail: "reviewer@example.test",
        canonicalContent: "An example",
        canonicalRevision: "revision-one",
      }),
    ).toBeNull();
  });

  it.each([
    ["insert_text", "An example", "And example", 3],
    ["delete_text", "Old example", " example", 0],
    ["replace_text", "Friday example", "Monday example", 6],
  ])(
    "places a native caret at the %s projection boundary",
    (kind, canonical, projection, caretOffset) => {
      const changedText =
        kind === "delete_text" ? "" : projection.split(" ")[0]!;
      const reopened = editableSuggestionDraft({
        suggestion: savedSuggestion({
          operations: [
            {
              ordinal: 0,
              kind,
              targetId: "body",
              before: {
                markdown: canonical,
                changedText: canonical.split(" ")[0]!,
              },
              after: { markdown: projection, changedText },
              anchor: {
                from: 0,
                to: canonical.indexOf(" "),
                prefix: "",
                suffix: " example",
              },
              schemaVersion: 1,
            },
          ],
        }),
        currentUserEmail: "reviewer@example.test",
        canonicalContent: canonical,
        canonicalRevision: "revision-one",
      });

      expect(reopened?.caret.from).toBe(caretOffset);
    },
  );

  it("keeps a new live proposal distinct from an already-saved pending proposal", () => {
    const canonical = "The team will publish on Friday.";
    const savedDeletion = {
      id: "saved-publish",
      status: "pending",
      operations: [{ kind: "delete_text" }],
    } as ResourceSuggestion;
    const session = createSuggestionDraftSession({
      id: "session-one",
      baseContent: canonical,
      baseRevision: "revision-one",
      startedAt: "2026-09-06T12:00:00.000Z",
    });

    const drafts = draftSuggestionsForSession(
      session,
      "The team will publisheded on Friday.",
      "reviewer@example.test",
    );

    expect([savedDeletion.id, ...drafts.map((draft) => draft.id)]).toEqual([
      "saved-publish",
      "draft-session-one-0",
    ]);
    expect(drafts[0]).toMatchObject({
      durability: "draft",
      threadId: "draft-session-one-0",
      authorEmail: "reviewer@example.test",
      operations: [
        {
          kind: "insert_text",
          before: { changedText: "" },
          after: { changedText: "eded" },
        },
      ],
    });
    expect(drafts[0]).not.toHaveProperty("status");
    expect(drafts[0]).not.toHaveProperty("baseRevision");
  });

  it("uses the same operations for live presentation and mode-exit persistence", () => {
    const session = createSuggestionDraftSession({
      id: "session-two",
      baseContent: "publish this",
      baseRevision: "revision-two",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const draftContent = " this edited";

    expect(
      draftSuggestionsForSession(session, draftContent, null).map(
        (draft) => draft.operations[0],
      ),
    ).toEqual(suggestionDraftOperations(session, draftContent));
  });

  it("presents a repeated paragraph-prefix insertion as one accurate draft", () => {
    const baseContent =
      "The team will publish the draft on Friday.\nReview this paragraph and leave a comment about the timeline.";
    const session = createSuggestionDraftSession({
      id: "session-repeated-prefix",
      baseContent,
      baseRevision: "revision-repeated-prefix",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const draftContent = baseContent.replace(
      "Review this paragraph",
      "Review note. Review this paragraph",
    );
    const drafts = draftSuggestionsForSession(session, draftContent, null);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: "draft-session-repeated-prefix-0",
      operations: [
        {
          kind: "insert_text",
          before: { changedText: "" },
          after: { changedText: "Review note. " },
          anchor: { from: 43, to: 43 },
        },
      ],
      anchor: { from: 43, to: 56 },
    });
    expect(
      draftContent.slice(drafts[0]!.anchor.from, drafts[0]!.anchor.to),
    ).toBe("Review note. ");
  });

  it("materializes once and mode exit reuses the same durable suggestion", () => {
    const session = createSuggestionDraftSession({
      id: "session-three",
      baseContent: "publish this",
      baseRevision: "revision-three",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const operations = suggestionDraftOperations(session, " this");
    const entries = new Map<string, SuggestionPersistenceEntry>();

    const first = planSuggestionDraftPersistence(operations, entries);
    expect(first.create).toHaveLength(1);
    recordSaved(entries, first.create, "saved-once");

    expect(planSuggestionDraftPersistence(operations, entries)).toMatchObject({
      create: [],
      amend: [],
      withdraw: [],
    });
  });

  it("creates only the operations a failed save left unrecorded", () => {
    const session = createSuggestionDraftSession({
      id: "session-four",
      baseContent: "one old; two old",
      baseRevision: "revision-four",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const draftContent = "one new; two fresh";
    const operations = suggestionDraftOperations(session, draftContent);
    expect(operations).toHaveLength(2);
    const entries = new Map<string, SuggestionPersistenceEntry>();
    recordSaved(
      entries,
      planSuggestionDraftPersistence(operations, entries).create.slice(0, 1),
      "saved-head",
    );

    expect(
      unpersistedDraftSuggestions(
        draftSuggestionsForSession(session, draftContent, null),
        entries,
      ),
    ).toHaveLength(1);
    const retry = planSuggestionDraftPersistence(operations, entries);
    expect(
      retry.create.map(({ operation }) => operation.after.changedText),
    ).toEqual(["fresh"]);
    expect(retry.amend).toEqual([]);
  });

  it("keeps confirmed and failed hunk identities when an earlier edit shifts ordinals", () => {
    const session = createSuggestionDraftSession({
      id: "session-shift",
      baseContent: "zero same; one old; two old",
      baseRevision: "revision-shift",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const initial = suggestionDraftOperations(
      session,
      "zero same; one new; two fresh",
    );
    const entries = new Map<string, SuggestionPersistenceEntry>();
    recordSaved(
      entries,
      planSuggestionDraftPersistence(initial, entries).create.slice(0, 1),
      "saved-middle",
    );

    const revised = suggestionDraftOperations(
      session,
      "PRE zero same; one new; two fresh",
    );
    const shiftedConfirmed = revised.find(
      (operation) => operation.after.changedText === "new",
    )!;
    expect(suggestionOperationKey(shiftedConfirmed)).toBe(
      suggestionOperationKey(initial[0]!),
    );
    const remaining = unpersistedDraftSuggestions(
      draftSuggestionsForSession(
        session,
        "PRE zero same; one new; two fresh",
        null,
      ),
      entries,
    );
    expect(remaining).toHaveLength(2);
    expect(
      planSuggestionDraftPersistence(revised, entries).create.map(
        ({ operation }) => operation.ordinal,
      ),
    ).toEqual([0, 2]);
  });

  it("keeps confirmed insertion geometry under its durable id after a later hunk fails", () => {
    const session = createSuggestionDraftSession({
      id: "session-insertion",
      baseContent: "Alpha middle tail old",
      baseRevision: "revision-insertion",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const draftContent = "Alpha INSERT middle tail fresh";
    const operations = suggestionDraftOperations(session, draftContent);
    expect(operations).toHaveLength(2);
    const entries = new Map<string, SuggestionPersistenceEntry>();
    recordSaved(
      entries,
      planSuggestionDraftPersistence(operations, entries).create.slice(0, 1),
      "saved-insertion",
    );
    const drafts = draftSuggestionsForSession(session, draftContent, null);
    const visuals = suggestionSessionVisuals(drafts, entries);

    expect(visuals.map((visual) => visual.id)).toEqual([
      "saved-insertion",
      "draft-session-insertion-1",
    ]);
    expect(
      draftContent.slice(visuals[0]!.anchor.from, visuals[0]!.anchor.to),
    ).toBe("INSERT ");
    expect(unpersistedDraftSuggestions(drafts, entries)).toHaveLength(1);
  });

  it("does not persist when a draft is deleted before materialization", () => {
    const session = createSuggestionDraftSession({
      id: "session-five",
      baseContent: "unchanged",
      baseRevision: "revision-five",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    expect(
      planSuggestionDraftPersistence(
        suggestionDraftOperations(session, "unchanged"),
        new Map(),
      ),
    ).toEqual({ unchanged: new Map(), amend: [], create: [], withdraw: [] });
  });

  describe("saving as the author types", () => {
    // Minimized from the Content page where a suggested sentence was lost:
    // "one" became "diagram", then a sentence was appended before a heading.
    const base =
      "I've already promised Apoorva my next one for another critique.\n## Hand edits are gold";
    const firstPause = base.replace(
      "my next one for another critique.",
      "my next diagram for another critique. Encoding our",
    );
    const laterTyping = base.replace(
      "my next one for another critique.",
      "my next diagram for another critique. Encoding our newfound knowledge into skills is how we keep raising the bar.",
    );
    const session = () =>
      createSuggestionDraftSession({
        id: "session-autosave",
        baseContent: base,
        baseRevision: "body:11",
        startedAt: "2026-10-05T11:16:00.000Z",
      });
    const savedAtFirstPause = () => {
      const draftSession = session();
      const entries = new Map<string, SuggestionPersistenceEntry>();
      const plan = planSuggestionDraftPersistence(
        suggestionDraftOperations(draftSession, firstPause),
        entries,
      );
      expect(plan.create).toHaveLength(2);
      recordSaved(entries, plan.create, "saved");
      return { draftSession, entries };
    };

    it("amends the saved suggestion instead of saving continued typing as a duplicate", () => {
      const { draftSession, entries } = savedAtFirstPause();

      const plan = planSuggestionDraftPersistence(
        suggestionDraftOperations(draftSession, laterTyping),
        entries,
      );

      expect(plan.create).toEqual([]);
      expect(plan.withdraw).toEqual([]);
      expect([...plan.unchanged.values()].map(({ id }) => id)).toEqual([
        "saved-0",
      ]);
      expect(plan.amend.map(({ suggestion }) => suggestion.id)).toEqual([
        "saved-1",
      ]);
      expect(plan.amend[0]!.operation.after.changedText).toBe(
        " Encoding our newfound knowledge into skills is how we keep raising the bar.",
      );
      const drafts = draftSuggestionsForSession(
        draftSession,
        laterTyping,
        null,
      );
      expect(unpersistedDraftSuggestions(drafts, entries)).toEqual([]);
      expect(
        suggestionSessionVisuals(drafts, entries).map(({ id }) => id),
      ).toEqual(["saved-0", "saved-1"]);
    });

    it("withdraws a saved suggestion whose text the author deleted", () => {
      const { draftSession, entries } = savedAtFirstPause();
      const replacedOnly = base.replace(
        "my next one for",
        "my next diagram for",
      );

      const plan = planSuggestionDraftPersistence(
        suggestionDraftOperations(draftSession, replacedOnly),
        entries,
      );

      expect(plan.create).toEqual([]);
      expect(plan.amend).toEqual([]);
      expect(plan.withdraw.map(({ suggestion }) => suggestion.id)).toEqual([
        "saved-1",
      ]);
      expect(
        withdrawnSessionSuggestionIds(
          draftSuggestionsForSession(draftSession, replacedOnly, null),
          entries,
        ),
      ).toEqual(new Set(["saved-1"]));
      expect(
        planSuggestionDraftPersistence(
          suggestionDraftOperations(draftSession, base),
          entries,
        ).withdraw.map(({ suggestion }) => suggestion.id),
      ).toEqual(["saved-0", "saved-1"]);
    });
  });

  it("amends one and withdraws the other when typing joins two saved suggestions", () => {
    const draftSession = createSuggestionDraftSession({
      id: "session-join",
      baseContent: "alpha beta gamma",
      baseRevision: "revision-join",
      startedAt: "2026-10-05T11:16:00.000Z",
    });
    const entries = new Map<string, SuggestionPersistenceEntry>();
    const separate = planSuggestionDraftPersistence(
      suggestionDraftOperations(draftSession, "alpha11 beta 22gamma"),
      entries,
    );
    expect(separate.create).toHaveLength(2);
    recordSaved(entries, separate.create, "saved");

    const plan = planSuggestionDraftPersistence(
      suggestionDraftOperations(draftSession, "alpha1122gamma"),
      entries,
    );

    expect(plan.create).toEqual([]);
    expect(plan.amend.map(({ suggestion }) => suggestion.id)).toEqual([
      "saved-0",
    ]);
    expect(plan.withdraw.map(({ suggestion }) => suggestion.id)).toEqual([
      "saved-1",
    ]);
  });

  describe("a save that conflicts with the saved suggestion", () => {
    const conflict = Object.assign(new Error("changed"), {
      errorCode: "suggestion_conflict",
    });
    const isConflict = (error: unknown) => error === conflict;
    const saved = (revision: number, status = "pending") =>
      ({ id: "saved", revision, status }) as ResourceSuggestion;

    it("saves when nothing moved the suggestion", async () => {
      await expect(
        saveUnlessSuggestionChanged(saved(1), async () => "saved at 1", {
          isConflict,
          latest: async () => saved(1),
        }),
      ).resolves.toEqual({ status: "saved", result: "saved at 1" });
    });

    it.each([
      ["another tab amended", saved(2), "changed"],
      ["a reviewer accepted", saved(1, "accepted"), "changed"],
      ["a reviewer rejected", saved(1, "rejected"), "closed"],
      ["its author withdrew", saved(1, "withdrawn"), "closed"],
      ["an outdated accept marked stale", saved(1, "stale"), "closed"],
      ["a newer suggestion superseded", saved(1, "superseded"), "closed"],
      ["someone deleted", undefined, "closed"],
    ] as const)(
      "does not save over a suggestion %s it",
      async (_, latest, outcome) => {
        let attempts = 0;
        const result = await saveUnlessSuggestionChanged(
          saved(1),
          async () => {
            attempts += 1;
            throw conflict;
          },
          { isConflict, latest: async () => latest },
        );
        expect(result).toEqual({ status: outcome });
        expect(attempts).toBe(1);
      },
    );

    it("fails without refreshing on any other error", async () => {
      const outage = new Error("offline");
      let refreshed = false;
      await expect(
        saveUnlessSuggestionChanged(
          saved(1),
          async () => {
            throw outage;
          },
          {
            isConflict,
            latest: async () => {
              refreshed = true;
              return saved(2);
            },
          },
        ),
      ).rejects.toBe(outage);
      expect(refreshed).toBe(false);
    });

    it("fails when the refresh fails", async () => {
      const unreadable = new Error("refresh failed");
      await expect(
        saveUnlessSuggestionChanged(
          saved(1),
          async () => {
            throw conflict;
          },
          {
            isConflict,
            latest: async () => {
              throw unreadable;
            },
          },
        ),
      ).rejects.toBe(unreadable);
    });
  });

  it("gives an amendment a new key once the suggestion it observed advances", () => {
    const keys = new Map<string, string>();
    const at = (revision: number) => ({ id: "saved", revision });
    const firstA = suggestionAmendmentIdempotencyKey(keys, at(1), "A");

    expect(suggestionAmendmentIdempotencyKey(keys, at(1), "A")).toBe(firstA);
    const b = suggestionAmendmentIdempotencyKey(keys, at(2), "B");
    // Undoing B back to A amends revision 3; the server would reject A's
    // first key as a different request.
    const secondA = suggestionAmendmentIdempotencyKey(keys, at(3), "A");

    expect(new Set([firstA, b, secondA]).size).toBe(3);
    expect(suggestionAmendmentIdempotencyKey(keys, at(3), "A")).toBe(secondA);
  });
});

function recordSaved(
  entries: Map<string, SuggestionPersistenceEntry>,
  created: Array<{
    key: string;
    operation: SuggestionPersistenceEntry["operation"];
  }>,
  idPrefix: string,
) {
  created.forEach(({ key, operation }, index) => {
    const id = created.length === 1 ? idPrefix : `${idPrefix}-${index}`;
    entries.set(key, {
      idempotencyKey: `key-${id}`,
      operation,
      suggestion: { id, threadId: `${id}-thread` } as ResourceSuggestion,
    });
  });
}

describe("suggestion drafts on a stored page the editor rewrites", () => {
  // Agent-written pages keep blank lines and pipe tables; the editor shows
  // their canonical form, which here differs by more than one diff can span.
  const rows = Array.from(
    { length: 60 },
    (_, index) => `| ${index + 1} | Step **${index + 1}** | Ana | Done |`,
  );
  const baseContent = [
    "## Plan",
    "",
    "| # | Step | Owner | Status |",
    "|---|---|---|---|",
    ...rows,
    "",
    "- Review the old phrase before Friday.",
    "",
    "Closing **note**.",
  ].join("\n");
  const draftSession = () =>
    createSuggestionDraftSession({
      id: "stored-page",
      baseContent,
      baseRevision: "revision-stored",
      startedAt: "2026-10-02T12:00:00.000Z",
    });

  it("previews a typed edit and anchors it in the stored bytes", () => {
    const draft = canonicalizeNfm(baseContent).replace(
      "old phrase",
      "new wording",
    );
    const preview = previewSuggestionDraft(draftSession(), draft, null);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    let applied = baseContent;
    for (const suggestion of [...preview.suggestions].reverse()) {
      const operation = suggestion.operations[0] as {
        anchor: { from: number; to: number };
        after: { changedText: string };
      };
      expect(draft.slice(suggestion.anchor.from, suggestion.anchor.to)).toBe(
        operation.after.changedText,
      );
      applied =
        applied.slice(0, operation.anchor.from) +
        operation.after.changedText +
        applied.slice(operation.anchor.to);
    }
    expect(applied).toBe(baseContent.replace("old phrase", "new wording"));
  });

  it("records a selected replacement at its stored offsets", () => {
    const session = draftSession();
    const canonical = canonicalizeNfm(baseContent);
    expect(
      recordSuggestionReplacementIntent(
        session,
        {
          beforeText: "old phrase",
          startOffset: canonical.indexOf("old phrase"),
        },
        canonical,
      ),
    ).toBe(true);
    expect(session.replacementIntents).toEqual([
      {
        from: baseContent.indexOf("old phrase"),
        to: baseContent.indexOf("old phrase") + "old phrase".length,
        beforeText: "old phrase",
      },
    ]);
    expect(
      suggestionDraftOperations(
        session,
        canonical.replace("old phrase", "new wording"),
      ),
    ).toMatchObject([
      {
        kind: "replace_text",
        before: { changedText: "old phrase" },
        after: { changedText: "new wording" },
      },
    ]);
  });
});
