// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPageDraftJournal,
  clearPageDraftJournalGeneration,
  hasRetainedPageDraftNotice,
  listPageDraftJournal,
  markPageDraftJournalRetained,
  PageDraftJournalError,
  readPageDraftJournal,
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

  it("keeps History-retained edits on device without replaying them again", () => {
    writePageDraftJournal({ scope, snapshot });
    expect(markPageDraftJournalRetained(scope, snapshot)).toBe(true);
    expect(readPageDraftJournal(scope)).toBeNull();
    expect(listPageDraftJournal(scope)).toEqual([]);
    expect(hasRetainedPageDraftNotice(scope)).toBe(true);
    expect(Array.from(values.values()).join(" ")).not.toContain("Local body");
    writePageDraftJournal({
      scope,
      snapshot: { ...snapshot, content: "New intent", editGeneration: 2 },
    });
    expect(readPageDraftJournal(scope)?.snapshot.content).toBe("New intent");
    expect(hasRetainedPageDraftNotice(scope)).toBe(false);
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
