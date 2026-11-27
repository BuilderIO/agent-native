import { readFileSync } from "node:fs";

import { mergeDocumentBodyIntents } from "@shared/document-intent-merge";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { CommentThread } from "@/hooks/use-comments";
import type { DocumentUpdateResult } from "@/hooks/use-documents";
import { documentQueryKey } from "@/lib/document-query";
import {
  documentReadFailure,
  trackDocumentReadFailures,
} from "@/lib/document-read-failures";
import { cn } from "@/lib/utils";

import {
  DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME,
  DOCUMENT_EDITOR_TITLE_CLASS_NAME,
} from "./document-editor-layout";
import {
  adoptOwnConfirmedBases,
  databaseMembershipDatabaseTitle,
  documentCanonicalMutationsEnabled,
  documentEditorBreadcrumbItems,
  documentEditorBreadcrumbNavigationItems,
  documentEditorDefaultIconKind,
  documentEditorDatabaseRegionClassName,
  materializedSuggestionForDraft,
  visibleSavedSuggestionsDuringDraftMaterialization,
  observeAcceptedCanonicalSettlement,
  documentEditorReservesInlineReviewSpace,
  documentEditorReviewReadsSettled,
  documentEditorHasFreshAiResolution,
  documentEditorShowsInlineComments,
  documentPagePanelTab,
  infoPropertyCommentStart,
  pendingCommentHeld,
  dismissDocumentCommentFocus,
  documentEditorLoadState,
  collabDocHasText,
  documentTitleWidthChanged,
  documentEditorTitleRegionClassName,
  enqueueDocumentSave,
  enqueueRecoveryDraftTitleSync,
  isDocumentLoadUnavailableError,
  isSuggestionConflictActionError,
  isSuggestionStaleActionError,
  lifecycleKeepaliveDisposition,
  loadedUpdatedAtForSave,
  metadataUpdatesWithPendingTitle,
  namedViewLinkMatchesPage,
  type OwnContentSaveLineage,
  ownConfirmedContentBase,
  pendingCommentTargetMatches,
  pageEditorSessionKey,
  positionAnchoredCommentCard,
  positionUnanchoredCommentCard,
  preciseDraftSuggestionPresentations,
  proposalDecisionPresentations,
  recordOwnContentSave,
  refreshUnchangedContentSaveWatermark,
  replaceAcceptedSuggestionPresentations,
  sameAnchoredCommentPosition,
  suggestionPresentation,
  titleRenamedByAnotherWriter,
  suggestionPresentations,
  suggestionDecisionPreviewContent,
  suggestionToDecideAfterSave,
  sameSuggestionAnchorIds,
  previewDraftSuggestions,
  singleSuggestionDecisionLockAfterMismatch,
  suggestionAmendmentTargetIsResolved,
  suggestionAmendmentResolutionConflicts,
  refreshUnchangedTitleSaveWatermark,
  resizeDocumentTitleTextarea,
  retainThenAdoptDisplacedWinner,
  shouldAdoptServerTitle,
  shouldAttestUnchangedEditorSave,
  shouldSubmitDocumentContent,
  subscribeToAuthoritativeQuerySuccess,
  titleMatchConfirmsSave,
  failedSaveRestoresSavedTitle,
  createTitleMarkCarriers,
  unansweredTitleAfterSave,
  updateAdditionalBlockContents,
  updateDocumentLoadFailureState,
  utilityPanelAfterCommentFocusDismissal,
  visualEditorInstanceKey,
} from "./DocumentEditor";
import {
  breadcrumbFoldWidth,
  compactToolbarBreadcrumbItems,
  firstSelectableBreadcrumbMenuItemId,
} from "./DocumentToolbar";
import { runPageSaveIfSessionActive } from "./pageSession";
import { suggestionOperationKey } from "./suggestions/draft-session";
import {
  markdownSuggestionOperation,
  markdownSuggestionOperations,
} from "./suggestions/markdown-operation";

