import type { Document } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

import type {
  PageDraftJournalEntry,
  PageDraftJournalSnapshot,
} from "../editor/page-draft-journal";
import {
  mergeCreatedDocumentWithDraft,
  prepareCreatedDraftReplay,
  retryCreateAfterDraftRead,
} from "./DocumentSidebar";

function createdDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "page-1",
    parentId: null,
    title: "",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-10-08T12:00:00.000Z",
    updatedAt: "2026-10-08T12:00:00.000Z",
    revision: "created-revision",
    ...overrides,
  };
}

function draftEntry(
  snapshot: Partial<PageDraftJournalSnapshot> = {},
): PageDraftJournalEntry {
  return {
    scope: {
      accountId: "writer@example.test",
      orgId: "org-1",
      documentId: "page-1",
      writerId: "tab-1",
    },
    snapshot: {
      title: "Recovered title",
      content: "Recovered body",
      baseTitle: "",
      baseContent: "",
      baseUpdatedAt: null,
      editGeneration: 4,
      ...snapshot,
    },
    writtenAt: 1,
  };
}

describe("document sidebar create recovery", () => {
  it("overlays a restored draft onto the create response without losing server metadata", () => {
    const created = createdDocument();

    expect(mergeCreatedDocumentWithDraft(created, draftEntry())).toMatchObject({
      id: created.id,
      title: "Recovered title",
      content: "Recovered body",
      revision: created.revision,
      updatedAt: created.updatedAt,
    });
  });

  it("replays a draft against the actual blank create revision when its original base matches", () => {
    const created = createdDocument();
    const replay = prepareCreatedDraftReplay(created, draftEntry());

    expect(replay).not.toBeNull();
    expect(replay?.snapshot).toMatchObject({
      title: "Recovered title",
      content: "Recovered body",
      baseTitle: "",
      baseContent: "",
      baseUpdatedAt: created.updatedAt,
      baseRevision: created.revision,
      authoredBaseRevision: created.revision,
      authoredBaseContent: "",
      authoredCandidateContent: "Recovered body",
    });
    expect(replay?.request).toMatchObject({
      id: created.id,
      title: "Recovered title",
      content: "Recovered body",
      baseTitle: "",
      baseUpdatedAt: created.updatedAt,
      loadedUpdatedAt: created.updatedAt,
      baseRevision: created.revision,
      editorSessionId: "tab-1",
      editorEditGeneration: 4,
      authoredBaseRevision: created.revision,
      authoredBaseContent: "",
      authoredCandidateContent: "Recovered body",
    });
  });

  it("preserves the journal's original base when it differs from the create response", () => {
    const created = createdDocument();
    const originalBase = draftEntry({
      baseTitle: "Previously saved title",
      baseContent: "Previously saved body",
      baseUpdatedAt: "2026-10-07T12:00:00.000Z",
      baseRevision: "original-revision",
      authoredBaseRevision: "original-revision",
      authoredBaseContent: "Previously saved body",
      authoredCandidateContent: "Recovered body",
    });
    const replay = prepareCreatedDraftReplay(created, originalBase);

    expect(replay?.snapshot).toMatchObject({
      baseTitle: "Previously saved title",
      baseContent: "Previously saved body",
      baseUpdatedAt: "2026-10-07T12:00:00.000Z",
      baseRevision: "original-revision",
    });
    expect(replay?.request).toMatchObject({
      baseTitle: "Previously saved title",
      baseUpdatedAt: "2026-10-07T12:00:00.000Z",
      loadedUpdatedAt: "2026-10-07T12:00:00.000Z",
      baseRevision: "original-revision",
      authoredBaseRevision: "original-revision",
      authoredBaseContent: "Previously saved body",
    });
  });

  it("does not invoke create when the draft journal is unreadable", async () => {
    const journalError = new Error("journal unavailable");
    const read = vi.fn(() => {
      throw journalError;
    });
    const create = vi.fn(async () => createdDocument());

    await expect(retryCreateAfterDraftRead(read, create)).rejects.toBe(
      journalError,
    );
    expect(read).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns the journal snapshot read after create for replay", async () => {
    const initialDraft = draftEntry({ content: "Initial body" });
    const latestDraft = draftEntry({
      content: "Latest body",
      editGeneration: 5,
    });
    const read = vi
      .fn<() => PageDraftJournalEntry | null>()
      .mockReturnValueOnce(initialDraft)
      .mockReturnValueOnce(latestDraft);

    const result = await retryCreateAfterDraftRead(read, async () => "created");

    expect(result).toEqual({ created: "created", draft: latestDraft });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
