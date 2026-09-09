import type { ResourceSuggestion } from "@agent-native/core/review";
import { describe, expect, it } from "vitest";

import {
  createSuggestionDraftSession,
  draftSuggestionsForSession,
  editableSuggestionDraft,
  freshestSavedSuggestions,
  persistSuggestionDraftOperations,
  previewSuggestionDraft,
  recordSuggestionReplacementIntent,
  suggestionDraftOperations,
  suggestionOperationKey,
  suggestionSessionVisuals,
  unpersistedDraftSuggestions,
} from "./draft-session";

describe("suggestion draft session", () => {
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
      existingSuggestion: { id: "saved", threadId: "thread", revision: 1 },
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

    const decidedRemote = savedSuggestion({
      revision: 2,
      status: "accepted",
    });
    expect(freshestSavedSuggestions([local], [decidedRemote])).toEqual([
      decidedRemote,
    ]);
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

  it("materializes once and mode exit reuses the same durable suggestion", async () => {
    const session = createSuggestionDraftSession({
      id: "session-three",
      baseContent: "publish this",
      baseRevision: "revision-three",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const operations = suggestionDraftOperations(session, " this");
    const entries = new Map();
    let creates = 0;
    const create = async () => {
      creates += 1;
      return { id: "saved-once" } as ResourceSuggestion;
    };

    await persistSuggestionDraftOperations(operations, entries, create);
    await persistSuggestionDraftOperations(operations, entries, create);

    expect(creates).toBe(1);
  });

  it("retries only the failed tail with its original idempotency key", async () => {
    const session = createSuggestionDraftSession({
      id: "session-four",
      baseContent: "one old; two old",
      baseRevision: "revision-four",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const operations = suggestionDraftOperations(session, "one new; two fresh");
    expect(operations).toHaveLength(2);
    const entries = new Map();
    const attempts: string[] = [];
    let failTail = true;
    const create = async (_operation: unknown, idempotencyKey: string) => {
      attempts.push(idempotencyKey);
      if (attempts.length === 2 && failTail) {
        failTail = false;
        throw new Error("tail failed");
      }
      return {
        id: `saved-${attempts.length}`,
      } as ResourceSuggestion;
    };

    await expect(
      persistSuggestionDraftOperations(operations, entries, create),
    ).rejects.toThrow("tail failed");
    const draftsAfterFailure = draftSuggestionsForSession(
      session,
      "one new; two fresh",
      null,
    );
    expect(
      unpersistedDraftSuggestions(draftsAfterFailure, entries),
    ).toHaveLength(1);
    const firstAttemptKeys = [...entries.values()].map(
      (entry) => entry.idempotencyKey,
    );
    await persistSuggestionDraftOperations(operations, entries, create);

    expect(attempts).toEqual([
      firstAttemptKeys[0],
      firstAttemptKeys[1],
      firstAttemptKeys[1],
    ]);
  });

  it("keeps confirmed and failed hunk identities when an earlier edit shifts ordinals", async () => {
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
    const entries = new Map();
    let attempt = 0;
    await expect(
      persistSuggestionDraftOperations(initial, entries, async (operation) => {
        attempt += 1;
        if (attempt === 2) throw new Error("ambiguous tail failure");
        return {
          id: "saved-middle",
          threadId: "saved-middle-thread",
        } as ResourceSuggestion;
      }),
    ).rejects.toThrow("ambiguous tail failure");

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

    const retriedOrdinals: number[] = [];
    await persistSuggestionDraftOperations(
      revised,
      entries,
      async (operation) => {
        retriedOrdinals.push(operation.ordinal);
        return {
          id: `saved-${operation.ordinal}`,
        } as ResourceSuggestion;
      },
    );
    expect(retriedOrdinals).toEqual([0, 1]);
  });

  it("keeps confirmed insertion geometry under its durable id after a later hunk fails", async () => {
    const session = createSuggestionDraftSession({
      id: "session-insertion",
      baseContent: "Alpha middle tail old",
      baseRevision: "revision-insertion",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    const draftContent = "Alpha INSERT middle tail fresh";
    const operations = suggestionDraftOperations(session, draftContent);
    expect(operations).toHaveLength(2);
    const entries = new Map();
    let attempt = 0;
    await expect(
      persistSuggestionDraftOperations(operations, entries, async () => {
        attempt += 1;
        if (attempt === 2) throw new Error("tail failed");
        return {
          id: "saved-insertion",
          threadId: "saved-insertion-thread",
        } as ResourceSuggestion;
      }),
    ).rejects.toThrow("tail failed");
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
    expect(
      new Set([
        "saved-insertion",
        ...unpersistedDraftSuggestions(drafts, entries).map(
          (draft) => draft.id,
        ),
      ]).size,
    ).toBe(2);
  });

  it("does not persist when a draft is deleted before materialization", async () => {
    const session = createSuggestionDraftSession({
      id: "session-five",
      baseContent: "unchanged",
      baseRevision: "revision-five",
      startedAt: "2026-09-06T12:00:00.000Z",
    });
    let creates = 0;
    await persistSuggestionDraftOperations(
      suggestionDraftOperations(session, "unchanged"),
      new Map(),
      async () => {
        creates += 1;
        return {} as ResourceSuggestion;
      },
    );
    expect(creates).toBe(0);
  });
});
