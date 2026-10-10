import type { Document } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

import type {
  PageDraftJournalEntry,
  PageDraftJournalSnapshot,
} from "../editor/page-draft-journal";
import {
  mergeCreatedDocumentWithDraft,
  prepareCreatedDraftReplay,
  readDocumentBeforeCreateDiscard,
  retryCreateAfterDraftRead,
  retryCreateAfterIntentWrite,
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
  it("preserves committed pages when a failed create is discarded", async () => {
    const document = createdDocument({ id: "committed-page" });

    await expect(
      readDocumentBeforeCreateDiscard(async () => document),
    ).resolves.toEqual({ kind: "committed", document });
  });

  it("treats only a confirmed 404 as an uncommitted create", async () => {
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const unavailable = Object.assign(new Error("unavailable"), {
      status: 503,
    });

    await expect(
      readDocumentBeforeCreateDiscard(async () => {
        throw notFound;
      }),
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      readDocumentBeforeCreateDiscard(async () => {
        throw unavailable;
      }),
    ).rejects.toBe(unavailable);
  });

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

  it("still retries creation when browser storage cannot refresh the intent", async () => {
    const storageError = new DOMException(
      "Storage is full.",
      "QuotaExceededError",
    );
    const storage = {
      setItem: vi.fn(() => {
        throw storageError;
      }),
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: storage });
    const storageWarning = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const created = createdDocument();
    const read = vi.fn<() => PageDraftJournalEntry | null>(() => null);
    const create = vi.fn(async () => created);

    try {
      await expect(
        retryCreateAfterIntentWrite(
          { accountId: "writer@example.test", orgId: "org-1" },
          {
            id: created.id,
            parentId: null,
            spaceId: null,
            createdAt: "2026-10-08T12:00:00.000Z",
            status: "failed",
          },
          read,
          create,
        ),
      ).resolves.toEqual({ created, draft: null });
      expect(create).toHaveBeenCalledOnce();
      expect(storageWarning).toHaveBeenCalledWith(
        expect.stringContaining("attempting server creation anyway"),
        expect.any(Error),
      );
    } finally {
      vi.unstubAllGlobals();
      storageWarning.mockRestore();
    }
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
