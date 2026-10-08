// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPageDraftJournal,
  clearPageDraftJournalGeneration,
  listPageDraftJournal,
  PageDraftJournalError,
  syncPageDraftJournalBeforePersistingRecoveryDraft,
  readPageDraftJournal,
  sweepLegacyRetainedPageDraftMarkers,
  updatePageDraftJournalTitle,
  writePageDraftJournal,
  type PageDraftJournalScope,
} from "./page-draft-journal";

const values = new Map<string, string>();
const store: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => Array.from(values.keys())[index] ?? null,
  removeItem: (key) => {
    values.delete(key);
  },
  setItem: (key, value) => {
    values.set(key, value);
  },
};

const scope: PageDraftJournalScope = {
  accountId: "Writer@Example.test",
  orgId: "org-one",
  documentId: "page-one",
  writerId: "tab-one",
};
const snapshot = {
  title: "Local title",
  content: "Local body",
  baseTitle: "Saved title",
  baseContent: "Saved body",
  baseUpdatedAt: "version-one",
  editGeneration: 1,
};

beforeEach(() => {
  values.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: store,
  });
});

describe("Page draft journal", () => {
  it("syncs a clean local journal before persisting the retained title and body", async () => {
    const clean = {
      ...snapshot,
      title: "Earlier title",
      baseTitle: "Earlier title",
      content: "Older local body",
      authoredBaseRevision: "old-body-revision",
      authoredBaseContent: "Old saved body",
      authoredCandidateContent: "Older local body",
      saveAttemptId: "old-body-attempt",
      equivalentSaveAttemptIds: ["old-body-equivalent"],
    };
    writePageDraftJournal({ scope, snapshot: clean });
    const persist = vi.fn(async () => {
      expect(readPageDraftJournal(scope)?.snapshot).toMatchObject({
        title: "Peer title",
        baseTitle: "Peer title",
        content: "Local body",
      });
    });

    await expect(
      syncPageDraftJournalBeforePersistingRecoveryDraft({
        persist,
        scope,
        title: "Peer title",
        editGeneration: clean.editGeneration,
        content: "Local body",
      }),
    ).resolves.toBe(true);

    expect(persist).toHaveBeenCalledOnce();
    expect(readPageDraftJournal(scope)?.snapshot).toMatchObject({
      title: "Peer title",
      baseTitle: "Peer title",
      content: "Local body",
    });
    expect(readPageDraftJournal(scope)?.snapshot.saveAttemptId).toBeUndefined();
    expect(
      readPageDraftJournal(scope)?.snapshot.authoredCandidateContent,
    ).toBeUndefined();
    expect(
      readPageDraftJournal(scope)?.snapshot.equivalentSaveAttemptIds,
    ).toBeUndefined();
  });

  it("restores the local journal when retaining the SQL recovery draft fails", async () => {
    const clean = {
      ...snapshot,
      title: "Earlier title",
      baseTitle: "Earlier title",
    };
    const original = writePageDraftJournal({ scope, snapshot: clean });

    await expect(
      syncPageDraftJournalBeforePersistingRecoveryDraft({
        persist: () => Promise.reject(new Error("SQL unavailable")),
        scope,
        title: "Peer title",
        editGeneration: clean.editGeneration,
        content: clean.content,
      }),
    ).rejects.toThrow("SQL unavailable");

    expect(readPageDraftJournal(scope)).toEqual(original);
  });

  it("reports both save and rollback failures", async () => {
    const clean = {
      ...snapshot,
      title: "Earlier title",
      baseTitle: "Earlier title",
    };
    writePageDraftJournal({ scope, snapshot: clean });
    const originalSetItem = store.setItem;
    const persistError = new Error("SQL unavailable");
    const rollbackError = new Error("Storage unavailable");
    let writes = 0;
    store.setItem = (key, value) => {
      writes += 1;
      if (writes === 2) throw rollbackError;
      originalSetItem(key, value);
    };

    try {
      await expect(
        syncPageDraftJournalBeforePersistingRecoveryDraft({
          persist: () => Promise.reject(persistError),
          scope,
          title: "Peer title",
          editGeneration: clean.editGeneration,
          content: clean.content,
        }),
      ).rejects.toMatchObject({
        code: "rollback_failed",
        cause: { persistError, rollbackError },
      });
    } finally {
      store.setItem = originalSetItem;
    }
  });

  it("preserves a locally authored title when SQL retains a peer title", async () => {
    writePageDraftJournal({ scope, snapshot });

    await expect(
      syncPageDraftJournalBeforePersistingRecoveryDraft({
        persist: () => Promise.resolve(),
        scope,
        title: "Peer title",
        editGeneration: snapshot.editGeneration,
        content: snapshot.content,
      }),
    ).resolves.toBe(false);

    expect(readPageDraftJournal(scope)?.snapshot.title).toBe("Local title");
  });

  it("persists the server draft when the local journal write fails", async () => {
    const clean = {
      ...snapshot,
      title: "Earlier title",
      baseTitle: "Earlier title",
    };
    writePageDraftJournal({ scope, snapshot: clean });
    const originalSetItem = store.setItem;
    store.setItem = () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
    const persist = vi.fn().mockResolvedValue(undefined);

    try {
      await expect(
        syncPageDraftJournalBeforePersistingRecoveryDraft({
          persist,
          scope,
          title: "Peer title",
          editGeneration: clean.editGeneration,
          content: clean.content,
        }),
      ).rejects.toMatchObject({ code: "write_failed" });
    } finally {
      store.setItem = originalSetItem;
    }

    expect(persist).toHaveBeenCalledOnce();
    expect(readPageDraftJournal(scope)?.snapshot).toEqual(clean);
  });

  it("does not roll back a newer journal written while persistence is pending", async () => {
    writePageDraftJournal({ scope, snapshot });
    const newer = {
      ...snapshot,
      content: "Newer local body",
      editGeneration: snapshot.editGeneration + 1,
    };

    await expect(
      syncPageDraftJournalBeforePersistingRecoveryDraft({
        persist: async () => {
          writePageDraftJournal({ scope, snapshot: newer });
          throw new Error("SQL unavailable");
        },
        scope,
        title: "Peer title",
        editGeneration: snapshot.editGeneration,
        content: snapshot.content,
      }),
    ).rejects.toThrow("SQL unavailable");

    expect(readPageDraftJournal(scope)?.snapshot).toEqual(newer);
  });

  it("writes synchronously and isolates account, organization, Page, and writer", () => {
    writePageDraftJournal({ scope, snapshot });
    writePageDraftJournal({
      scope: { ...scope, writerId: "tab-two" },
      snapshot: { ...snapshot, content: "Second writer" },
    });
    expect(
      listPageDraftJournal({
        accountId: "writer@example.test",
        orgId: "org-one",
        documentId: "page-one",
      }).map((entry) => entry.snapshot.content),
    ).toEqual(["Local body", "Second writer"]);
    expect(listPageDraftJournal({ ...scope, orgId: "org-two" })).toEqual([]);
    expect(
      listPageDraftJournal({ ...scope, accountId: "other@example.test" }),
    ).toEqual([]);
    expect(listPageDraftJournal({ ...scope, documentId: "page-two" })).toEqual(
      [],
    );
  });

  it("does not clear a newer generation after an older save acknowledges", () => {
    writePageDraftJournal({ scope, snapshot });
    writePageDraftJournal({
      scope,
      snapshot: {
        ...snapshot,
        content: "Newer local body",
        editGeneration: 2,
      },
    });
    expect(clearPageDraftJournal(scope, snapshot)).toBe(false);
    expect(listPageDraftJournal(scope)[0]?.snapshot.content).toBe(
      "Newer local body",
    );
    expect(
      clearPageDraftJournal(scope, {
        editGeneration: 2,
        title: "Local title",
        content: "Newer local body",
      }),
    ).toBe(true);
    expect(listPageDraftJournal(scope)).toEqual([]);
  });

  it("retires a represented authored generation even when the canonical merge adds peer text", () => {
    writePageDraftJournal({ scope, snapshot });
    expect(clearPageDraftJournalGeneration(scope, 0)).toBe(false);
    expect(readPageDraftJournal(scope)?.snapshot.content).toBe("Local body");
    expect(clearPageDraftJournalGeneration(scope, 1)).toBe(true);
    expect(readPageDraftJournal(scope)).toBeNull();
  });

  it("sweeps legacy retained markers for every page and writer", () => {
    values.set("content-page-draft-retained-v1:a:org:page-one:old-writer", "1");
    values.set("content-page-draft-retained-v1:a:org:page-two:other", "1");
    writePageDraftJournal({ scope, snapshot });
    sweepLegacyRetainedPageDraftMarkers();
    expect(
      Array.from(values.keys()).filter((key) =>
        key.startsWith("content-page-draft-retained-v1:"),
      ),
    ).toEqual([]);
    expect(readPageDraftJournal(scope)?.snapshot.content).toBe("Local body");
  });

  it("rejects an older queued write after a newer edit", () => {
    writePageDraftJournal({
      scope,
      snapshot: { ...snapshot, content: "Newest", editGeneration: 2 },
    });
    writePageDraftJournal({
      scope,
      snapshot: { ...snapshot, saveAttemptId: "older-attempt" },
    });
    expect(readPageDraftJournal(scope)?.snapshot.content).toBe("Newest");
    expect(readPageDraftJournal(scope)?.snapshot.saveAttemptId).toBeUndefined();
  });

  it("updates only the matching writer draft title and preserves snapshot metadata", () => {
    const originalSnapshot = {
      ...snapshot,
      title: "Saved title",
      baseRevision: "base-revision",
      authoredBaseRevision: "authored-base-revision",
      authoredBaseContent: "authored base",
      authoredCandidateContent: "authored candidate",
      saveAttemptId: "save-attempt",
      priorSaveAttemptIds: ["prior-attempt"],
      equivalentSaveAttemptIds: ["equivalent-attempt"],
    };
    writePageDraftJournal({
      scope,
      snapshot: originalSnapshot,
    });
    writePageDraftJournal({
      scope: { ...scope, writerId: "other-tab" },
      snapshot: { ...originalSnapshot, title: "Other tab title" },
    });

    expect(updatePageDraftJournalTitle(scope, "Peer title")).toBe(true);
    expect(
      listPageDraftJournal(scope).find(
        (entry) => entry.scope.writerId === scope.writerId,
      )?.snapshot,
    ).toEqual({
      ...originalSnapshot,
      title: "Peer title",
      baseTitle: "Peer title",
    });
    expect(
      listPageDraftJournal(scope).find(
        (entry) => entry.scope.writerId === "other-tab",
      )?.snapshot.title,
    ).toBe("Other tab title");
  });

  it("adopts consecutive peer titles and treats a repeated title as a no-op", () => {
    const uneditedSnapshot = { ...snapshot, title: "Saved title" };
    writePageDraftJournal({ scope, snapshot: uneditedSnapshot });

    expect(updatePageDraftJournalTitle(scope, "Peer title")).toBe(true);
    expect(updatePageDraftJournalTitle(scope, "New peer title")).toBe(true);
    expect(updatePageDraftJournalTitle(scope, "New peer title")).toBe(true);
    expect(readPageDraftJournal(scope)?.snapshot).toEqual({
      ...uneditedSnapshot,
      title: "New peer title",
      baseTitle: "New peer title",
    });
  });

  it("preserves a locally edited title when a peer title arrives", () => {
    writePageDraftJournal({ scope, snapshot });
    const before = readPageDraftJournal(scope);

    expect(updatePageDraftJournalTitle(scope, "Peer title")).toBe(false);
    expect(readPageDraftJournal(scope)).toEqual(before);
  });

  it("reports a failed peer-title update as a typed storage failure", () => {
    const uneditedSnapshot = { ...snapshot, title: "Saved title" };
    writePageDraftJournal({ scope, snapshot: uneditedSnapshot });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        ...store,
        setItem: () => {
          throw new Error("quota");
        },
      },
    });

    expect(() => updatePageDraftJournalTitle(scope, "Peer title")).toThrowError(
      PageDraftJournalError,
    );
    try {
      updatePageDraftJournalTitle(scope, "Peer title");
    } catch (error) {
      expect((error as PageDraftJournalError).code).toBe("write_failed");
    }
  });

  it("reports a failed synchronous write as a typed failure", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        ...store,
        setItem: () => {
          throw new Error("quota");
        },
      },
    });
    expect(() => writePageDraftJournal({ scope, snapshot })).toThrowError(
      PageDraftJournalError,
    );
    try {
      writePageDraftJournal({ scope, snapshot });
    } catch (error) {
      expect((error as PageDraftJournalError).code).toBe("write_failed");
    }
  });

  it("reports corrupt scoped data instead of treating it as an empty journal", () => {
    writePageDraftJournal({ scope, snapshot });
    const [key] = values.keys();
    values.set(key!, "{broken");
    expect(() => listPageDraftJournal(scope)).toThrowError(
      PageDraftJournalError,
    );
  });
});