describe("document editor layout", () => {
  it("waits for canonical Yjs state rather than an isolated suggestion draft", () => {
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "Before");
    paragraph.insert(0, [text]);
    ydoc.getXmlFragment("default").insert(0, [paragraph]);
    const onRendered = vi.fn();
    const onOutdated = vi.fn();
    const stop = observeAcceptedCanonicalSettlement({
      ydoc,
      beforeContent: "Before",
      readbackContent: " AddedBefore",
      onRendered,
      onOutdated,
      onError: vi.fn(),
    });
    expect(onRendered).not.toHaveBeenCalled();
    ydoc.transact(() => {
      text.insert(0, " Added");
      const peerParagraph = new Y.XmlElement("paragraph");
      const peerText = new Y.XmlText();
      peerText.insert(0, "Peer");
      peerParagraph.insert(0, [peerText]);
      ydoc.getXmlFragment("default").insert(1, [peerParagraph]);
    });
    expect(onRendered).not.toHaveBeenCalled();
    expect(onOutdated).toHaveBeenCalledWith(" AddedBefore\nPeer");
    stop();

    const refreshed = vi.fn();
    const stopRefreshed = observeAcceptedCanonicalSettlement({
      ydoc,
      beforeContent: "Before",
      readbackContent: " AddedBefore\nPeer",
      onRendered: refreshed,
      onOutdated,
      onError: vi.fn(),
    });
    expect(refreshed).toHaveBeenCalledTimes(1);
    stopRefreshed();
    ydoc.destroy();
  });

  it("settles an in-mode group only from canonical Yjs without treating intermediate content as failure", () => {
    const canonical = new Y.Doc();
    const draft = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "Before");
    paragraph.insert(0, [text]);
    canonical.getXmlFragment("default").insert(0, [paragraph]);
    const draftParagraph = new Y.XmlElement("paragraph");
    const draftText = new Y.XmlText();
    draftText.insert(0, " AddedBefore");
    draftParagraph.insert(0, [draftText]);
    draft.getXmlFragment("default").insert(0, [draftParagraph]);
    const onRendered = vi.fn();
    const onOutdated = vi.fn();
    const onError = vi.fn();
    const stop = observeAcceptedCanonicalSettlement({
      ydoc: canonical,
      beforeContent: "Before",
      readbackContent: " AddedBefore",
      onRendered,
      onOutdated,
      onError,
    });
    try {
      expect(draftText.toString()).toBe(" AddedBefore");
      expect(onRendered).not.toHaveBeenCalled();
      text.insert(6, " peer");
      expect(onOutdated).toHaveBeenCalledWith("Before peer");
      expect(onRendered).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      canonical.transact(() => {
        text.delete(6, 5);
        text.insert(0, " Added");
      });
      expect(onRendered).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      stop();
      draft.destroy();
      canonical.destroy();
    }
  });

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "keeps an open comment while its portalled menus are used", which clicks a portalled menu of an open comment.

  it("attests an identified revert even when its snapshot matches the saved page", () => {
    const base = {
      hasUpdates: false,
      contentChanged: false,
      editorSessionId: "editor-session",
      editGeneration: 4,
      confirmedEditGeneration: 0,
      isLinkedLocalSource: false,
      isLocalFile: false,
    };

    expect(shouldAttestUnchangedEditorSave(base)).toBe(true);
    expect(
      shouldAttestUnchangedEditorSave({ ...base, editorSessionId: undefined }),
    ).toBe(false);
    expect(
      shouldAttestUnchangedEditorSave({ ...base, editGeneration: 0 }),
    ).toBe(false);
    expect(
      shouldAttestUnchangedEditorSave({ ...base, confirmedEditGeneration: 4 }),
    ).toBe(false);
    expect(
      shouldAttestUnchangedEditorSave({ ...base, confirmedEditGeneration: 3 }),
    ).toBe(true);
    expect(
      shouldAttestUnchangedEditorSave({ ...base, contentChanged: true }),
    ).toBe(false);
    expect(
      shouldAttestUnchangedEditorSave({ ...base, isLocalFile: true }),
    ).toBe(false);
  });

  it("falls back when keepalive stale guards omit changed work", () => {
    expect(
      lifecycleKeepaliveDisposition({
        titleChanged: false,
        contentChanged: true,
        sendsTitle: false,
        sendsContent: false,
      }),
    ).toBe("fallback");
    expect(
      lifecycleKeepaliveDisposition({
        titleChanged: false,
        contentChanged: false,
        sendsTitle: false,
        sendsContent: false,
      }),
    ).toBe("skip");
    expect(
      lifecycleKeepaliveDisposition({
        titleChanged: true,
        contentChanged: true,
        sendsTitle: true,
        sendsContent: false,
      }),
    ).toBe("fallback");
    expect(
      lifecycleKeepaliveDisposition({
        titleChanged: true,
        contentChanged: true,
        sendsTitle: true,
        sendsContent: true,
      }),
    ).toBe("send");
  });

  it("does not adopt a displaced winner after a newer editor generation takes ownership", async () => {
    let releaseRetention!: () => void;
    const currentVersion = 1;
    let currentGeneration = 1;
    const retain = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRetention = resolve;
        }),
    );
    const adopt = vi.fn();
    const result = retainThenAdoptDisplacedWinner({
      ownerVersion: 1,
      currentVersion: () => currentVersion,
      ownerGeneration: 1,
      currentGeneration: () => currentGeneration,
      retain,
      adopt,
    });

    currentGeneration = 2;
    releaseRetention();

    await expect(result).resolves.toBe(false);
    expect(retain).toHaveBeenCalledOnce();
    expect(adopt).not.toHaveBeenCalled();
  });

  it("lets remote stale saves reach the guarded rebase path", () => {
    expect(
      shouldSubmitDocumentContent({
        changed: true,
        stale: true,
        canRebase: true,
      }),
    ).toBe(true);
    expect(
      shouldSubmitDocumentContent({
        changed: true,
        stale: true,
        canRebase: false,
      }),
    ).toBe(false);
    expect(
      shouldSubmitDocumentContent({
        changed: false,
        stale: false,
        canRebase: true,
      }),
    ).toBe(false);
  });
  it("leaves room for title descenders", () => {
    const title = cn(
      DOCUMENT_EDITOR_TITLE_CLASS_NAME,
      DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME,
    );
    expect(title).not.toContain("leading-tight");
    expect(title).toContain("md:pb-0.5");
  });

  it("projects decisions immediately without changing canonical rejection content", () => {
    const suggestion = {
      operations: [
        {
          ordinal: 0,
          kind: "replace_text",
          schemaVersion: 1,
          before: { markdown: "Before" },
          after: { markdown: "After" },
        },
      ],
    };

    expect(
      suggestionDecisionPreviewContent(suggestion, "accepted", "Canonical"),
    ).toBe("After");
    expect(
      suggestionDecisionPreviewContent(suggestion, "rejected", "Canonical"),
    ).toBe("Canonical");
    expect(
      suggestionDecisionPreviewContent(
        suggestion,
        "accepted",
        "Canonical",
        false,
      ),
    ).toBe("Canonical");
  });

  it("releases a decision lock when a non-accept request returns accepted", () => {
    const locked = { inFlight: true, activeSuggestionId: "suggestion" };

    expect(
      singleSuggestionDecisionLockAfterMismatch(locked, "rejected", "accepted"),
    ).toEqual({ inFlight: false, activeSuggestionId: null });
    expect(
      singleSuggestionDecisionLockAfterMismatch(locked, "accepted", "accepted"),
    ).toBe(locked);
  });

  it("keeps a one-operation decision flowing when persistence normalizes its key", () => {
    const suggestion = {
      id: "saved-suggestion",
      operations: [{ ordinal: 0 }],
    } as never;
    const otherSuggestion = {
      id: "other",
      operations: [{ ordinal: 2 }],
    } as never;
    const draft = { operations: [{ ordinal: 1 }] } as never;

    expect(
      materializedSuggestionForDraft(
        new Map([["normalized-operation", suggestion]]),
        draft,
      ),
    ).toBe(suggestion);
    expect(
      materializedSuggestionForDraft(
        new Map([
          ["first", suggestion],
          ["second", otherSuggestion],
        ]),
        draft,
      ),
    ).toBeNull();
  });

  it("hides only the saved copy of a draft while it materializes", () => {
    const draft = {
      operations: [{ ordinal: 0, kind: "insert_text", after: "W" }],
    } as never;
    const optimistic = {
      id: "optimistic",
      operations: [{ ordinal: 1, kind: "insert_text", after: "W" }],
    } as never;
    const unrelated = {
      id: "unrelated",
      operations: [{ ordinal: 1, kind: "insert_text", after: "W" }],
    } as never;
    const sessionNeighbor = {
      id: "session-neighbor",
      operations: [{ ordinal: 2, kind: "insert_text", after: "X" }],
    } as never;
    const saved = [optimistic, unrelated];

    expect(
      visibleSavedSuggestionsDuringDraftMaterialization(
        saved,
        [draft],
        true,
        new Set(["optimistic"]),
      ),
    ).toEqual([unrelated]);
    expect(
      visibleSavedSuggestionsDuringDraftMaterialization(
        saved,
        [draft],
        false,
        new Set(["optimistic"]),
      ),
    ).toEqual(saved);
    expect(
      visibleSavedSuggestionsDuringDraftMaterialization(
        [optimistic, sessionNeighbor],
        [draft],
        true,
        new Set(["optimistic", "session-neighbor"]),
      ),
    ).toEqual([sessionNeighbor]);
  });

  it("decides the saved copy a Suggesting-mode save leaves", () => {
    const typed = markdownSuggestionOperation(
      "One.\n\nTwo.",
      "One typed.\n\nTwo.",
    );
    if (!typed) throw new Error("expected a typed operation");
    const created = { id: "created", revision: 1, operations: [typed] };
    const amended = { id: "amended", revision: 2, operations: [] };
    const persisted = new Map([
      [suggestionOperationKey(typed), created],
      ["amended-operation", amended],
    ]) as never;
    const unrelated = { id: "unrelated", revision: 4 } as never;

    expect(
      suggestionToDecideAfterSave(
        persisted,
        { durability: "draft", id: "draft", operations: [typed] } as never,
        null,
      ),
    ).toBe(created);
    expect(
      suggestionToDecideAfterSave(
        persisted,
        { id: "amended", revision: 1, operations: [] } as never,
        null,
      ),
    ).toBe(amended);
    expect(suggestionToDecideAfterSave(persisted, unrelated, null)).toBe(
      unrelated,
    );
    const editing = { id: "amended", revision: 1, operations: [] } as never;
    const recorded = { id: "amended", revision: 2, baseRevision: "page-2" };
    expect(
      suggestionToDecideAfterSave(
        new Map([["edited-operation", amended]]) as never,
        editing,
        recorded,
      ),
    ).toBe(amended);
    // An earlier save already amended it, so this save had nothing to send.
    expect(
      suggestionToDecideAfterSave(new Map(), editing, recorded),
    ).toMatchObject({ id: "amended", revision: 2, baseRevision: "page-2" });
    // Another tab amended it since, so the card's copy is newer.
    const refreshed = { id: "amended", revision: 3, operations: [] } as never;
    expect(suggestionToDecideAfterSave(new Map(), refreshed, recorded)).toBe(
      refreshed,
    );
  });

  it("keeps review geometry stable after the final inline decision", () => {
    expect(
      documentEditorReservesInlineReviewSpace({
        showInlineComments: false,
        preserveInlineReviewSpace: true,
        hasInlineCommentSpace: true,
        isDatabasePage: false,
      }),
    ).toBe(true);
    expect(
      documentEditorReservesInlineReviewSpace({
        showInlineComments: false,
        preserveInlineReviewSpace: true,
        hasInlineCommentSpace: false,
        isDatabasePage: false,
      }),
    ).toBe(false);
    expect(
      documentEditorReservesInlineReviewSpace({
        showInlineComments: true,
        preserveInlineReviewSpace: true,
        hasInlineCommentSpace: true,
        isDatabasePage: true,
      }),
    ).toBe(false);
  });

  it("keeps remembered review geometry until cached reads finish refreshing", () => {
    expect(
      documentEditorReviewReadsSettled({
        isLocalFileDocument: false,
        hasThreads: true,
        hasSuggestions: true,
        commentsFetching: true,
        suggestionsFetching: false,
        commentsError: false,
        suggestionsError: false,
      }),
    ).toBe(false);
    expect(
      documentEditorReviewReadsSettled({
        isLocalFileDocument: false,
        hasThreads: true,
        hasSuggestions: true,
        commentsFetching: false,
        suggestionsFetching: true,
        commentsError: false,
        suggestionsError: false,
      }),
    ).toBe(false);
    expect(
      documentEditorReviewReadsSettled({
        isLocalFileDocument: false,
        hasThreads: true,
        hasSuggestions: true,
        commentsFetching: false,
        suggestionsFetching: false,
        commentsError: false,
        suggestionsError: false,
      }),
    ).toBe(true);
    expect(
      documentEditorReviewReadsSettled({
        isLocalFileDocument: false,
        hasThreads: true,
        hasSuggestions: true,
        commentsFetching: false,
        suggestionsFetching: false,
        commentsError: true,
        suggestionsError: false,
      }),
    ).toBe(false);
    expect(
      documentEditorReviewReadsSettled({
        isLocalFileDocument: false,
        hasThreads: true,
        hasSuggestions: true,
        commentsFetching: false,
        suggestionsFetching: false,
        commentsError: false,
        suggestionsError: true,
      }),
    ).toBe(false);
  });

  it("does not reschedule identical suggestion anchor state", () => {
    expect(sameSuggestionAnchorIds(["one", "two"], ["one", "two"])).toBe(true);
    expect(sameSuggestionAnchorIds(["two", "one"], ["one", "two"])).toBe(true);
    expect(sameSuggestionAnchorIds(["one"], ["two"])).toBe(false);
    expect(sameSuggestionAnchorIds(null, [])).toBe(false);
  });

  it("keeps one list for a draft it can't map, so the highlights don't redraw every render", () => {
    const unmapped = () =>
      previewDraftSuggestions({
        status: "unsupported-formatting",
        content: "Draft",
      });
    expect(unmapped()).toEqual([]);
    expect(unmapped()).toBe(unmapped());
  });

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "renders the page again only when the placed suggestions change" and VisualEditor.comment-highlights.test.tsx "reports placed suggestions after typing only outside Suggesting", which run the anchor reports.

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "shows the editor's history, and leaves Suggesting's to the editor", which counts the page's renders.
  it("blocks a changed pending selection without dropping its recovery position", () => {
    expect(
      pendingCommentTargetMatches(
        [{ textContent: "Exact " }, { textContent: "selection" }],
        "Exact selection",
      ),
    ).toBe(true);
    expect(pendingCommentTargetMatches([], "Exact selection")).toBe(false);
    expect(
      pendingCommentTargetMatches(
        [{ textContent: "Different selection" }],
        "Exact selection",
      ),
    ).toBe(false);
    expect(
      positionUnanchoredCommentCard({
        containerRect: { top: -100, width: 280 },
        boundaryRect: { top: 0, bottom: 600 },
      }),
    ).toEqual({
      left: 16,
      top: 116,
      width: 248,
      maxHeight: 568,
      placement: "below",
    });
  });
  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "checks the page still marks it whenever the comment moves, not as it's written", which starts and types a comment.
  it("keeps an unchanged anchored comment position out of state", () => {
    const position = {
      left: 16,
      top: 120,
      width: 248,
      maxHeight: 568,
      placement: "below" as const,
    };
    expect(sameAnchoredCommentPosition(position, { ...position })).toBe(true);
    expect(sameAnchoredCommentPosition(null, null)).toBe(true);
    expect(sameAnchoredCommentPosition(null, position)).toBe(false);
    expect(
      sameAnchoredCommentPosition(position, { ...position, top: 121 }),
    ).toBe(false);
    expect(
      sameAnchoredCommentPosition(position, { ...position, maxHeight: 400 }),
    ).toBe(false);
    expect(
      sameAnchoredCommentPosition(position, {
        ...position,
        placement: "above",
      }),
    ).toBe(false);
  });
  // oracle-change: replaced by VisualEditor.comment-highlights.test.tsx "hides a suggestion with comment indicators and still reports it placed", which renders the real editor.
  // oracle-change: the source half is now "locks the title, icon and embedded blocks while Suggesting" in DocumentEditor.recovery-save-state.test.tsx. The title paste check repeats handleTitleChange's own guard, so removing it alone changes nothing a user sees.
  it("blocks every document metadata mutation while suggesting", () => {
    expect(documentCanonicalMutationsEnabled(true, false)).toBe(true);
    expect(documentCanonicalMutationsEnabled(false, false)).toBe(false);
    expect(documentCanonicalMutationsEnabled(true, true)).toBe(false);
  });

  // oracle-change: replaced by "keeps the Suggesting draft out of the Page's own reconcile" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by "saves words typed during an autosave when Suggesting ends before it answers" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by the two "withdraws a reopened suggestion typed back to the Page" tests in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by "gives an amendment typed back to earlier words a new idempotency key" in DocumentEditor.recovery-save-state.test.tsx.

  it("recognizes resolved amendment targets and action conflicts", () => {
    expect(
      suggestionAmendmentTargetIsResolved("suggestion-1", [
        { id: "suggestion-1", status: "pending" },
      ]),
    ).toBe(false);
    expect(
      suggestionAmendmentTargetIsResolved("suggestion-1", [
        { id: "suggestion-1", status: "accepted" },
      ]),
    ).toBe(true);
    expect(
      isSuggestionConflictActionError(
        Object.assign(new Error("changed"), {
          errorCode: "suggestion_conflict",
        }),
      ),
    ).toBe(true);
    expect(isSuggestionConflictActionError(new Error("network"))).toBe(false);
    // oracle-change: the source checks became "leaves an unchanged reopened suggestion another tab accepted without amending it" and "drops the amendment alert once the reopened suggestion is typed back to what was saved" in DocumentEditor.recovery-save-state.test.tsx.
  });

  it.each(["accepted", "rejected"] as const)(
    "does not report an own %s single decision as an amendment conflict",
    (decision) => {
      expect(
        suggestionAmendmentResolutionConflicts(
          "amended",
          [{ id: "amended", status: decision }],
          [{ id: "amended", decision }],
        ),
      ).toBe(false);
    },
  );

  it.each(["accepted", "rejected"] as const)(
    "does not report an own %s group member decision as an amendment conflict",
    (decision) => {
      expect(
        suggestionAmendmentResolutionConflicts(
          "amended",
          [{ id: "amended", status: decision }],
          [
            { id: "another-member", decision },
            { id: "amended", decision },
          ],
        ),
      ).toBe(false);
    },
  );

  it("retains external, unrelated, stale and mismatched amendment conflicts", () => {
    for (const status of ["accepted", "rejected", "stale"] as const) {
      const suggestions = [{ id: "amended", status }];
      expect(
        suggestionAmendmentResolutionConflicts("amended", suggestions, []),
      ).toBe(true);
      expect(
        suggestionAmendmentResolutionConflicts("amended", suggestions, [
          { id: "unrelated", decision: "accepted" },
        ]),
      ).toBe(true);
      expect(
        suggestionAmendmentResolutionConflicts("amended", suggestions, [
          {
            id: "amended",
            decision: status === "accepted" ? "rejected" : "accepted",
          },
        ]),
      ).toBe(true);
    }
  });

  it("refreshes a remaining insertion anchor after accepting an earlier nearby replacement", () => {
    const before =
      "Alpha Beta Gamma. Added words.\nThe team will publish on Friday.";
    const operations = markdownSuggestionOperations(
      before,
      before.replace("Alpha", "First").replace("words.", "words. Next."),
    );
    const current = before.replace("Alpha", "First");
    const insertion = operations.find(
      (operation) => operation.kind === "insert_text",
    )!;
    const presentation = suggestionPresentation(
      { id: "later", status: "pending", operations: [insertion] },
      current,
    );
    expect(presentation?.anchor).toEqual({
      from: current.indexOf("\n"),
      prefix: current.slice(0, current.indexOf("\n")),
      suffix: current.slice(current.indexOf("\n"), current.indexOf("\n") + 32),
    });
    expect(presentation?.afterText).toBe(" Next.");
    expect(presentation?.afterPresentation).toEqual({
      source: insertion.after.markdown,
      from: insertion.anchor.from,
      to: insertion.anchor.from + insertion.after.changedText.length,
    });
  });
  it("shows precise regions for an existing broad suggestion without splitting its decision", () => {
    const before = "We shipped quickly, and the results were good.";
    const after = "We shipped quickly and the results were excellent.";
    const saved = markdownSuggestionOperation(before, after)!;
    const precise = suggestionPresentations(
      { id: "existing", status: "pending", operations: [saved] },
      before,
    );

    expect(precise).toHaveLength(2);
    expect(precise.map((part) => part.id)).toEqual(["existing", "existing"]);
    expect(precise.map((part) => part.beforeText)).toEqual([",", "good"]);
    expect(precise.map((part) => part.afterText)).toEqual(["", "excellent"]);
  });
  it("CSD-12: presents whole words for a saved replacement on a formatted page", () => {
    const before =
      "- **Release:** Wrenfield goes on sale Thursday, October 3.\n- **Styles:** Light to Black.";
    const after = before.replace("Thursday, October 3", "Friday, October 2");
    const saved = markdownSuggestionOperation(before, after)!;
    expect(saved.kind).toBe("replace_text");
    const precise = suggestionPresentations(
      { id: "existing", status: "pending", operations: [saved] },
      before,
    );
    expect(precise.map((part) => part.id)).toEqual(["existing", "existing"]);
    expect(precise.map((part) => [part.beforeText, part.afterText])).toEqual([
      ["Thursday", "Friday"],
      ["3", "2"],
    ]);
  });
  it("replaces every accepted span while preserving another proposal's precise spans", () => {
    const before = "We shipped quickly, and the results were good.";
    const after = "We shipped quickly and the results were excellent.";
    const operation = markdownSuggestionOperation(before, after)!;
    const acceptedSpans = suggestionPresentations(
      { id: "accepted", status: "pending", operations: [operation] },
      before,
    );
    const otherSpans = suggestionPresentations(
      { id: "other", status: "pending", operations: [operation] },
      before,
    );
    const overlays = acceptedSpans.map((span) => ({
      ...span,
      presentation: "settling" as const,
    }));
    const ordinary = [
      acceptedSpans[0]!,
      otherSpans[0]!,
      acceptedSpans[1]!,
      otherSpans[1]!,
    ];

    expect(acceptedSpans).toHaveLength(2);
    expect(otherSpans).toHaveLength(2);
    expect(replaceAcceptedSuggestionPresentations(ordinary, overlays)).toEqual([
      otherSpans[0],
      otherSpans[1],
      ...overlays,
    ]);
    expect(replaceAcceptedSuggestionPresentations(ordinary, null)).toEqual(
      ordinary,
    );
  });

  it("keeps an unrelated suggestion visible between accepted replacement spans", () => {
    const before = "We shipped quickly, and the results were good.";
    const acceptedOperation = markdownSuggestionOperation(
      before,
      "We shipped quickly and the results were excellent.",
    )!;
    const unrelatedOperation = markdownSuggestionOperation(
      before,
      before.replace("results", "findings"),
    )!;
    const accepted = {
      id: "accepted",
      status: "pending" as const,
      operations: [acceptedOperation],
    };
    const unrelated = {
      id: "unrelated",
      status: "pending" as const,
      operations: [unrelatedOperation],
    };
    const acceptedSpans = suggestionPresentations(accepted, before);
    const unrelatedSpan = suggestionPresentations(unrelated, before)[0]!;
    const overlays = suggestionPresentations(accepted, before).map((span) => ({
      ...span,
      presentation: "settling" as const,
    }));

    const presented = replaceAcceptedSuggestionPresentations(
      [...acceptedSpans, unrelatedSpan],
      overlays,
    );

    expect(acceptedSpans).toHaveLength(2);
    expect(presented).toEqual([unrelatedSpan, ...overlays]);
    const unrelatedBefore = unrelatedSpan.beforePresentation!;
    const unrelatedFrom = unrelatedBefore.from!;
    const unrelatedTo = unrelatedBefore.to!;
    for (const overlay of overlays) {
      const overlayBefore = overlay.beforePresentation!;
      const overlayFrom = overlayBefore.from!;
      const overlayTo = overlayBefore.to!;
      expect(overlayTo <= unrelatedFrom || unrelatedTo <= overlayFrom).toBe(
        true,
      );
    }
  });

  it("replaces a single accepted span without changing unrelated presentations", () => {
    const before = "Before";
    const operation = markdownSuggestionOperation(before, " AddedBefore")!;
    const acceptedSpans = suggestionPresentations(
      { id: "accepted", status: "pending", operations: [operation] },
      before,
    );
    const other = suggestionPresentations(
      { id: "other", status: "pending", operations: [operation] },
      before,
    )[0]!;
    const overlay = { ...acceptedSpans[0]!, presentation: "settling" as const };

    expect(acceptedSpans).toHaveLength(1);
    expect(
      replaceAcceptedSuggestionPresentations(
        [other, acceptedSpans[0]!],
        overlay,
      ),
    ).toEqual([other, overlay]);
  });
  it("keeps accepted group spans projected while Suggesting continues", () => {
    const before = "Before and After";
    const members = [
      {
        id: "first",
        status: "accepted",
        operations: [
          markdownSuggestionOperation(before, " AddedBefore and After")!,
        ],
      },
      {
        id: "second",
        status: "accepted",
        operations: [
          markdownSuggestionOperation(before, "Before and Extra After")!,
        ],
      },
    ];
    const unrelated = {
      id: "unrelated",
      status: "pending",
      operations: [markdownSuggestionOperation(before, `${before}!`)!],
    };
    const ordinary = [...members, unrelated].flatMap((member) =>
      suggestionPresentations({ ...member, status: "pending" }, before),
    );

    const readback = " AddedBefore and Extra After";
    const decision = {
      generation: 1,
      continueSuggesting: true,
      accepted: true,
      members: members as never,
      beforeContent: before,
      readbackContent: readback,
    };
    const presented = proposalDecisionPresentations(ordinary, decision);
    expect(presented.map((part) => [part.id, part.presentation])).toEqual([
      ["unrelated", "canonical"],
      ["first", "settling"],
      ["second", "settling"],
    ]);
    expect(presented[0]).toBe(ordinary[2]);
    expect(
      presented.slice(1).map((part) => part.settlementReadbackContent),
    ).toEqual([readback, readback]);
  });
  it("draws a draft that mostly rewrites a paragraph as it draws once saved", () => {
    const before =
      "It turns out that a lot of people in town had the same problem, and the response was much bigger than expected.";
    const after =
      "Plenty of neighbors had the same problem, and the shelf grew.";
    const operation = markdownSuggestionOperation(before, after);
    if (!operation) throw new Error("no operation");
    const from = operation.anchor.from;
    const drawn = (
      presentations: ReturnType<typeof suggestionPresentations> | null,
    ) =>
      presentations?.map(({ beforeText, afterText }) => [
        beforeText,
        afterText,
      ]);
    const draft = preciseDraftSuggestionPresentations(
      {
        id: "editing",
        operations: [operation],
        anchor: {
          from,
          to: from + operation.after.changedText.length,
          prefix: "",
          suffix: "",
        },
      } as never,
      after,
    );
    const saved = suggestionPresentations(
      { id: "saved", status: "pending", operations: [operation] },
      before,
    );
    expect(drawn(draft)).toEqual([
      [
        "It turns out that a lot of people in town had the same problem, and the response was much bigger than expected",
        "Plenty of neighbors had the same problem, and the shelf grew",
      ],
    ]);
    expect(drawn(draft)).toEqual(drawn(saved));
  });
  it("maps multi-hunk draft previews through the parent anchor into the current draft", () => {
    const before =
      "Old red lanterns shine through the western pines. Nearby insects glow softly.";
    const after =
      "Bright red lanterns shine through the eastern pines. Nearby insects glow softly.";
    const prefix = "Earlier draft. ";
    const currentMarkdown = `${prefix}${after}`;
    const operation = markdownSuggestionOperation(before, after)!;
    const mappedFrom = currentMarkdown.indexOf(operation.after.changedText);
    const presentations = preciseDraftSuggestionPresentations(
      {
        id: "editing",
        operations: [operation],
        anchor: {
          from: mappedFrom,
          to: mappedFrom + operation.after.changedText.length,
          prefix: currentMarkdown.slice(
            Math.max(0, mappedFrom - 32),
            mappedFrom,
          ),
          suffix: currentMarkdown.slice(
            mappedFrom + operation.after.changedText.length,
            mappedFrom + operation.after.changedText.length + 32,
          ),
        },
      } as never,
      currentMarkdown,
    );
    const unrelated = suggestionPresentations(
      {
        id: "unrelated",
        status: "pending",
        operations: [
          markdownSuggestionOperation(
            currentMarkdown,
            currentMarkdown.replace("lanterns", "beacon"),
          )!,
        ],
      },
      currentMarkdown,
    )[0]!;

    expect(
      presentations?.map(({ beforeText, afterText }) => [
        beforeText,
        afterText,
      ]),
    ).toEqual([
      ["Old", "Bright"],
      ["western", "eastern"],
    ]);
    expect(
      presentations?.map(({ anchor, afterText }) =>
        currentMarkdown.slice(anchor.from, anchor.from + afterText.length),
      ),
    ).toEqual(["Bright", "eastern"]);
    expect(
      presentations?.every(
        ({ anchor, afterText }) =>
          anchor.from + afterText.length <= unrelated.anchor.from ||
          unrelated.anchor.from + unrelated.beforeText.length <= anchor.from,
      ),
    ).toBe(true);
  });
  it("shifts a saved suggestion anchor past a new earlier draft insertion", () => {
    const before = "Alpha publish Friday";
    const [deletion] = markdownSuggestionOperations(before, "Alpha  Friday");
    const current = `New ${before}`;

    const presentation = suggestionPresentation(
      { id: "saved", status: "pending", operations: [deletion!] },
      current,
    );

    expect(presentation?.anchor.from).toBe(current.indexOf("publish"));
    expect(presentation?.beforeText).toBe("publish");
    expect(presentation?.beforePresentation).toEqual({
      source: deletion!.before.markdown,
      from: deletion!.anchor.from,
      to: deletion!.anchor.to,
    });
  });
  // oracle-change: the page's Escape moved into usePagePanelEscape; that a
  // menu's Escape leaves comment focus alone is pressed in CommentsSidebar.escape.
  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "moves its comments beside the text without measuring itself moved", which lays out the margin.
  it("opens an accept that can't be placed instead of treating it as accepted", () => {
    expect(
      isSuggestionStaleActionError(
        Object.assign(new Error("moved"), { errorCode: "suggestion_stale" }),
      ),
    ).toBe(true);
    expect(
      isSuggestionStaleActionError(
        Object.assign(new Error("changed"), {
          errorCode: "suggestion_conflict",
        }),
      ),
    ).toBe(false);
    expect(isSuggestionStaleActionError(new Error("network"))).toBe(false);
    // oracle-change: the source checks became "opens Discussion on a saved edit/proposal whose accept can't be placed instead of treating it as accepted" in DocumentEditor.recovery-save-state.test.tsx.
  });
  it("dismisses mobile comment focus without closing Info", () => {
    expect(utilityPanelAfterCommentFocusDismissal("comments")).toBeNull();
    expect(utilityPanelAfterCommentFocusDismissal("info")).toBe("info");
    expect(utilityPanelAfterCommentFocusDismissal(null)).toBeNull();
  });

  it.each([
    [true, true, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ] as const)(
    "dismisses comment focus with history=%s and margin=%s without closing what still shows it: closes=%s",
    (commentsHistoryDrawerOpen, hasInlineCommentSpace, closesPanel) => {
      const closeReply = vi.fn();
      const clearFocus = vi.fn();
      const closePanel = vi.fn();
      dismissDocumentCommentFocus({
        commentsHistoryDrawerOpen,
        hasInlineCommentSpace,
        closeReply,
        clearFocus,
        closePanel,
      });
      expect(closeReply).toHaveBeenCalledOnce();
      expect(clearFocus).toHaveBeenCalledOnce();
      // oracle-change: the old utility panel layout became DocumentPagePanel, tested by its own suites.
      expect(closePanel).toHaveBeenCalledTimes(closesPanel ? 1 : 0);
    },
  );

  it("keeps the selected inline conversation visible after its last thread resolves", () => {
    expect(
      documentEditorShowsInlineComments({
        showIndicators: true,
        hasInlineCommentSpace: true,
        hasOpenCommentThreads: false,
        hasSelectedCommentThread: true,
        hasPendingComment: false,
      }),
    ).toBe(true);
  });

  it("keeps the margin for a thread AI just resolved, even the page's last", () => {
    const resolved = {
      threadId: "quoted",
      resolved: true,
      quotedText: "soft labels",
    } as CommentThread;
    const onPage = {
      threadId: "page",
      resolved: true,
      quotedText: null,
    } as CommentThread;
    const fresh = new Map([
      ["quoted", {}],
      ["page", {}],
    ]);
    expect(documentEditorHasFreshAiResolution([resolved], null, fresh)).toBe(
      true,
    );
    // Once its Resolved by AI mark fades, it no longer holds the margin.
    expect(
      documentEditorHasFreshAiResolution([resolved], null, new Map()),
    ).toBe(false);
    // A comment on the whole page lives in Discussion, not the margin.
    expect(documentEditorHasFreshAiResolution([onPage], null, fresh)).toBe(
      false,
    );
    expect(documentEditorHasFreshAiResolution(undefined, null, fresh)).toBe(
      false,
    );
  });

  it("holds the margin only for a thread AI just resolved in the open tab", () => {
    const inNotes = {
      threadId: "notes",
      resolved: true,
      quotedText: "soft labels",
      field: { fieldId: "notes-field", fieldName: "Notes" },
    } as CommentThread;
    const inBody = {
      threadId: "body",
      resolved: true,
      quotedText: "soft labels",
    } as CommentThread;
    const fresh = new Map([["body", {}]]);
    const threads = [inNotes, inBody];
    expect(documentEditorHasFreshAiResolution(threads, null, fresh)).toBe(true);
    // In another tab its mark isn't on screen to fade, so it would hold an
    // empty margin until the body's tab came back.
    expect(
      documentEditorHasFreshAiResolution(threads, "notes-field", fresh),
    ).toBe(false);
  });

  it("does not clip a printed page at the root's screen height", () => {
    const css = readFileSync("app/global.css", { encoding: "utf8" });
    const printRoot = css.match(
      /@media print[\s\S]*?\n  \[data-document-print-root\] \{([^}]*)\}/,
    )?.[1];

    expect(printRoot).toContain("overflow: visible !important");
    expect(printRoot).toContain("height: auto !important");
    expect(printRoot).toContain("inset: 0 0 auto !important");
  });

  describe("infoPropertyCommentStart", () => {
    it("starts one with none started, or over an empty one elsewhere", () => {
      expect(infoPropertyCommentStart(null, "a")).toBe("start");
      expect(
        infoPropertyCommentStart({ propertyId: "b", written: false }, "a"),
      ).toBe("start");
      expect(infoPropertyCommentStart({ written: false }, "a")).toBe("start");
    });

    it("opens one already started on the Property as it was", () => {
      expect(
        infoPropertyCommentStart({ propertyId: "a", written: true }, "a"),
      ).toBe("reopen");
      expect(
        infoPropertyCommentStart({ propertyId: "a", written: false }, "a"),
      ).toBe("reopen");
    });

    it("goes back to words under another Property or beside the Page's text", () => {
      expect(
        infoPropertyCommentStart({ propertyId: "b", written: true }, "a"),
      ).toBe("returnToProperty");
      expect(infoPropertyCommentStart({ written: true }, "a")).toBe(
        "returnToPage",
      );
    });
  });

  describe("pendingCommentHeld", () => {
    const properties = [{ definition: { id: "a" } }];

    it("holds words under a Property on the Page, or beside its text", () => {
      expect(
        pendingCommentHeld({ propertyId: "a", written: true }, properties),
      ).toBe(true);
      expect(pendingCommentHeld({ written: true }, properties)).toBe(true);
    });

    it("lets go of one with no words, or whose Property was deleted", () => {
      expect(
        pendingCommentHeld({ propertyId: "a", written: false }, properties),
      ).toBe(false);
      expect(
        pendingCommentHeld({ propertyId: "b", written: true }, properties),
      ).toBe(false);
    });

    it("holds one while the Properties aren't read yet", () => {
      expect(
        pendingCommentHeld({ propertyId: "a", written: true }, undefined),
      ).toBe(true);
    });
  });

  describe("documentPagePanelTab", () => {
    const closed = {
      agentInPanel: false,
      commentsHistoryDrawerOpen: false,
      utilityPanel: null,
      selectedSuggestionId: null,
      hasInlineCommentSpace: true,
    };

    it("leaves a comment in focus to the margin", () => {
      expect(
        documentPagePanelTab({ ...closed, utilityPanel: "comments" }),
      ).toBeNull();
    });

    it("opens for Discussion, Info and the agent, the agent first", () => {
      expect(
        documentPagePanelTab({
          ...closed,
          utilityPanel: "comments",
          commentsHistoryDrawerOpen: true,
        }),
      ).toBe("comments");
      expect(documentPagePanelTab({ ...closed, utilityPanel: "info" })).toBe(
        "info",
      );
      expect(
        documentPagePanelTab({
          ...closed,
          agentInPanel: true,
          utilityPanel: "info",
        }),
      ).toBe("agent");
    });

    it("shows a selected suggestion that has no margin to open beside", () => {
      const selected = {
        ...closed,
        utilityPanel: "comments" as const,
        selectedSuggestionId: "saved-suggestion",
      };
      expect(documentPagePanelTab(selected)).toBeNull();
      expect(
        documentPagePanelTab({ ...selected, hasInlineCommentSpace: false }),
      ).toBe("comments");
    });

    it("does not open merely because a draft changed", () => {
      expect(
        documentPagePanelTab({
          ...closed,
          utilityPanel: "comments",
          hasInlineCommentSpace: false,
        }),
      ).toBeNull();
    });
  });

  it("rejects a pending comment target when its exact rendered text disappears or changes", () => {
    expect(
      pendingCommentTargetMatches(
        [{ textContent: "exact " }, { textContent: "selection" }],
        "exact selection",
      ),
    ).toBe(true);
    expect(
      pendingCommentTargetMatches(
        [{ textContent: "edited selection" }],
        "exact selection",
      ),
    ).toBe(false);
    expect(pendingCommentTargetMatches([], "exact selection")).toBe(false);
  });

  it("keeps an unanchored compact comment card visible at the viewport edge", () => {
    expect(
      positionUnanchoredCommentCard({
        containerRect: { top: -240, width: 390 },
        boundaryRect: { top: 0, bottom: 720 },
      }),
    ).toEqual({
      left: 16,
      top: 256,
      width: 320,
      maxHeight: 688,
      placement: "below",
    });
  });

  it("ignores delayed additional-field cleanup from the previous document", () => {
    const current = { sharedProperty: "document B live value" };
    expect(
      updateAdditionalBlockContents({
        current,
        activeDocumentId: "document-b",
        sourceDocumentId: "document-a",
        propertyId: "sharedProperty",
        content: null,
      }),
    ).toBe(current);
  });

  it("centers a compact comment card below its paragraph when space permits", () => {
    expect(
      positionAnchoredCommentCard({
        anchorRect: { top: 100, bottom: 160, left: 100, right: 500 },
        containerRect: {
          top: 0,
          bottom: 800,
          left: 0,
          right: 700,
          width: 700,
        },
        cardHeight: 180,
      }),
    ).toEqual({
      left: 140,
      top: 164,
      width: 320,
      maxHeight: 768,
      placement: "below",
    });
  });

  it("flips a compact comment card above and clamps it within the viewport", () => {
    expect(
      positionAnchoredCommentCard({
        anchorRect: { top: 620, bottom: 700, left: -50, right: 150 },
        containerRect: {
          top: 0,
          bottom: 720,
          left: 0,
          right: 360,
          width: 360,
        },
        cardHeight: 220,
      }),
    ).toEqual({
      left: 16,
      top: 396,
      width: 320,
      maxHeight: 688,
      placement: "above",
    });
  });

  it("uses the visible scroller as the compact card boundary", () => {
    expect(
      positionAnchoredCommentCard({
        anchorRect: { top: 620, bottom: 700, left: 100, right: 500 },
        containerRect: {
          top: -300,
          bottom: 1500,
          left: 0,
          right: 700,
          width: 700,
        },
        boundaryRect: { top: 0, bottom: 720 },
        cardHeight: 220,
      }),
    ).toEqual({
      left: 140,
      top: 696,
      width: 320,
      maxHeight: 688,
      placement: "above",
    });
  });

  it("caps a long comment card to the visible scroller", () => {
    expect(
      positionAnchoredCommentCard({
        anchorRect: { top: 300, bottom: 340, left: 100, right: 500 },
        containerRect: {
          top: -900,
          bottom: 3000,
          left: 0,
          right: 700,
          width: 700,
        },
        boundaryRect: { top: 0, bottom: 500 },
        cardHeight: 1600,
      }),
    ).toEqual({
      left: 140,
      top: 916,
      width: 320,
      maxHeight: 468,
      placement: "above",
    });
  });
  it("keeps a local-file editor mounted when its saved timestamp advances", () => {
    const key = (documentUpdatedAt: string) =>
      visualEditorInstanceKey({
        documentId: "local-file",
        documentUpdatedAt,
        isLocalFileDocument: true,
        canEdit: true,
        collabEditorEnabled: false,
        hasYDoc: false,
      });

    expect(key("2026-08-18T11:00:00.000Z")).toBe("local-file:local-file:0");
    expect(key("2026-08-18T11:00:01.000Z")).toBe("local-file:local-file:0");
  });

  it("resets local undo history after an external disk reconciliation", () => {
    const key = (localFileSyncRevision: number) =>
      visualEditorInstanceKey({
        documentId: "local-file",
        documentUpdatedAt: "2026-08-18T11:00:00.000Z",
        isLocalFileDocument: true,
        canEdit: true,
        collabEditorEnabled: false,
        hasYDoc: false,
        localFileSyncRevision,
      });

    expect(key(0)).not.toBe(key(1));
  });

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "says when the file was deleted and stops editing", which reads a deleted file.

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "stays read-only, without saying it's deleted, when this client can't reach the file" and DocumentToolbar.clipboard.test.tsx "offers only the relative path of a local file this tab can't edit", which render both.

  // oracle-change: replaced by "tells other tabs about typing in the keystroke that made it" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by "holds typing out of autosave while a recovery prompt is open" in DocumentEditor.recovery-save-state.test.tsx.

  it("keeps a seeded document behind the skeleton while its fetch is pending", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: null,
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: false,
        isFetching: true,
        isError: false,
        hasLoadFailure: false,
        isManualRetrying: false,
        error: null,
      }),
    ).toEqual({ view: "skeleton", admittedDocumentId: null });
  });

  it("does not treat an external cache write as success while the first fetch is pending", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: null,
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: true,
        isError: false,
        hasLoadFailure: false,
        isManualRetrying: false,
        error: null,
      }),
    ).toEqual({ view: "skeleton", admittedDocumentId: null });
  });

  it("draws a visited collab page from its cached read while this open's read runs", () => {
    const visited = {
      documentId: "document-a",
      admittedDocumentId: null,
      hasDocument: true,
      isDocumentCreationPending: false,
      isFetchedAfterMount: false,
      isFetching: true,
      isError: false,
      hasLoadFailure: false,
      isManualRetrying: false,
      error: null,
    };
    expect(
      documentEditorLoadState({ ...visited, canOpenFromCache: true }),
    ).toEqual({ view: "editor", admittedDocumentId: "document-a" });
    // A page whose body is not a collab doc waits for the read.
    expect(documentEditorLoadState(visited)).toEqual({
      view: "skeleton",
      admittedDocumentId: null,
    });
  });

  it("gives a page drawn from its cached read up when this open's read fails", () => {
    const drawn = {
      documentId: "document-a",
      admittedDocumentId: "document-a",
      hasDocument: true,
      canOpenFromCache: true,
      isDocumentCreationPending: false,
      isFetchedAfterMount: false,
      isFetching: false,
      isManualRetrying: false,
    };
    // Deleted, trashed, or no longer shared since the cached read.
    expect(
      documentEditorLoadState({
        ...drawn,
        isError: true,
        hasLoadFailure: true,
        error: { status: 404 },
      }),
    ).toEqual({ view: "unavailable", admittedDocumentId: null });
    expect(
      documentEditorLoadState({
        ...drawn,
        isError: true,
        hasLoadFailure: true,
        error: { status: 500 },
      }),
    ).toEqual({ view: "error", admittedDocumentId: "document-a" });
  });

  it("reads text from a collab doc before any editor projects it", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    expect(collabDocHasText(null)).toBe(false);
    expect(collabDocHasText(doc)).toBe(false);
    const empty = new Y.XmlElement("paragraph");
    const image = new Y.XmlElement("image");
    image.setAttribute("src", "https://example.test/a.png");
    fragment.insert(0, [empty, image]);
    // Markup and attributes are not text, so such a doc waits for a fresh read.
    expect(collabDocHasText(doc)).toBe(false);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Saved words")]);
    fragment.insert(2, [paragraph]);
    expect(collabDocHasText(doc)).toBe(true);
    doc.destroy();
  });

  it("shows a successful create response while its first read is pending", () => {
    expect(
      documentEditorLoadState({
        documentId: "new-document",
        admittedDocumentId: null,
        hasDocument: true,
        isDocumentCreationConfirmed: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: false,
        isFetching: true,
        isError: false,
        hasLoadFailure: false,
        isManualRetrying: false,
        error: null,
      }),
    ).toEqual({ view: "editor", admittedDocumentId: "new-document" });
  });

  it("surfaces a first-read failure after admitting a confirmed create response", () => {
    const admitted = documentEditorLoadState({
      documentId: "new-document",
      admittedDocumentId: null,
      hasDocument: true,
      isDocumentCreationConfirmed: true,
      isDocumentCreationPending: false,
      isFetchedAfterMount: false,
      isFetching: true,
      isError: false,
      hasLoadFailure: false,
      isManualRetrying: false,
      error: null,
    });
    const initialLoadFailure = updateDocumentLoadFailureState({
      previous: null,
      documentId: "new-document",
      admitted: false,
      isDocumentCreationConfirmed: true,
      dataUpdatedAt: 1,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      isError: false,
      authoritativeSuccess: {
        queryIdentity: "new-document",
        generation: 0,
        errorUpdateCount: 0,
      },
    });
    const loadFailure = updateDocumentLoadFailureState({
      previous: initialLoadFailure,
      documentId: "new-document",
      admitted: admitted.admittedDocumentId === "new-document",
      isDocumentCreationConfirmed: true,
      dataUpdatedAt: 1,
      errorUpdateCount: 1,
      errorUpdatedAt: 2,
      isError: true,
      authoritativeSuccess: {
        queryIdentity: "new-document",
        generation: 0,
        errorUpdateCount: 0,
      },
    });

    expect(loadFailure.failed).toBe(true);
    expect(
      documentEditorLoadState({
        documentId: "new-document",
        admittedDocumentId: admitted.admittedDocumentId,
        hasDocument: true,
        isDocumentCreationConfirmed: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
        hasLoadFailure: loadFailure.failed,
        isManualRetrying: false,
        error: new Error("read failed"),
      }).view,
    ).toBe("error");
  });

  it("keeps a created page open when a background refetch fails after success", () => {
    const initial = updateDocumentLoadFailureState({
      previous: null,
      documentId: "new-document",
      admitted: false,
      isDocumentCreationConfirmed: true,
      dataUpdatedAt: 1,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      isError: false,
      authoritativeSuccess: {
        queryIdentity: "new-document",
        generation: 0,
        errorUpdateCount: 0,
      },
    });
    const admitted = documentEditorLoadState({
      documentId: "new-document",
      admittedDocumentId: null,
      hasDocument: true,
      isDocumentCreationConfirmed: true,
      isDocumentCreationPending: false,
      isFetchedAfterMount: false,
      isFetching: true,
      isError: false,
      hasLoadFailure: initial.failed,
      isManualRetrying: false,
      error: null,
    });
    const afterFirstRead = updateDocumentLoadFailureState({
      previous: initial,
      documentId: "new-document",
      admitted: admitted.admittedDocumentId === "new-document",
      isDocumentCreationConfirmed: false,
      dataUpdatedAt: 2,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      isError: false,
      authoritativeSuccess: {
        queryIdentity: "new-document",
        generation: 1,
        errorUpdateCount: 0,
      },
    });
    const backgroundFailure = updateDocumentLoadFailureState({
      previous: afterFirstRead,
      documentId: "new-document",
      admitted: true,
      isDocumentCreationConfirmed: false,
      dataUpdatedAt: 2,
      errorUpdateCount: 1,
      errorUpdatedAt: 3,
      isError: true,
      authoritativeSuccess: {
        queryIdentity: "new-document",
        generation: 1,
        errorUpdateCount: 0,
      },
    });

    expect(backgroundFailure.failed).toBe(false);
    expect(
      documentEditorLoadState({
        documentId: "new-document",
        admittedDocumentId: admitted.admittedDocumentId,
        hasDocument: true,
        isDocumentCreationConfirmed: false,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
        hasLoadFailure: backgroundFailure.failed,
        isManualRetrying: false,
        error: new Error("background refetch failed"),
      }),
    ).toEqual({ view: "editor", admittedDocumentId: "new-document" });
  });

  it("latches a first-fetch failure across an immediate replacement fetch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let attempt = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ["document", "document-a"],
      queryFn: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw Object.assign(new Error("timed out"), { timedOut: true });
        }
        return await new Promise<never>(() => {});
      },
    });
    const initial = observer.getCurrentResult();
    let failure = updateDocumentLoadFailureState({
      previous: null,
      documentId: "document-a",
      admitted: false,
      dataUpdatedAt: initial.dataUpdatedAt,
      errorUpdateCount: initial.errorUpdateCount,
      errorUpdatedAt: initial.errorUpdatedAt,
      isError: initial.isError,
      authoritativeSuccess: {
        queryIdentity: "document-a",
        generation: 0,
        errorUpdateCount: 0,
      },
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isError).toBe(true),
    );
    void queryClient.invalidateQueries({
      queryKey: ["document", "document-a"],
      exact: true,
    });
    await vi.waitFor(() => {
      const result = observer.getCurrentResult();
      expect(result.isFetching).toBe(true);
      expect(result.isError).toBe(false);
    });

    const replacement = observer.getCurrentResult();
    failure = updateDocumentLoadFailureState({
      previous: failure,
      documentId: "document-a",
      admitted: false,
      dataUpdatedAt: replacement.dataUpdatedAt,
      errorUpdateCount: replacement.errorUpdateCount,
      errorUpdatedAt: replacement.errorUpdatedAt,
      isError: replacement.isError,
      authoritativeSuccess: {
        queryIdentity: "document-a",
        generation: 0,
        errorUpdateCount: 0,
      },
    });
    expect(failure.failed).toBe(true);
    expect(
      updateDocumentLoadFailureState({
        previous: null,
        documentId: "document-a",
        admitted: false,
        dataUpdatedAt: replacement.dataUpdatedAt,
        errorUpdateCount: replacement.errorUpdateCount,
        errorUpdatedAt: replacement.errorUpdatedAt,
        isError: replacement.isError,
        authoritativeSuccess: {
          queryIdentity: "document-a",
          generation: 0,
          errorUpdateCount: 0,
        },
      }).failed,
    ).toBe(true);

    unsubscribe();
    await queryClient.cancelQueries({
      queryKey: ["document", "document-a"],
      exact: true,
    });
  });

  it.each([
    [404, "unavailable"],
    [500, "error"],
  ] as const)(
    "keeps a failed read's %i screen while the page is read again, also after a remount",
    async (status, view) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      trackDocumentReadFailures(queryClient);
      const queryKey = documentQueryKey("document-a");
      let attempt = 0;
      const options = {
        queryKey,
        queryFn: async () => {
          attempt += 1;
          if (attempt === 1) {
            throw Object.assign(new Error("read failed"), { status });
          }
          return await new Promise<never>(() => {});
        },
        refetchOnMount: "always" as const,
      };
      // One editor mount: its failure state persists across its renders.
      const mount = (observer: QueryObserver<unknown, Error>) => {
        let failure: ReturnType<typeof updateDocumentLoadFailureState> | null =
          null;
        return () => {
          const result = observer.getCurrentResult();
          failure = updateDocumentLoadFailureState({
            previous: failure,
            documentId: "document-a",
            admitted: false,
            dataUpdatedAt: result.dataUpdatedAt,
            errorUpdateCount: result.errorUpdateCount,
            errorUpdatedAt: result.errorUpdatedAt,
            isError: result.isError,
            authoritativeSuccess: {
              queryIdentity: "document-a",
              generation: 0,
              errorUpdateCount: 0,
            },
          });
          return documentEditorLoadState({
            documentId: "document-a",
            admittedDocumentId: null,
            hasDocument: false,
            isDocumentCreationPending: false,
            isFetchedAfterMount: result.isFetchedAfterMount,
            isFetching: result.isFetching,
            isError: result.isError,
            hasLoadFailure: failure.failed,
            isManualRetrying: false,
            error: documentReadFailure(queryClient, queryKey, result),
          }).view;
        };
      };
      const readAgain = async (observer: QueryObserver<unknown, Error>) => {
        await vi.waitFor(() => {
          const result = observer.getCurrentResult();
          expect(result.isFetching).toBe(true);
          expect(result.isError).toBe(false);
        });
      };

      const first = new QueryObserver<unknown, Error>(queryClient, options);
      const firstView = mount(first);
      firstView();
      const unsubscribeFirst = first.subscribe(() => {});
      await vi.waitFor(() =>
        expect(first.getCurrentResult().isError).toBe(true),
      );
      expect(firstView()).toBe(view);

      void queryClient.invalidateQueries({ queryKey, exact: true });
      await readAgain(first);
      expect(firstView()).toBe(view);

      // Leaving the page and coming back mounts a new editor while it reads.
      unsubscribeFirst();
      const second = new QueryObserver<unknown, Error>(queryClient, options);
      const unsubscribeSecond = second.subscribe(() => {});
      await readAgain(second);
      expect(mount(second)()).toBe(view);

      unsubscribeSecond();
      await queryClient.cancelQueries({ queryKey, exact: true });
    },
  );

  it("clears a latched load failure only after an authoritative fetch succeeds", () => {
    const failed = {
      documentId: "document-a",
      queryIdentity: "document-a",
      baselineErrorUpdateCount: 1,
      baselineAuthoritativeSuccessGeneration: 0,
      failed: true,
    };
    expect(
      updateDocumentLoadFailureState({
        previous: failed,
        documentId: "document-a",
        admitted: false,
        dataUpdatedAt: 200,
        errorUpdateCount: 1,
        errorUpdatedAt: 100,
        isError: false,
        authoritativeSuccess: {
          queryIdentity: "document-a",
          generation: 0,
          errorUpdateCount: 0,
        },
      }),
    ).toBe(failed);

    expect(
      updateDocumentLoadFailureState({
        previous: failed,
        documentId: "document-a",
        admitted: false,
        dataUpdatedAt: 300,
        errorUpdateCount: 1,
        errorUpdatedAt: 100,
        isError: false,
        authoritativeSuccess: {
          queryIdentity: "document-a",
          generation: 1,
          errorUpdateCount: 1,
        },
      }),
    ).toEqual({
      ...failed,
      baselineAuthoritativeSuccessGeneration: 1,
      failed: false,
    });
  });

  it("resets the load-failure baseline when the document query context changes", () => {
    expect(
      updateDocumentLoadFailureState({
        previous: {
          documentId: "document-a",
          queryIdentity: "context-a",
          baselineErrorUpdateCount: 2,
          baselineAuthoritativeSuccessGeneration: 3,
          failed: true,
        },
        documentId: "document-a",
        admitted: false,
        dataUpdatedAt: 0,
        errorUpdateCount: 0,
        errorUpdatedAt: 0,
        isError: false,
        authoritativeSuccess: {
          queryIdentity: "context-b",
          generation: 0,
          errorUpdateCount: 0,
        },
      }),
    ).toEqual({
      documentId: "document-a",
      queryIdentity: "context-b",
      baselineErrorUpdateCount: 0,
      baselineAuthoritativeSuccessGeneration: 0,
      failed: false,
    });
  });

  it("distinguishes authoritative fetch success from manual cache writes", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["action", "get-document", { id: "document-a" }];
    const successes: number[] = [];
    const unsubscribe = subscribeToAuthoritativeQuerySuccess(
      queryClient,
      queryKey,
      (errorUpdateCount) => successes.push(errorUpdateCount),
    );

    await expect(
      queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          throw new Error("unavailable");
        },
      }),
    ).rejects.toThrow("unavailable");
    expect(successes).toEqual([]);

    queryClient.setQueryData(queryKey, { id: "document-a", title: "cached" });
    expect(successes).toEqual([]);

    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => ({ id: "document-a", title: "fetched" }),
    });
    expect(successes).toEqual([1]);
    unsubscribe();
  });

  it("does not admit settled cache-shaped data over a latched failure", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: null,
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: false,
        hasLoadFailure: true,
        isManualRetrying: false,
        error: null,
      }),
    ).toEqual({ view: "error", admittedDocumentId: null });
  });

  it("shows unavailable when an admitted document refetch settles with 404", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: "document-a",
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
        hasLoadFailure: false,
        isManualRetrying: false,
        error: { status: 404 },
      }),
    ).toEqual({ view: "unavailable", admittedDocumentId: null });
  });

  it("waits for manual Retry to finish before admitting its success", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: null,
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: false,
        hasLoadFailure: false,
        isManualRetrying: true,
        error: null,
      }),
    ).toEqual({ view: "error", admittedDocumentId: null });
  });

  it("keeps the access screen mounted through a retry it started", () => {
    const retry = {
      documentId: "document-a",
      admittedDocumentId: null,
      isDocumentCreationPending: false,
      isManualRetrying: true,
      isAccessRetrying: true,
      hasLoadFailure: false,
    };
    // In flight: React Query clears the error while a query without data
    // refetches.
    expect(
      documentEditorLoadState({
        ...retry,
        hasDocument: false,
        isFetchedAfterMount: false,
        isFetching: true,
        isError: false,
        error: null,
      }),
    ).toEqual({ view: "unavailable", admittedDocumentId: null });
    // Succeeded, but the retry hasn't finished yet.
    expect(
      documentEditorLoadState({
        ...retry,
        hasDocument: true,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: false,
        error: null,
      }),
    ).toEqual({ view: "unavailable", admittedDocumentId: null });
    // Failed for a reason other than access.
    expect(
      documentEditorLoadState({
        ...retry,
        hasDocument: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
        error: { status: 500 },
      }),
    ).toEqual({ view: "error", admittedDocumentId: null });
  });

  it("shows a retryable error when a seeded document's first fetch times out", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: null,
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
        hasLoadFailure: true,
        isManualRetrying: false,
        error: { timedOut: true },
      }),
    ).toEqual({ view: "error", admittedDocumentId: null });
  });

  it("shows unavailable when the first fetch rejects access to a seeded document", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: "document-a",
        hasDocument: true,
        isDocumentCreationConfirmed: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
        hasLoadFailure: true,
        isManualRetrying: false,
        error: { status: 403 },
      }),
    ).toEqual({ view: "unavailable", admittedDocumentId: null });
  });

  it("keeps an optimistic new document mounted through its initial error", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: null,
        hasDocument: true,
        isDocumentCreationPending: true,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
        hasLoadFailure: true,
        isManualRetrying: false,
        error: { status: 404 },
      }),
    ).toEqual({ view: "editor", admittedDocumentId: "document-a" });
  });

  it("keeps an admitted optimistic document mounted while its create response refetches", () => {
    const optimistic = documentEditorLoadState({
      documentId: "document-a",
      admittedDocumentId: null,
      hasDocument: true,
      isDocumentCreationPending: true,
      isFetchedAfterMount: false,
      isFetching: true,
      isError: false,
      hasLoadFailure: false,
      isManualRetrying: false,
      error: null,
    });
    expect(optimistic).toEqual({
      view: "editor",
      admittedDocumentId: "document-a",
    });
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: optimistic.admittedDocumentId,
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: true,
        isError: false,
        hasLoadFailure: false,
        isManualRetrying: false,
        error: null,
      }),
    ).toEqual({ view: "editor", admittedDocumentId: "document-a" });
  });

  it("keeps the editor mounted after success when a background fetch fails", () => {
    const success = documentEditorLoadState({
      documentId: "document-a",
      admittedDocumentId: null,
      hasDocument: true,
      isDocumentCreationPending: false,
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
      hasLoadFailure: false,
      isManualRetrying: false,
      error: null,
    });
    expect(success).toEqual({
      view: "editor",
      admittedDocumentId: "document-a",
    });
    expect(
      documentEditorLoadState({
        documentId: "document-a",
        admittedDocumentId: success.admittedDocumentId,
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: true,
        isFetching: true,
        isError: true,
        hasLoadFailure: false,
        isManualRetrying: false,
        error: { timedOut: true },
      }),
    ).toEqual({ view: "editor", admittedDocumentId: "document-a" });
  });

  it("resets admitted readiness when the active document changes", () => {
    expect(
      documentEditorLoadState({
        documentId: "document-b",
        admittedDocumentId: "document-a",
        hasDocument: true,
        isDocumentCreationPending: false,
        isFetchedAfterMount: false,
        isFetching: true,
        isError: false,
        hasLoadFailure: false,
        isManualRetrying: false,
        error: null,
      }),
    ).toEqual({ view: "skeleton", admittedDocumentId: null });
  });

  it("keeps document load failures retryable unless access is unavailable", () => {
    expect(isDocumentLoadUnavailableError({ timedOut: true })).toBe(false);
    expect(isDocumentLoadUnavailableError(new TypeError("Network error"))).toBe(
      false,
    );
    expect(isDocumentLoadUnavailableError({ status: 500 })).toBe(false);
    expect(isDocumentLoadUnavailableError({ status: 401 })).toBe(false);
    expect(isDocumentLoadUnavailableError({ status: 403 })).toBe(true);
    expect(isDocumentLoadUnavailableError({ status: 404 })).toBe(true);
    // oracle-change: replaced by DocumentEditor.preview-placeholder.test.tsx "a page whose read fails", which clicks Retry and reads a 403.
  });

  it("resizes the title to its content and reacts only to width changes", () => {
    const textarea = {
      scrollHeight: 72,
      style: { height: "36px" },
    };

    resizeDocumentTitleTextarea(textarea as HTMLTextAreaElement);

    expect(textarea.style.height).toBe("72px");
    expect(documentTitleWidthChanged(640, 640)).toBe(false);
    expect(documentTitleWidthChanged(640, 639.75)).toBe(false);
    expect(documentTitleWidthChanged(640, 420)).toBe(true);
    expect(documentTitleWidthChanged(420, 640)).toBe(true);
    // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "grows to fit its text when its width changes, and only then", which resizes the mounted title.
  });

  it("serializes overlapping document saves without dropping the fuller snapshot", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queueRef = { current: Promise.resolve() };
    const events: string[] = [];

    const first = enqueueDocumentSave(queueRef, async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return "partial";
    });
    const second = enqueueDocumentSave(queueRef, async () => {
      events.push("second:start");
      events.push("second:end");
      return "full";
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();

    await expect(first).resolves.toBe("partial");
    await expect(second).resolves.toBe("full");
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("abandons a retry that reaches the save queue after its editor unmounts", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queueRef = { current: Promise.resolve() };
    let active = true;
    const persistRetry = vi.fn().mockResolvedValue({ contentPersisted: true });
    const first = enqueueDocumentSave(queueRef, async () => {
      await firstGate;
      return "first";
    });
    const retry = enqueueDocumentSave(queueRef, () =>
      runPageSaveIfSessionActive(() => active, persistRetry),
    );

    active = false;
    releaseFirst();

    await expect(first).resolves.toBe("first");
    await expect(retry).resolves.toEqual({
      contentPersisted: false,
      outcome: "abandoned",
    });
    expect(persistRetry).not.toHaveBeenCalled();
  });

  it("continues the save queue after an earlier request fails", async () => {
    const queueRef = { current: Promise.resolve() };
    const first = enqueueDocumentSave(queueRef, async () => {
      throw new Error("network interrupted");
    });
    const second = enqueueDocumentSave(queueRef, async () => "latest");

    await expect(first).rejects.toThrow("network interrupted");
    await expect(second).resolves.toBe("latest");
  });

  it("does not re-retain stale content from a queued peer-title sync", async () => {
    const queueRef = { current: Promise.resolve() };
    let currentDraft = {
      title: "Original title",
      content: "A",
      supersedable: true,
    };
    const retained: (typeof currentDraft)[] = [];
    const persist = async (draft: typeof currentDraft) => {
      currentDraft = draft;
      retained.push({ ...draft });
    };

    await enqueueDocumentSave(queueRef, async () => persist(currentDraft));

    const peerTitle = "Peer title";
    const newerDraft = {
      title: peerTitle,
      content: "A+B",
      supersedable: false,
    };
    const newerRetention = enqueueDocumentSave(queueRef, async () =>
      persist(newerDraft),
    );
    const titleSync = enqueueRecoveryDraftTitleSync(
      queueRef,
      peerTitle,
      () => currentDraft,
      async (draft) => persist({ ...draft, title: peerTitle }),
    );

    await Promise.all([newerRetention, titleSync]);

    expect(retained).toEqual([
      {
        title: "Original title",
        content: "A",
        supersedable: true,
      },
      newerDraft,
    ]);
    expect(currentDraft).toEqual(newerDraft);
  });

  it("keeps the first title edit writable after canonical creation advances the optimistic timestamp", () => {
    const canonicalUpdatedAt = "2026-09-09T04:13:24.458Z";
    const lastSaved = refreshUnchangedTitleSaveWatermark({
      serverTitle: "",
      serverUpdatedAt: canonicalUpdatedAt,
      lastSaved: { title: "", updatedAt: "2026-09-09T04:13:24.400Z" },
    });
    expect(lastSaved).toEqual({ title: "", updatedAt: canonicalUpdatedAt });
    expect(
      metadataUpdatesWithPendingTitle({}, "Personal recovery", lastSaved.title),
    ).toEqual({ title: "Personal recovery" });
  });

  it("does not confirm an optimistic or externally changed title as the saved baseline", () => {
    const lastSaved = { title: "", updatedAt: "2026-09-09T04:13:24.400Z" };
    expect(
      refreshUnchangedTitleSaveWatermark({
        serverTitle: "Unsaved local title",
        serverUpdatedAt: "2026-09-09T04:13:24.458Z",
        lastSaved,
      }),
    ).toBe(lastSaved);
    expect(
      refreshUnchangedTitleSaveWatermark({
        serverTitle: "",
        serverUpdatedAt: "2026-09-09T04:13:24.300Z",
        lastSaved,
      }),
    ).toBe(lastSaved);
  });

  it("advances the content CAS base across metadata-only row updates", () => {
    expect(
      refreshUnchangedContentSaveWatermark({
        serverContent: "saved prefix",
        serverUpdatedAt: "2026-07-24T17:00:02.000Z",
        lastSaved: {
          content: "saved prefix",
          updatedAt: "2026-07-24T17:00:01.000Z",
        },
      }),
    ).toEqual({
      content: "saved prefix",
      updatedAt: "2026-07-24T17:00:02.000Z",
    });
  });

  it("does not advance the content CAS base across a real body change", () => {
    const lastSaved = {
      content: "saved prefix",
      updatedAt: "2026-07-24T17:00:01.000Z",
    };

    expect(
      refreshUnchangedContentSaveWatermark({
        serverContent: "external body",
        serverUpdatedAt: "2026-07-24T17:00:02.000Z",
        lastSaved,
      }),
    ).toBe(lastSaved);
  });

  it("rebases an edit made during this editor's in-flight save onto that save", () => {
    const lineage: OwnContentSaveLineage = new Map();
    recordOwnContentSave(lineage, "body:31:b", {
      baseRevision: "body:30:a",
      editGeneration: 2,
    });
    const latest = {
      content: "Intro\n<empty-block/>",
      updatedAt: "2026-09-28T15:35:54.963Z",
      revision: "body:31:b",
    };
    const captured = {
      content: "Intro",
      updatedAt: "2026-09-28T15:35:32.985Z",
      revision: "body:30:a",
    };

    const rebased = ownConfirmedContentBase({
      captured,
      latest,
      lineage,
      editGeneration: 3,
    });
    expect(rebased).toBe(latest);

    const incoming = {
      writerId: "browser:alice:session",
      operationId: "session:3",
      generation: 3,
    };
    const ownSave = {
      writerId: "browser:alice:session",
      operationId: "session:2",
      generation: 2,
      authoredBaseRevision: 30,
      committedRevision: 31,
      affectedBlockIndexes: [],
      canonicalChanged: true,
    };
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: captured.content,
        authoredCandidateContent: "Intro\ntmp2",
        currentContent: latest.content,
        currentRevision: 31,
        incoming: { ...incoming, authoredBaseRevision: 30 },
        priorIntents: [ownSave],
      }),
    ).toMatchObject({ status: "resolved", content: "Intro\ntmp2" });
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: rebased!.content,
        authoredCandidateContent: "Intro\ntmp2",
        currentContent: latest.content,
        currentRevision: 31,
        incoming: { ...incoming, authoredBaseRevision: 31 },
        priorIntents: [ownSave],
      }),
    ).toMatchObject({ status: "resolved", content: "Intro\ntmp2" });
  });

  it("gives a save moved onto this editor's newer base its own attempt ID", () => {
    const lineage: OwnContentSaveLineage = new Map();
    recordOwnContentSave(lineage, "body:48", {
      baseRevision: "body:47",
      editGeneration: 3,
    });
    const latest = {
      content: "Intro first",
      updatedAt: "2026-09-30T23:00:39.264Z",
      revision: "body:48",
    };
    const ownBase = (captured: { content: string; revision?: string }) =>
      ownConfirmedContentBase({
        captured: { ...captured, updatedAt: null },
        latest,
        lineage,
        editGeneration: 4,
      });
    // The hidden tab already sent this payload as a keepalive copy.
    const pending = {
      contentBase: {
        content: "Intro",
        updatedAt: "2026-09-30T22:59:32.852Z",
        revision: "body:47",
      },
      authoredContentIntent: {
        editGeneration: 4,
        baseRevision: "body:47",
        baseContent: "Intro",
        candidateContent: "Intro first second",
      },
      saveAttemptId: "keepalive-attempt",
    };

    const moved = adoptOwnConfirmedBases(
      pending,
      "Intro first second",
      ownBase,
    );

    expect(moved.contentBase).toEqual(latest);
    expect(moved.authoredContentIntent).toEqual({
      editGeneration: 4,
      baseRevision: "body:48",
      baseContent: "Intro first",
      candidateContent: "Intro first second",
    });
    expect(moved.saveAttemptId).toEqual(expect.any(String));
    expect(moved.saveAttemptId).not.toBe("keepalive-attempt");
    // Page recovery still treats a receipt for the keepalive copy as proof
    // that this draft landed.
    expect(moved.equivalentSaveAttemptIds).toEqual(["keepalive-attempt"]);
    expect(
      adoptOwnConfirmedBases(pending, "Intro first second", () => null),
    ).toBe(pending);

    // Reverting the earlier save matches the captured base, so the keepalive
    // copy sent no body. Its receipt must not confirm the revert.
    expect(
      adoptOwnConfirmedBases(pending, "Intro", ownBase)
        .equivalentSaveAttemptIds,
    ).toBeUndefined();
    // Neither copy sends a body that already matches the newer base.
    expect(
      adoptOwnConfirmedBases(pending, "Intro first", ownBase)
        .equivalentSaveAttemptIds,
    ).toEqual(["keepalive-attempt"]);
  });

  it("rebases across a chain of this editor's earlier saves", () => {
    const lineage: OwnContentSaveLineage = new Map();
    recordOwnContentSave(lineage, "body:31", {
      baseRevision: "body:30",
      editGeneration: 2,
    });
    recordOwnContentSave(lineage, "body:32", {
      baseRevision: "body:31",
      editGeneration: 3,
    });
    const latest = { content: "c", updatedAt: null, revision: "body:32" };

    expect(
      ownConfirmedContentBase({
        captured: { content: "a", updatedAt: null, revision: "body:30" },
        latest,
        lineage,
        editGeneration: 4,
      }),
    ).toBe(latest);
  });

  it("keeps the captured base across revisions this editor did not author first", () => {
    const lineage: OwnContentSaveLineage = new Map();
    recordOwnContentSave(lineage, "body:31", {
      baseRevision: "body:30",
      editGeneration: 5,
    });
    const captured = { content: "a", updatedAt: null, revision: "body:30" };

    expect(
      ownConfirmedContentBase({
        captured,
        latest: { content: "agent", updatedAt: null, revision: "body:32" },
        lineage,
        editGeneration: 6,
      }),
    ).toBeNull();
    expect(
      ownConfirmedContentBase({
        captured,
        latest: { content: "later", updatedAt: null, revision: "body:31" },
        lineage,
        editGeneration: 5,
      }),
    ).toBeNull();
    expect(
      ownConfirmedContentBase({
        captured: { content: "b", updatedAt: null, revision: "body:29" },
        latest: { content: "later", updatedAt: null, revision: "body:31" },
        lineage,
        editGeneration: 6,
      }),
    ).toBeNull();
  });

  it("bounds this editor's save lineage", () => {
    const lineage: OwnContentSaveLineage = new Map();
    for (let revision = 1; revision <= 40; revision++) {
      recordOwnContentSave(lineage, `body:${revision}`, {
        baseRevision: `body:${revision - 1}`,
        editGeneration: revision,
      });
    }

    expect(lineage.size).toBe(32);
    expect(lineage.has("body:8")).toBe(false);
    expect(lineage.has("body:40")).toBe(true);
  });

  it("flushes a pending title with an icon update", () => {
    expect(
      metadataUpdatesWithPendingTitle(
        { icon: "🌱" },
        "Renamed page",
        "Untitled",
      ),
    ).toEqual({ icon: "🌱", title: "Renamed page" });
    expect(
      metadataUpdatesWithPendingTitle(
        { icon: "🌱" },
        "Renamed page",
        "Renamed page",
      ),
    ).toEqual({ icon: "🌱" });
  });

  // oracle-change: covered by "closing a page this tab never edited journals a failed rename of a page another writer rewrote on its stored body" in DocumentEditor.recovery-save-state.test.tsx, which fails when the title ref waits a microtask.

  it("does not mistake an optimistic title cache patch for a confirmed save", () => {
    const renamed = {
      serverTitle: "Renamed page",
      localTitle: "Renamed page",
      lastSavedTitle: "Untitled",
    };
    expect(
      titleMatchConfirmsSave({
        ...renamed,
        pendingTitle: "Renamed page",
        unansweredTitle: "Renamed page",
      }),
    ).toBe(false);
    // The save is in flight: the cached title is still the one typed.
    expect(
      titleMatchConfirmsSave({
        ...renamed,
        pendingTitle: null,
        unansweredTitle: "Renamed page",
      }),
    ).toBe(false);
    // Another writer gave the page the same name.
    expect(
      titleMatchConfirmsSave({
        ...renamed,
        pendingTitle: null,
        unansweredTitle: null,
      }),
    ).toBe(true);
    expect(
      titleMatchConfirmsSave({
        serverTitle: "Untitled",
        localTitle: "Untitled",
        lastSavedTitle: "Untitled",
        pendingTitle: null,
        unansweredTitle: "Untitled",
      }),
    ).toBe(true);
  });

  it("does not adopt this editor's unanswered title from a newer page copy", () => {
    // A save of another field, such as the favorite star, made the cached page
    // newer while the title typed into it is still waiting for its save.
    const newerPage = {
      serverTitle: "Renamed page",
      localTitle: "Renamed page",
      lastSavedTitle: "Untitled",
      serverIsNewer: true,
      titleFocused: false,
    };
    expect(
      shouldAdoptServerTitle({ ...newerPage, unansweredTitle: "Renamed page" }),
    ).toBe(false);
    expect(
      shouldAdoptServerTitle({ ...newerPage, unansweredTitle: null }),
    ).toBe(true);
    expect(
      shouldAdoptServerTitle({
        ...newerPage,
        serverTitle: "Renamed elsewhere",
        unansweredTitle: "Renamed page",
      }),
    ).toBe(true);
    expect(
      shouldAdoptServerTitle({
        ...newerPage,
        serverTitle: "Renamed elsewhere",
        titleFocused: true,
        unansweredTitle: "Renamed page",
      }),
    ).toBe(false);
    expect(
      shouldAdoptServerTitle({
        ...newerPage,
        serverTitle: "Renamed elsewhere",
        localTitle: "Untitled",
        serverIsNewer: false,
        unansweredTitle: null,
      }),
    ).toBe(true);
  });

  it("keeps a title unanswered through an answer that may send it again", () => {
    // A conflict answer puts the server's page back in the cache, and the
    // rebased retry writes the same title into it again before it answers.
    const page = { id: "page", title: "Renamed page" } as DocumentUpdateResult;
    const typed = { title: "Renamed page" };
    const sent = { unanswered: typed, sent: typed };
    expect(unansweredTitleAfterSave({ ...sent, answer: page })).toBeNull();
    expect(unansweredTitleAfterSave({ ...sent, answer: null })).toBeNull();
    for (const answer of [
      { conflict: true, document: page },
      { superseded: true, document: page },
      { preservationRequired: true, document: page },
    ] as DocumentUpdateResult[]) {
      expect(unansweredTitleAfterSave({ ...sent, answer })).toBe(typed);
    }
    expect(
      unansweredTitleAfterSave({ unanswered: typed, sent: null, answer: page }),
    ).toBe(typed);
  });

  it("keeps a title typed after a save was sent through that save's answer", () => {
    // Typing "A", then "B", then "A" again while the first save of "A" is out
    // makes a new mark, so the old save's answer settles neither.
    const page = { id: "page", title: "A" } as DocumentUpdateResult;
    const first = { title: "A" };
    const retyped = { title: "A" };
    expect(
      unansweredTitleAfterSave({
        unanswered: retyped,
        sent: first,
        answer: page,
      }),
    ).toBe(retyped);
    expect(
      unansweredTitleAfterSave({
        unanswered: retyped,
        sent: first,
        answer: null,
      }),
    ).toBe(retyped);
  });

  it("leaves a typed title to the save still carrying it when another carrier fails", () => {
    // The title's own save and an icon save both carry "Renamed page"; the
    // icon save fails first.
    const page = { id: "page", title: "Renamed page" } as DocumentUpdateResult;
    const typed = { title: "Renamed page" };
    const carriers = createTitleMarkCarriers();
    carriers.send(typed);
    carriers.send(typed);
    const iconSave = carriers.settle(typed, true);
    expect(
      failedSaveRestoresSavedTitle({
        sentTitle: "Renamed page",
        unanswered: typed,
        sent: iconSave,
      }),
    ).toBe(false);
    expect(
      unansweredTitleAfterSave({
        unanswered: typed,
        sent: iconSave,
        answer: null,
      }),
    ).toBe(typed);
    const titleSave = carriers.settle(typed, false);
    expect(
      unansweredTitleAfterSave({
        unanswered: typed,
        sent: titleSave,
        answer: page,
      }),
    ).toBeNull();
  });

  it("settles a typed title when the last save carrying it fails", () => {
    const typed = { title: "Renamed page" };
    const carriers = createTitleMarkCarriers();
    carriers.send(typed);
    carriers.send(typed);
    expect(carriers.settle(typed, false)).toBe(typed);
    expect(carriers.settle(typed, true)).toBe(typed);
    expect(carriers.settle(null, true)).toBeNull();
  });

  it("keeps a newer typed title in the cache when an older save fails", () => {
    const typed = { title: "Renamed page" };
    expect(
      failedSaveRestoresSavedTitle({
        sentTitle: "Renamed page",
        unanswered: typed,
        sent: typed,
      }),
    ).toBe(true);
    expect(
      failedSaveRestoresSavedTitle({
        sentTitle: "Renamed page",
        unanswered: null,
        sent: null,
      }),
    ).toBe(true);
    expect(
      failedSaveRestoresSavedTitle({
        sentTitle: "Renamed",
        unanswered: typed,
        sent: { title: "Renamed" },
      }),
    ).toBe(false);
    expect(
      failedSaveRestoresSavedTitle({
        sentTitle: "Renamed page",
        unanswered: typed,
        sent: { title: "Renamed page" },
      }),
    ).toBe(false);
    expect(
      failedSaveRestoresSavedTitle({
        sentTitle: undefined,
        unanswered: null,
        sent: null,
      }),
    ).toBe(false);
  });

  it("keeps prose titles on the reading column", () => {
    expect(documentEditorTitleRegionClassName(false)).toContain("max-w-3xl");
    expect(documentEditorTitleRegionClassName(false)).toContain("pb-8");
  });

  // oracle-change: removed an absence test for the collection starter button that #7138 deleted; nothing renders it and no string for it remains.

  it("gives database pages a wider database surface", () => {
    expect(documentEditorTitleRegionClassName(true)).toContain("max-w-none");
    expect(documentEditorTitleRegionClassName(true)).toContain("pt-14");
    expect(documentEditorTitleRegionClassName(true)).toContain("sm:pt-7");
    expect(documentEditorTitleRegionClassName(true)).toContain("pb-2");
    expect(documentEditorDatabaseRegionClassName()).toContain("max-w-none");
    expect(documentEditorDatabaseRegionClassName()).toContain("min-w-0");
  });

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "focuses the text where the page was scrolled, until the reader scrolls", which clicks the padding.

  it("keeps metadata in Info while reusing canonical properties inline in previews", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      { encoding: "utf8" },
    );
    const infoPanel = readFileSync(
      new URL("./DocumentInfoPanel.tsx", import.meta.url),
      { encoding: "utf8" },
    );
    const properties = readFileSync(
      new URL("./DocumentProperties.tsx", import.meta.url),
      { encoding: "utf8" },
    );

    expect(source).toContain("<DocumentInfoPanel");
    expect(source).toContain("{!isDatabasePage ? (");
    expect(source.indexOf("{!isDatabasePage ? (")).toBeLessThan(
      source.indexOf("const primaryEditor ="),
    );
    expect(infoPanel).toContain("<DescriptionField");
    expect(properties).toMatch(
      /<PropertyValuePopover[\s\S]*?container=\{popoverContainer\}/,
    );
    expect(properties).toMatch(
      /<PropertyManagementPopover[\s\S]*?popoverContainer=\{popoverContainer\}/,
    );
    // oracle-change: the Hidden properties menu is gone, so its popover has no
    // container to pass; the line that replaced it opens in place.
    expect(properties).toMatch(
      /<AddProperty[\s\S]*?popoverContainer=\{popoverContainer\}/,
    );
    // oracle-change: Info's Properties and a preview's inline Properties are replaced by DocumentInfoPanel.ui.test.tsx "reads a row's Properties from the Collection it belongs to" and DocumentEditor.page-ui.test.tsx "shows the row's Properties inline", which render them.
    expect(source).toMatch(
      /<DocumentBlockFields[\s\S]*?databaseId=\{[\s\S]*?databaseId \?\?[\s\S]*?document\.databaseMembership\.databaseId[\s\S]*?databaseDocumentId=\{[\s\S]*?databaseDocumentId \?\?[\s\S]*?document\.databaseMembership\.databaseDocumentId[\s\S]*?\}/,
    );
    expect(source).not.toContain("<DescriptionField");
  });

  it("keys editor sessions by page and explicit membership context", () => {
    expect(
      pageEditorSessionKey({
        documentId: "page",
        databaseId: "database-a",
        databaseDocumentId: "membership-a",
      }),
    ).not.toBe(
      pageEditorSessionKey({
        documentId: "page",
        databaseId: "database-b",
        databaseDocumentId: "membership-b",
      }),
    );
  });

  it("opens a named view link on its collection's page, with or without a databaseId", () => {
    const page = { pageDatabaseId: "database-a" };
    // The view and setup actions link `/page/<collection>?viewId=<view>`.
    expect(
      namedViewLinkMatchesPage({ ...page, viewId: "view-1", databaseId: null }),
    ).toBe(true);
    expect(
      namedViewLinkMatchesPage({
        ...page,
        viewId: "view-1",
        databaseId: "database-a",
      }),
    ).toBe(true);
    expect(
      namedViewLinkMatchesPage({
        ...page,
        viewId: "view-1",
        databaseId: "database-b",
      }),
    ).toBe(false);
    expect(
      namedViewLinkMatchesPage({
        viewId: "view-1",
        databaseId: null,
        pageDatabaseId: undefined,
      }),
    ).toBe(false);
    expect(
      namedViewLinkMatchesPage({
        viewId: null,
        databaseId: null,
        pageDatabaseId: undefined,
      }),
    ).toBe(true);
  });

  // oracle-change: replaced by "is saved when the editor closes" and "is saved when the page turns read-only before the autosave" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by "asks the editor for its latest words before the page closes", "still drains a property write held when the page closes" and "requires fresh confirmation before flushing a reverted failed field under suggestion lock" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "dismisses only the comment in the editor the key came from", which presses Escape in a nested editor.

  it("renders viewers from SQL while retaining scoped presence", () => {
    const documentEditorSource = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    ).replace(/\r\n/g, "\n");

    expect(documentEditorSource).toContain(
      "const mcpDirectoryWidgetReadOnly =\n    document.mcpDirectoryWidgetReadOnly === true;",
    );
    expect(documentEditorSource).toContain(
      "const collabEnabled = shouldUseLiveDocumentCollaboration({",
    );
    expect(documentEditorSource).toContain("mcpDirectoryWidgetReadOnly,");
    expect(documentEditorSource).toContain(
      "const holdCollaborationForCreationSave = isDocumentCreationConfirmed(\n    queryClient,\n    document,\n  );",
    );
    expect(documentEditorSource).toContain(
      "const settled = creationSaveBarrierIsSettled({",
    );
    const creationReleaseStart = documentEditorSource.indexOf(
      "const tryReleaseCreationCollaboration =",
    );
    expect(
      documentEditorSource.indexOf(
        "editorPersistenceControllerRef.current?.flushLatest()",
        creationReleaseStart,
      ),
    ).toBeLessThan(
      documentEditorSource.indexOf(
        "creationSaveBarrierIsSettled({",
        creationReleaseStart,
      ),
    );
    expect(documentEditorSource).toContain(
      "hasCollaborationSeedBody: !isEffectivelyEmptyDocumentContent(\n            currentDocument.content,\n          ),",
    );
    expect(documentEditorSource).toMatch(
      /const selection =\s+editorSelectionControllerRef.current\?\.captureSelection\(\);/,
    );
    expect(documentEditorSource).toContain(
      "initialCreationSaveStartedRef.current = true;",
    );
    expect(documentEditorSource).toContain(
      "const savedContent = lastSavedContentRef.current;",
    );
    expect(documentEditorSource).toContain(
      "patchDocumentCaches(queryClient, documentId, {\n          content: savedContent.content,",
    );
    expect(documentEditorSource).toContain(
      "clearDocumentCreationConfirmed(queryClient, currentDocument);",
    );
    expect(documentEditorSource).not.toContain(
      "const canEditWithoutCollaboration =\n    (creationAwaitingFirstRead ||\n      holdCollaborationForCreationSave ||\n      (collabEnabled && !hasCollaborationSeedBody)) &&\n    !collabSynced;",
    );
    expect(documentEditorSource).toContain(
      "const canEditWithoutCollaboration =\n    (creationAwaitingFirstRead || holdCollaborationForCreationSave) &&\n    !collabSynced;",
    );
    expect(documentEditorSource).not.toContain(
      "const collabDocumentId =\n    collabEnabled &&\n    hasCollaborationSeedBody &&\n    !creationAwaitingFirstRead &&\n    !holdCollaborationForCreationSave &&\n    !isDocumentCreationPending(queryClient, document)",
    );
    expect(documentEditorSource).toContain(
      "const collabDocumentId =\n    collabEnabled &&\n    !creationAwaitingFirstRead &&\n    !holdCollaborationForCreationSave &&\n    !isDocumentCreationPending(queryClient, document)",
    );
    expect(documentEditorSource).toContain(
      "const creationSelectionForDocument =\n    creationCollaborationSelection?.documentId === documentId\n      ? creationCollaborationSelection.selection\n      : null;",
    );
    expect(documentEditorSource).toContain(
      "isSuggesting\n    ? suggestionInitialSelection\n    : (creationSelectionForDocument ?? suggestionInitialSelection)",
    );
    expect(documentEditorSource).toContain("docId: collabDocumentId,");
    expect(documentEditorSource).toContain("const collabEditorEnabled =");
    expect(documentEditorSource).toContain(
      'collabInitialization.status === "ready"',
    );
    expect(documentEditorSource).toContain(
      "suggestionEditorIsolation.bindCanonicalYDoc",
    );
    expect(documentEditorSource).toContain(
      "collabEditorEnabled ? awareness : null",
    );
    expect(documentEditorSource).toContain(
      "args.collabEditorEnabled && args.hasYDoc",
    );
    expect(documentEditorSource).toContain(
      "`snapshot:${args.documentUpdatedAt}`",
    );
    expect(documentEditorSource).toContain(
      'awareness.setLocalStateField("canFlushDocument", editorCanEdit)',
    );
    expect(documentEditorSource).toContain(
      'awareness.setLocalStateField("canFlushDocument", false)',
    );

    expect(documentEditorSource).toContain(
      "collabEnabled &&\n    !creationAwaitingFirstRead &&\n    !holdCollaborationForCreationSave &&\n    !isDocumentCreationPending(queryClient, document)\n      ? documentId\n      : null",
    );

    expect(documentEditorSource).toContain(
      "canEdit &&\n                    !canEditWithoutCollaboration &&\n                    !collabReady",
    );
    expect(documentEditorSource).toContain(
      "(isLocalFileDocument ||\n      mcpDirectoryWidgetReadOnly ||\n      collabReady ||\n      canEditWithoutCollaboration)",
    );
    expect(documentEditorSource).toContain(
      "!canEdit ||\n      !hydrationContext?.sourceId",
    );
    expect(documentEditorSource).not.toContain(
      "(isLocalFileDocument || !collabLoading)",
    );
  });

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "keeps the Collection the cached page belongs to", which fails a local file's history save.

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "opens a comment on the whole page in the Discussion panel, selected", which opens one from the margin. A pick in the open panel keeps the panel open with or without its `presentation === "history"` argument, so that argument isn't pinned.

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "keeps the comment through the start of a touch or scroll gesture", which presses on the page.

  it("keeps title and content save watermarks independent after partial saves", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain(
      "saved?.title === lastSavedTitleRef.current.title",
    );
    expect(source).toContain(
      "saved?.content === lastSavedContentRef.current.content",
    );
  });

  // oracle-change: replaced by "settles a clean merge against the title another tab gave the Page" and "asks about a merged edit when the Page has moved past what it merged with" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by "sends the unload-safe copy the base its words were typed on" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by "goes out as an unload-safe copy, then an ordinary save, when the tab hides" and "renames a page another writer rewrote with blank lines without sending its body" in DocumentEditor.recovery-save-state.test.tsx.

  it("derives the hidden-tab keepalive copy's load watermark like the ordinary flush", () => {
    // oracle-change: the source checks became "gives the unload-safe copy the load watermark of the ordinary save" in DocumentEditor.recovery-save-state.test.tsx.
    expect(
      loadedUpdatedAtForSave(
        { updatedAt: "2026-09-30T22:59:32.852Z" },
        "2026-09-30T23:00:39.264Z",
      ),
    ).toBe("2026-09-30T22:59:32.852Z");
    expect(
      loadedUpdatedAtForSave({ updatedAt: null }, "2026-09-30T23:00:39.264Z"),
    ).toBe("2026-09-30T23:00:39.264Z");
    expect(loadedUpdatedAtForSave(undefined, null)).toBeUndefined();
  });

  // oracle-change: replaced by "journals the attempt that confirms words typed back to this tab's own save" in DocumentEditor.recovery-save-state.test.tsx.

  it("preserves unobserved overlapping edits before adopting the winner", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      "utf8",
    );
    const displaced = source.slice(
      source.indexOf('if (result.status === "displaced")'),
      source.indexOf(
        "} else {",
        source.indexOf('if (result.status === "displaced")'),
      ),
    );

    expect(displaced).toContain("await retainThenAdoptDisplacedWinner");
    expect(displaced).toContain("if (!adopted)");
    const save = source.slice(
      source.indexOf("result = await saveDocumentWithRebase"),
      source.indexOf(
        "if (result.status",
        source.indexOf("result = await saveDocumentWithRebase"),
      ),
    );
    expect(save).toContain(
      "options.contentAuthoredAfterRevision === winner.revision",
    );
    expect(save).not.toContain(
      "documentRevisionRef.current === winner.revision",
    );
  });

  // oracle-change: replaced by "keeps the page body read-only when its live copy fails to start" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: covered by "moves the typing onto the newer Page and saves it there, with no alert" and four sibling tests in DocumentEditor.recovery-save-state.test.tsx, which fail when a proposal takes the live body or revision.

  // oracle-change: replaced by "starts Suggesting from %s only on a Page that holds what was typed (reread with %s)" and "stays out of Suggesting when the words typed before it can't be saved" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: suggestion activation scrolling without taking Reply focus is now checked by behavior in suggestion-page-view.test.ts
  // oracle-change: replaced by "holds the draft still while leaving Suggesting saves it" in DocumentEditor.recovery-save-state.test.tsx. The second-exit guard has no way in while the editor is frozen; removing it broke no test.

  // oracle-change: replaced by "sends one decision for a Reject pressed twice and stays in Suggesting" and "shows the server's answer while a Reject that another tab beat to Accept reloads the Page" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by "shows the server's answer while a Reject that another tab beat to Accept reloads the Page" in DocumentEditor.recovery-save-state.test.tsx and "keeps a thread's highlight on text replaced before its new quote arrives" in VisualEditor.comment-highlights.test.tsx.

  // oracle-change: replaced by DocumentEditor.page-ui.test.tsx "draws saved suggestions and the one being typed together", which types a suggestion beside a saved one.

  // oracle-change: replaced by "opens Discussion on the suggestion a link names" and "opens Discussion on a saved edit/proposal whose accept can't be placed instead of treating it as accepted" in DocumentEditor.recovery-save-state.test.tsx.

  // oracle-change: replaced by the "/page" tests in SlashCommandMenu.undo.test.tsx and VisualEditor.comment-highlights.test.tsx, which make a page and save or take back its link, and "answers the page's immediate body save with whether the server kept it" in DocumentEditor.recovery-save-state.test.tsx.

  it("routes Content text-copy controls through the shared clipboard boundary", () => {
    const sources = [
      "./DocumentToolbar.tsx",
      "./extensions/AudioBlock.tsx",
      "./extensions/ImageBlock.tsx",
      "./extensions/VideoBlock.tsx",
      "../sidebar/NotionButton.tsx",
    ].map((path) =>
      // source-read-ok: a boundary rule over five files; no copy control may call navigator.clipboard itself
      readFileSync(new URL(path, import.meta.url), { encoding: "utf8" }),
    );

    for (const source of sources) {
      expect(source).toContain("writeClipboardText");
      expect(source).not.toContain("navigator.clipboard.writeText");
    }
  });

  it("builds a Notion-style breadcrumb from parent documents", () => {
    expect(
      documentEditorBreadcrumbItems(
        {
          id: "child",
          parentId: "parent",
          title: "Draft",
          icon: null,
        },
        [
          {
            id: "root",
            parentId: null,
            title: "Workspace",
            icon: "W",
          },
          {
            id: "parent",
            parentId: "root",
            title: "Project",
            icon: null,
          },
        ],
      ).map((item) => item.title),
    ).toEqual(["Workspace", "Project", "Draft"]);
  });

  it("defaults database pages to the database icon in the editor", () => {
    expect(
      documentEditorDefaultIconKind({
        database: {
          id: "database",
          documentId: "database-page",
          title: "Content calendar",
          viewConfig: {
            activeViewId: "default",
            views: [],
            sorts: [],
            filters: [],
            columnWidths: {},
          },
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      }),
    ).toBe("database");
    expect(documentEditorDefaultIconKind({ database: undefined })).toBeNull();
  });

  it("labels database row pages with their parent database", () => {
    expect(
      databaseMembershipDatabaseTitle({
        databaseId: "database",
        databaseDocumentId: "database-page",
        databaseTitle: "Content calendar",
        position: 0,
      }),
    ).toBe("Content calendar");
    expect(
      databaseMembershipDatabaseTitle({
        databaseId: "database",
        databaseDocumentId: "database-page",
        databaseTitle: "   ",
        position: 0,
      }),
    ).toBe("Untitled collection");
  });

  it("shows a linked file's folders in its breadcrumb without linking to them", () => {
    const notes = "local-source-directory:vault:notes";
    const year = "local-source-directory:vault:notes%2F2026";
    const path = [
      { id: notes, parentId: null, title: "notes", icon: null },
      { id: year, parentId: notes, title: "2026", icon: null },
      { id: "today", parentId: year, title: "Today", icon: null },
      { id: "child", parentId: "today", title: "Child", icon: null },
    ];

    expect(
      documentEditorBreadcrumbItems(
        { id: "today", parentId: null, title: "Today", icon: null },
        path,
      ),
    ).toEqual([
      { title: "notes", icon: null, iconKind: "folder" },
      { title: "2026", icon: null, iconKind: "folder" },
      { id: "today", title: "Today", icon: null },
    ]);
    expect(
      documentEditorBreadcrumbItems(
        { id: "child", parentId: "today", title: "Child", icon: null },
        path,
      ).map((item) => item.id ?? `[${item.title}]`),
    ).toEqual(["[notes]", "[2026]", "today", "child"]);
  });

  it("starts page breadcrumbs with the containing database", () => {
    expect(
      documentEditorBreadcrumbItems(
        {
          id: "draft",
          parentId: "project",
          title: "Draft",
          icon: null,
          databaseMembership: {
            databaseId: "database",
            databaseDocumentId: "database-page",
            databaseTitle: "Personal",
            position: 0,
          },
        },
        [
          {
            id: "project",
            parentId: null,
            title: "Project",
            icon: null,
          },
        ],
      ).map((item) => item.title),
    ).toEqual(["Personal", "Project", "Draft"]);
  });

  it("does not repeat a containing database already in the page ancestry", () => {
    expect(
      documentEditorBreadcrumbItems(
        {
          id: "draft",
          parentId: "database-page",
          title: "Draft",
          icon: null,
          databaseMembership: {
            databaseId: "database",
            databaseDocumentId: "database-page",
            databaseTitle: "Personal",
            position: 0,
          },
        },
        [
          {
            id: "database-page",
            parentId: null,
            title: "Personal",
            icon: null,
          },
        ],
      ).map((item) => item.title),
    ).toEqual(["Personal", "Draft"]);
  });

  it("keeps the workspace and last two levels visible in deep breadcrumbs", () => {
    expect(
      compactToolbarBreadcrumbItems([
        { id: "files", title: "Personal" },
        { id: "one", title: "Page 1" },
        { id: "two", title: "Page 2" },
        { id: "draft", title: "Draft" },
      ]).map((item) => item.title),
    ).toEqual(["Personal", "…", "Page 2", "Draft"]);
  });

  it("folds breadcrumb ancestors by width before the page title loses its readable width", () => {
    const deep = [
      { id: "files", title: "Personal" },
      { id: "one", title: "Page 1" },
      { id: "two", title: "Page 2" },
      { id: "draft", title: "Draft" },
    ];
    const shallow = [
      { id: "files", title: "Personal" },
      { id: "draft", title: "Draft" },
    ];
    const titles = (items: typeof deep, width: number) =>
      compactToolbarBreadcrumbItems(items, width).map((item) => item.title);

    expect(titles(deep, 380)).toEqual(["Personal", "…", "Page 2", "Draft"]);
    expect(titles(deep, 300)).toEqual(["…", "Page 2", "Draft"]);
    expect(
      compactToolbarBreadcrumbItems(deep, 300)[0].menuItems?.map(
        (item) => item.title,
      ),
    ).toEqual(["Personal", "Page 1"]);
    expect(titles(deep, 200)).toEqual(["…", "Draft"]);
    expect(titles(shallow, 216)).toEqual(["Personal", "Draft"]);
    expect(titles(shallow, 200)).toEqual(["…", "Draft"]);
  });

  it("keeps every ancestor in the breadcrumb menu at the narrowest width", () => {
    const deep = [
      { id: "files", title: "Personal" },
      { id: "one", title: "Page 1" },
      { id: "two", title: "Page 2" },
      { id: "draft", title: "Draft" },
    ];
    const menu = (items: typeof deep, width: number) =>
      compactToolbarBreadcrumbItems(items, width).map((item) => ({
        title: item.title,
        menu: item.menuItems?.map((menuItem) => menuItem.id),
      }));

    for (const width of [0, 60, 120]) {
      expect(menu(deep, width)).toEqual([
        { title: "…", menu: ["files", "one", "two"] },
        { title: "Draft", menu: undefined },
      ]);
      expect(menu([deep[0], deep[3]], width)).toEqual([
        { title: "…", menu: ["files"] },
        { title: "Draft", menu: undefined },
      ]);
      expect(menu([deep[3]], width)).toEqual([
        { title: "Draft", menu: undefined },
      ]);
    }
  });

  it("folds the same at a breadcrumb's fold width as at its measured width", () => {
    const deep = [
      { id: "files", title: "Personal" },
      { id: "one", title: "Page 1" },
      { id: "two", title: "Page 2" },
      { id: "draft", title: "Draft" },
    ];
    for (let width = 0; width <= 600; width += 1) {
      for (const items of [deep, deep.slice(1), deep.slice(2)]) {
        expect(
          compactToolbarBreadcrumbItems(items, breadcrumbFoldWidth(width)),
        ).toEqual(compactToolbarBreadcrumbItems(items, width));
      }
    }
  });

  it("focuses the first real breadcrumb destination on keyboard open", () => {
    expect(
      firstSelectableBreadcrumbMenuItemId(
        [
          { id: "draft", title: "Draft" },
          { id: "notes", title: "Notes" },
        ],
        "draft",
      ),
    ).toBe("notes");
    expect(firstSelectableBreadcrumbMenuItemId([], "draft")).toBeNull();
  });

  it("offers workspace and same-level page choices from breadcrumbs", () => {
    const items = documentEditorBreadcrumbNavigationItems(
      [
        { id: "personal-files", title: "Personal" },
        { id: "draft", title: "Draft" },
      ],
      [
        {
          id: "draft",
          parentId: null,
          title: "Draft",
          icon: null,
          position: 0,
          databaseMembership: {
            databaseId: "personal",
            databaseDocumentId: "personal-files",
            databaseTitle: "Personal",
            position: 0,
          },
        },
        {
          id: "notes",
          parentId: null,
          title: "Notes",
          icon: null,
          position: 1,
          databaseMembership: {
            databaseId: "personal",
            databaseDocumentId: "personal-files",
            databaseTitle: "Personal",
            position: 1,
          },
        },
      ],
      [
        { filesDocumentId: "personal-files", name: "Personal" },
        { filesDocumentId: "team-files", name: "Team" },
      ],
    );

    expect(items[0].menuItems?.map((item) => item.title)).toEqual([
      "Personal",
      "Team",
    ]);
    expect(items[0].iconKind).toBe("folder");
    expect(items[0].menuItems?.map((item) => item.iconKind)).toEqual([
      "folder",
      "folder",
    ]);
    expect(items[1].menuItems?.map((item) => item.title)).toEqual([
      "Draft",
      "Notes",
    ]);
  });

  it("excludes system documents from top-level breadcrumb peers", () => {
    const items = documentEditorBreadcrumbNavigationItems(
      [{ id: "draft", title: "Draft" }],
      [
        {
          id: "draft",
          parentId: null,
          title: "Draft",
          icon: null,
          position: 0,
          databaseMembership: {
            databaseId: "personal",
            databaseDocumentId: "personal-files",
            databaseTitle: "Personal",
            position: 0,
          },
        },
        {
          id: "notes",
          parentId: null,
          title: "Notes",
          icon: null,
          position: 1,
          databaseMembership: {
            databaseId: "personal",
            databaseDocumentId: "personal-files",
            databaseTitle: "Personal",
            position: 1,
          },
        },
        {
          id: "trash",
          parentId: null,
          title: "Trash",
          icon: null,
          position: 2,
          databaseMembership: {
            databaseId: "personal",
            databaseDocumentId: "personal-files",
            databaseTitle: "Personal",
            position: 2,
          },
          database: {
            id: "trash-database",
            documentId: "trash",
            title: "Trash",
            systemRole: "trash",
            viewConfig: {
              activeViewId: "default",
              views: [],
              sorts: [],
              filters: [],
              columnWidths: {},
            },
            createdAt: "2026-07-30T00:00:00.000Z",
            updatedAt: "2026-07-30T00:00:00.000Z",
          },
        },
      ],
      [],
    );

    expect(items[0].menuItems?.map((item) => item.title)).toEqual([
      "Draft",
      "Notes",
    ]);
  });

  it("keeps local-file folders as breadcrumb anchors but not peer destinations", () => {
    const items = documentEditorBreadcrumbNavigationItems(
      [{ id: "guides-folder", title: "Guides" }],
      [
        {
          id: "guides-folder",
          parentId: "docs-folder",
          title: "Guides",
          icon: null,
          position: 0,
          source: { mode: "local-files", kind: "folder", path: "docs/guides" },
        },
        {
          id: "setup-page",
          parentId: "docs-folder",
          title: "Setup",
          icon: null,
          position: 1,
        },
        {
          id: "reference-page",
          parentId: "docs-folder",
          title: "Reference",
          icon: null,
          position: 2,
        },
      ],
      [],
    );

    expect(items[0].menuItems?.map((item) => item.title)).toEqual([
      "Setup",
      "Reference",
    ]);
  });

  it("builds breadcrumbs from the navigation path without a document list", () => {
    const path = Array.from({ length: 7 }, (_, index) => ({
      id: `level-${index + 1}`,
      parentId: index === 0 ? null : `level-${index}`,
      title: `Level ${index + 1}`,
      icon: null,
      databaseId: "personal",
    }));
    const deepest = path[6]!;
    const items = documentEditorBreadcrumbItems(
      {
        ...deepest,
        databaseMembership: {
          databaseId: "personal",
          databaseDocumentId: "personal-files",
          databaseTitle: "Personal",
          position: 0,
        },
      },
      path,
    );

    expect(items.map((item) => item.title)).toEqual([
      "Personal",
      ...path.map((entry) => entry.title),
    ]);
    const navigation = documentEditorBreadcrumbNavigationItems(
      items,
      [],
      [{ filesDocumentId: "personal-files", name: "Personal" }],
      undefined,
      path,
    );
    expect(navigation[0]?.siblings).toBeUndefined();
    expect(navigation[0]?.menuItems?.map((item) => item.title)).toEqual([
      "Personal",
    ]);
    expect(navigation[1]).toMatchObject({
      filesDatabaseId: "personal",
      siblings: { filesDatabaseId: "personal", parentId: null },
    });
    expect(navigation[7]?.siblings).toEqual({
      filesDatabaseId: "personal",
      parentId: "level-6",
    });
  });

  it("stops breadcrumbs and peer menus at an unreadable ancestor", () => {
    const path = [
      {
        id: "shared-child",
        parentId: "private-parent",
        title: "Shared child",
        icon: null,
        databaseId: "team",
      },
      {
        id: "draft",
        parentId: "shared-child",
        title: "Draft",
        icon: null,
        databaseId: "team",
      },
    ];
    const items = documentEditorBreadcrumbItems(path[1]!, path);
    expect(items.map((item) => item.title)).toEqual(["Shared child", "Draft"]);

    const navigation = documentEditorBreadcrumbNavigationItems(
      items,
      [],
      [],
      undefined,
      path,
    );
    expect(navigation[0]?.siblings).toBeUndefined();
    expect(navigation[1]?.siblings).toEqual({
      filesDatabaseId: "team",
      parentId: "shared-child",
    });
  });

  it("links a top-level Files database back to Workspaces", () => {
    const items = documentEditorBreadcrumbNavigationItems(
      [{ id: "personal-files", title: "Personal" }],
      [],
      [{ filesDocumentId: "personal-files", name: "Personal" }],
      {
        currentDocumentId: "personal-files",
        currentParentId: null,
        currentDatabaseSystemRole: "files",
        catalogDocumentId: "workspaces-document",
        workspacesTitle: "Workspaces",
      },
    );

    expect(items.map((item) => item.title)).toEqual(["Workspaces", "Personal"]);
    expect(items.map((item) => item.id)).toEqual([
      "workspaces-document",
      "personal-files",
    ]);
    expect(items.map((item) => item.iconKind)).toEqual(["folder", "folder"]);
  });

  // oracle-change: replaced by DocumentToolbar.breadcrumb.test.tsx "marks folders and leaves the page usable while a hover menu is open", which hovers the menu.

  // oracle-change: replaced by "keeps the Page's own save time when an agent writes its linked file" in DocumentEditor.recovery-save-state.test.tsx.

  it("saves a new page after its own title edit instead of parking it in a draft", () => {
    // A new page: the query already holds the typed title, the save base is "".
    expect(
      titleRenamedByAnotherWriter({
        documentTitle: "Fourth",
        titleBase: "",
        title: "Fourth",
      }),
    ).toBe(false);
    expect(
      titleRenamedByAnotherWriter({
        documentTitle: "Renamed elsewhere",
        titleBase: "",
        title: "Fourth",
      }),
    ).toBe(true);
    expect(
      titleRenamedByAnotherWriter({
        documentTitle: "Anything",
        titleBase: undefined,
        title: "Fourth",
      }),
    ).toBe(false);
  });
});
