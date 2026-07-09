import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canonicalizeNfm } from "../../shared/nfm.js";

function hashContentForTest(content: string | null | undefined): string {
  return crypto
    .createHash("sha256")
    .update(canonicalizeNfm(content ?? ""))
    .digest("hex");
}

const testState = vi.hoisted(() => ({
  document: {
    id: "doc-1",
    ownerEmail: "alice@example.com",
    title: "Local title",
    content: "Local body",
    icon: null as string | null,
    updatedAt: "2026-06-01T10:00:00.000Z",
  },
  link: null as any,
  comments: [] as Array<Record<string, unknown>>,
}));

const notionMocks = vi.hoisted(() => {
  // Minimal stand-in for the real NotionApiError class (server/lib/notion.ts)
  // so `instanceof NotionApiError` checks in notion-sync.ts work against the
  // mocked ./notion.js module.
  class MockNotionApiError extends Error {
    status: number;
    code: string | null;
    body: any;
    constructor(
      message: string,
      status: number,
      code: string | null = null,
      body: any = null,
    ) {
      super(message);
      this.name = "NotionApiError";
      this.status = status;
      this.code = code;
      this.body = body;
    }
  }

  return {
    createNotionPageWithMarkdown: vi.fn(),
    fetchNotionPage: vi.fn(),
    getNotionConnectionForOwner: vi.fn(),
    normalizeNotionPageId: vi.fn((input: string) => input),
    notionFetch: vi.fn(),
    readNotionPageAsDocument: vi.fn(),
    pushDocumentToNotionPage: vi.fn(),
    NotionApiError: MockNotionApiError,
  };
});

// Real `and`/`eq`/`or`/`isNull`/`lt` so the mock DB below can actually
// evaluate WHERE conditions instead of matching unconditionally — required
// to exercise the compare-and-swap (CAS) and claim guards under test.
type EqCondition = { __eq: string; value: unknown };
type IsNullCondition = { __isNull: string };
type LtCondition = { __lt: string; value: unknown };
type Condition = EqCondition | IsNullCondition | LtCondition;
type AndCondition = { __and: WhereClause[] };
type OrCondition = { __or: WhereClause[] };
type WhereClause = Condition | AndCondition | OrCondition;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conditions: WhereClause[]): AndCondition => ({
      __and: conditions,
    }),
    or: (...conditions: WhereClause[]): OrCondition => ({ __or: conditions }),
    eq: (column: string, value: unknown): EqCondition => ({
      __eq: column,
      value,
    }),
    isNull: (column: string): IsNullCondition => ({ __isNull: column }),
    lt: (column: string, value: unknown): LtCondition => ({
      __lt: column,
      value,
    }),
  };
});

vi.mock("@agent-native/core/collab", () => ({
  deleteCollabState: vi.fn(),
  releaseDoc: vi.fn(),
}));

vi.mock("../db/index.js", () => {
  const schema = {
    documents: {
      id: "documents.id",
      ownerEmail: "documents.ownerEmail",
      updatedAt: "documents.updatedAt",
    },
    documentSyncLinks: {
      documentId: "documentSyncLinks.documentId",
      ownerEmail: "documentSyncLinks.ownerEmail",
      syncClaimedAt: "documentSyncLinks.syncClaimedAt",
    },
    documentComments: {
      documentId: "documentComments.documentId",
      ownerEmail: "documentComments.ownerEmail",
      authorEmail: "documentComments.authorEmail",
      notionCommentId: "documentComments.notionCommentId",
    },
  };

  function fieldName(column: string): string {
    return String(column).split(".").pop() as string;
  }

  function matches(row: Record<string, unknown>, where: unknown): boolean {
    if (!where || typeof where !== "object") return true;
    const clause = where as Partial<
      AndCondition & OrCondition & EqCondition & IsNullCondition & LtCondition
    >;
    if (clause.__and) {
      return clause.__and.every((c) => matches(row, c));
    }
    if (clause.__or) {
      return clause.__or.some((c) => matches(row, c));
    }
    if (clause.__isNull !== undefined) {
      return row[fieldName(clause.__isNull)] == null;
    }
    if (clause.__lt !== undefined) {
      const value = row[fieldName(clause.__lt)] as string | number | null;
      const bound = (clause as LtCondition).value as string | number;
      return value != null && value < bound;
    }
    if (clause.__eq !== undefined) {
      return row[fieldName(clause.__eq)] === (clause as EqCondition).value;
    }
    return true;
  }

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.documents) return [testState.document];
          if (table === schema.documentSyncLinks) {
            return testState.link ? [testState.link] : [];
          }
          if (table === schema.documentComments) return testState.comments;
          return [];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({
          set,
        }: {
          set: Record<string, unknown>;
        }) => {
          if (table === schema.documentSyncLinks) {
            testState.link = { ...row, ...set };
          }
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (updates: Record<string, unknown>) => ({
        where: (where: unknown) => {
          const apply = async () => {
            if (table === schema.documents) {
              if (!matches(testState.document, where)) return [];
              testState.document = { ...testState.document, ...updates };
              return [{ id: testState.document.id }];
            }
            if (table === schema.documentComments) {
              testState.comments = testState.comments.map((row) =>
                matches(row, where) ? { ...row, ...updates } : row,
              );
              return [];
            }
            if (table === schema.documentSyncLinks) {
              if (!testState.link || !matches(testState.link, where)) {
                return [];
              }
              testState.link = { ...testState.link, ...updates };
              return [{ documentId: testState.link.documentId }];
            }
            return [];
          };
          return {
            then: (...args: Parameters<Promise<unknown>["then"]>) =>
              apply().then(...args),
            returning: async (_shape?: unknown) => apply(),
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        if (table === schema.documentComments) {
          testState.comments = testState.comments.filter(
            (row) => !matches(row, where),
          );
        }
        if (table === schema.documentSyncLinks) {
          testState.link = null;
        }
      },
    }),
  };

  return { getDb: () => db, schema };
});

vi.mock("./documents.js", () => ({
  getCurrentOwnerEmail: () => "alice@example.com",
}));

vi.mock("./notion.js", () => notionMocks);

describe("createAndLinkNotionPage", () => {
  beforeEach(() => {
    testState.document = {
      id: "doc-1",
      ownerEmail: "alice@example.com",
      title: "Local title",
      content: "Local body",
      icon: null,
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    testState.link = null;
    vi.clearAllMocks();

    notionMocks.getNotionConnectionForOwner.mockResolvedValue({
      accessToken: "notion-token",
    });
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "parent-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });
    notionMocks.createNotionPageWithMarkdown.mockResolvedValue({
      id: "new-page",
      url: "https://notion.so/new-page",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "new-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T10:31:00.000Z",
      warnings: [],
    });
  });

  it("establishes a pulled baseline after creating the remote page", async () => {
    const { createAndLinkNotionPage } = await import("./notion-sync.js");

    const status = await createAndLinkNotionPage(
      "alice@example.com",
      "doc-1",
      "parent-page",
    );

    expect(notionMocks.createNotionPageWithMarkdown).toHaveBeenCalledWith({
      accessToken: "notion-token",
      parentPageId: "parent-page",
      title: "Local title",
      content: "Local body",
      icon: null,
    });
    expect(notionMocks.readNotionPageAsDocument).toHaveBeenCalledWith(
      "notion-token",
      "new-page",
    );
    expect(testState.link?.lastPulledRemoteUpdatedAt).toBe(
      "2026-06-01T10:31:00.000Z",
    );
    expect(testState.link?.lastKnownRemoteUpdatedAt).toBe(
      "2026-06-01T10:31:00.000Z",
    );
    expect(status.remoteChanged).toBe(false);
  });

  it("does not create a second Notion page when the document is already linked", async () => {
    testState.link = {
      documentId: "doc-1",
      ownerEmail: "alice@example.com",
      remotePageId: "existing-page",
      state: "linked",
      lastSyncedContentHash: hashContentForTest("Local body"),
    };
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "existing-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T10:31:00.000Z",
      warnings: [],
    });

    const { createAndLinkNotionPage } = await import("./notion-sync.js");

    await createAndLinkNotionPage("alice@example.com", "doc-1", "parent-page");

    expect(notionMocks.createNotionPageWithMarkdown).not.toHaveBeenCalled();
    expect(testState.link?.remotePageId).toBe("existing-page");
  });

  it("still returns a linked status when the initial pull fails after page creation", async () => {
    notionMocks.readNotionPageAsDocument.mockRejectedValue(
      new Error("Network blip"),
    );

    const { createAndLinkNotionPage } = await import("./notion-sync.js");

    const status = await createAndLinkNotionPage(
      "alice@example.com",
      "doc-1",
      "parent-page",
    );

    expect(notionMocks.createNotionPageWithMarkdown).toHaveBeenCalledTimes(1);
    expect(status.pageId).toBe("new-page");

    // A retry after the failure must not create a second page — the link
    // established by the first call makes the retry idempotent.
    await createAndLinkNotionPage("alice@example.com", "doc-1", "parent-page");
    expect(notionMocks.createNotionPageWithMarkdown).toHaveBeenCalledTimes(1);
  });
});

describe("unlinkDocumentFromNotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.link = {
      documentId: "doc-1",
      ownerEmail: "alice@example.com",
      remotePageId: "notion-page",
      state: "linked",
    };
    testState.comments = [
      {
        id: "c-local",
        documentId: "doc-1",
        ownerEmail: "alice@example.com",
        authorEmail: "alice@example.com",
        notionCommentId: "notion-comment-1",
        content: "A local comment already pushed to Notion",
      },
      {
        id: "c-notion",
        documentId: "doc-1",
        ownerEmail: "alice@example.com",
        authorEmail: "notion@sync",
        notionCommentId: "notion-comment-2",
        content: "A comment pulled from Notion",
      },
    ];
  });

  it("clears notionCommentId on local comments and removes Notion-origin comments", async () => {
    const { unlinkDocumentFromNotion } = await import("./notion-sync.js");

    await unlinkDocumentFromNotion("alice@example.com", "doc-1");

    expect(testState.link).toBeNull();
    // The Notion-origin comment (pulled) is removed — it belongs to the old page.
    expect(testState.comments.find((c) => c.id === "c-notion")).toBeUndefined();
    // The local comment survives but becomes re-pushable to a new link.
    const local = testState.comments.find((c) => c.id === "c-local");
    expect(local).toBeDefined();
    expect(local?.notionCommentId).toBeNull();
  });
});

describe("getDocumentSyncStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.document = {
      id: "doc-1",
      ownerEmail: "alice@example.com",
      title: "Local title",
      content: "Local body",
      icon: null,
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    testState.link = {
      documentId: "doc-1",
      ownerEmail: "alice@example.com",
      remotePageId: "notion-page",
      state: "linked",
      lastSyncedAt: "2026-06-01T09:00:00.000Z",
      lastPulledRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastPushedLocalUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastKnownRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastSyncedContentHash: hashContentForTest("Local body"),
      hasConflict: false,
      warningsJson: "[]",
    };
    notionMocks.getNotionConnectionForOwner.mockResolvedValue({
      accessToken: "notion-token",
    });
  });

  it("reports connected: false on a 401 (revoked integration) instead of connected-with-error", async () => {
    const { getDocumentSyncStatus } = await import("./notion-sync.js");

    notionMocks.fetchNotionPage.mockRejectedValue(
      new notionMocks.NotionApiError("Unauthorized", 401, "unauthorized"),
    );

    const status = await getDocumentSyncStatus("alice@example.com", "doc-1");

    expect(status.connected).toBe(false);
    expect(testState.link?.lastError).toContain("Unauthorized");
  });

  it("keeps connected: true on a transient error (e.g. 500)", async () => {
    const { getDocumentSyncStatus } = await import("./notion-sync.js");

    notionMocks.fetchNotionPage.mockRejectedValue(
      new notionMocks.NotionApiError("Server error", 500, null),
    );

    const status = await getDocumentSyncStatus("alice@example.com", "doc-1");

    expect(status.connected).toBe(true);
  });
});

describe("pullDocumentFromNotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.document = {
      id: "doc-1",
      ownerEmail: "alice@example.com",
      title: "Local title",
      content: "Local body",
      icon: null,
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    testState.link = {
      documentId: "doc-1",
      ownerEmail: "alice@example.com",
      remotePageId: "notion-page",
      state: "linked",
      lastSyncedAt: "2026-06-01T09:00:00.000Z",
      lastPulledRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastPushedLocalUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastKnownRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastSyncedContentHash: hashContentForTest("Local body"),
      hasConflict: false,
      warningsJson: "[]",
    };

    notionMocks.getNotionConnectionForOwner.mockResolvedValue({
      accessToken: "notion-token",
    });
  });

  it("does not overwrite a local save that races the Notion fetch, and marks conflict", async () => {
    const { pullDocumentFromNotion } = await import("./notion-sync.js");

    // Simulate the multi-second Notion round-trip: by the time
    // readNotionPageAsDocument resolves, a concurrent local save has already
    // landed in the "documents" row.
    notionMocks.readNotionPageAsDocument.mockImplementation(async () => {
      testState.document = {
        ...testState.document,
        content: "Concurrent local edit",
        updatedAt: "2026-06-01T10:00:05.000Z",
      };
      return {
        pageId: "notion-page",
        title: "Local title",
        icon: null,
        content: "Remote edit from Notion",
        lastEditedTime: "2026-06-01T10:00:10.000Z",
        warnings: [],
      };
    });

    const status = await pullDocumentFromNotion(
      "alice@example.com",
      "doc-1",
      false,
    );

    // The concurrent local save must survive — never overwritten by the pull.
    expect(testState.document.content).toBe("Concurrent local edit");
    // The link must reflect a conflict, not a silent success.
    expect(testState.link?.state).toBe("conflict");
    expect(Boolean(status.hasConflict)).toBe(true);
    // The hash baseline must NOT be advanced to the remote content — otherwise
    // the lost edit would be undetectable as localChanged on the next check.
    expect(testState.link?.lastSyncedContentHash).toBe(
      hashContentForTest("Local body"),
    );
  });

  it("pulls and updates content cleanly when no concurrent write races it", async () => {
    const { pullDocumentFromNotion } = await import("./notion-sync.js");

    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Remote edit from Notion",
      lastEditedTime: "2026-06-01T10:00:10.000Z",
      warnings: [],
    });

    const status = await pullDocumentFromNotion(
      "alice@example.com",
      "doc-1",
      true,
    );

    expect(testState.document.content).toBe("Remote edit from Notion");
    expect(testState.link?.state).toBe("linked");
    expect(Boolean(testState.link?.hasConflict)).toBe(false);
    expect(testState.link?.lastSyncedContentHash).toBe(
      hashContentForTest("Remote edit from Notion"),
    );
    expect(status.hasConflict).toBe(false);
  });
});

describe("refreshDocumentSyncStatus", () => {
  beforeEach(() => {
    // refreshDocumentSyncStatus throttles via a module-level Map keyed by
    // documentId; reset modules so each test gets a fresh throttle map
    // instead of being short-circuited by a previous test's call.
    vi.resetModules();
    vi.clearAllMocks();
    testState.document = {
      id: "doc-1",
      ownerEmail: "alice@example.com",
      title: "Local title",
      content: "Local body",
      icon: null,
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    testState.link = {
      documentId: "doc-1",
      ownerEmail: "alice@example.com",
      remotePageId: "notion-page",
      state: "linked",
      lastSyncedAt: "2026-06-01T09:00:00.000Z",
      lastPulledRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastPushedLocalUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastKnownRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastSyncedContentHash: hashContentForTest("Local body"),
      hasConflict: false,
      warningsJson: "[]",
    };

    notionMocks.getNotionConnectionForOwner.mockResolvedValue({
      accessToken: "notion-token",
    });
  });

  it("does not pull (or mutate the document) when auto-sync is off, even if remote changed", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: false,
      },
    );

    expect(notionMocks.readNotionPageAsDocument).not.toHaveBeenCalled();
    expect(testState.document.content).toBe("Local body");
    expect(status.remoteChanged).toBe(true);
    expect(status.localChanged).toBe(false);
  });

  it("pulls when auto-sync is on and only the remote side changed", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Remote edit from Notion",
      lastEditedTime: "2026-06-01T10:30:00.000Z",
      warnings: [],
    });

    await refreshDocumentSyncStatus("alice@example.com", "doc-1", {
      autoSync: true,
    });

    expect(notionMocks.readNotionPageAsDocument).toHaveBeenCalled();
    expect(testState.document.content).toBe("Remote edit from Notion");
  });

  it("skips the pull instead of racing when another instance already holds the sync claim", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    // Simulate another tab/serverless instance already mid-sync for this
    // document: the claim column is set to "now".
    testState.link.syncClaimedAt = new Date().toISOString();

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: true,
      },
    );

    expect(notionMocks.readNotionPageAsDocument).not.toHaveBeenCalled();
    expect(testState.document.content).toBe("Local body");
    expect(status.remoteChanged).toBe(true);
  });

  it("does not flash a conflict while a save-triggered push holds the sync claim", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    // The local save has landed and its push owns the claim. Notion's remote
    // timestamp can advance before that push updates the stored hash baseline,
    // briefly making both sides look changed to a concurrent status poll.
    testState.document = {
      ...testState.document,
      content: "Local edit being pushed",
      updatedAt: "2026-06-01T10:00:05.000Z",
    };
    testState.link.syncClaimedAt = new Date().toISOString();
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: true,
      },
    );

    expect(status.localChanged).toBe(true);
    expect(status.remoteChanged).toBe(true);
    expect(status.hasConflict).toBe(false);
    expect(testState.link?.state).toBe("linked");
    expect(Boolean(testState.link?.hasConflict)).toBe(false);
  });

  it("rechecks change flags when the push finishes before the poll acquires the claim", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    testState.document = {
      ...testState.document,
      content: "Local edit that just finished pushing",
      updatedAt: "2026-06-01T10:00:05.000Z",
    };
    testState.link.syncClaimedAt = new Date().toISOString();
    notionMocks.fetchNotionPage.mockImplementation(async () => {
      // getDocumentSyncStatus already captured the old link snapshot. Finish
      // the competing push before refresh tries to claim, including advancing
      // the baseline and releasing its claim.
      testState.link = {
        ...testState.link,
        state: "linked",
        lastSyncedAt: "2026-06-01T10:30:00.000Z",
        lastPulledRemoteUpdatedAt: "2026-06-01T10:30:00.000Z",
        lastPushedLocalUpdatedAt: testState.document.updatedAt,
        lastKnownRemoteUpdatedAt: "2026-06-01T10:30:00.000Z",
        lastSyncedContentHash: hashContentForTest(testState.document.content),
        hasConflict: false,
        syncClaimedAt: null,
      };
      return {
        id: "notion-page",
        last_edited_time: "2026-06-01T10:30:00.000Z",
      };
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: true,
      },
    );

    expect(status.localChanged).toBe(false);
    expect(status.remoteChanged).toBe(false);
    expect(status.hasConflict).toBe(false);
    expect(testState.link?.state).toBe("linked");
    expect(testState.link?.syncClaimedAt).toBeNull();
  });

  it("hash-verifies a timestamp bump before auto-syncing instead of flashing a conflict", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    testState.document = {
      ...testState.document,
      content: "Local edit ready to push",
      updatedAt: "2026-06-01T10:00:05.000Z",
    };
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });
    // The newer timestamp is not a remote content edit: Notion still holds
    // the baseline body, so auto-sync should push the local edit.
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T10:30:00.000Z",
      warnings: [],
    });
    notionMocks.pushDocumentToNotionPage.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local edit ready to push",
      lastEditedTime: "2026-06-01T10:31:00.000Z",
      warnings: [],
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: true,
      },
    );

    expect(notionMocks.pushDocumentToNotionPage).toHaveBeenCalledTimes(1);
    expect(status.hasConflict).toBe(false);
    expect(status.localChanged).toBe(false);
    expect(status.remoteChanged).toBe(false);
    expect(testState.link?.state).toBe("linked");
  });

  it("reports hash-verified change flags without pushing when auto-sync is off", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    testState.document = {
      ...testState.document,
      content: "Local edit waiting for manual push",
      updatedAt: "2026-06-01T10:00:05.000Z",
    };
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T10:30:00.000Z",
      warnings: [],
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: false,
      },
    );

    expect(notionMocks.pushDocumentToNotionPage).not.toHaveBeenCalled();
    expect(status.hasConflict).toBe(false);
    expect(status.localChanged).toBe(true);
    expect(status.remoteChanged).toBe(false);
    expect(testState.link?.state).toBe("linked");
  });

  it("still persists a conflict when both content hashes genuinely changed", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    testState.document = {
      ...testState.document,
      content: "Independent local edit",
      updatedAt: "2026-06-01T10:00:05.000Z",
    };
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Independent remote edit",
      lastEditedTime: "2026-06-01T10:30:00.000Z",
      warnings: [],
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: true,
      },
    );

    expect(notionMocks.pushDocumentToNotionPage).not.toHaveBeenCalled();
    expect(status.hasConflict).toBe(true);
    expect(testState.link?.state).toBe("conflict");
    expect(Boolean(testState.link?.hasConflict)).toBe(true);
  });

  it("proceeds with the pull when a stale claim (older than the staleness window) is held", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    // A claim from over a minute ago — treated as abandoned (e.g. a crashed
    // request) rather than an active concurrent sync.
    testState.link.syncClaimedAt = new Date(Date.now() - 60_000).toISOString();

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Remote edit from Notion",
      lastEditedTime: "2026-06-01T10:30:00.000Z",
      warnings: [],
    });

    await refreshDocumentSyncStatus("alice@example.com", "doc-1", {
      autoSync: true,
    });

    expect(notionMocks.readNotionPageAsDocument).toHaveBeenCalled();
    expect(testState.document.content).toBe("Remote edit from Notion");
    // The claim must be released after the pull completes.
    expect(testState.link?.syncClaimedAt).toBeNull();
  });

  it("marks conflict instead of overwriting when a local save races the auto-pull", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockImplementation(async () => {
      testState.document = {
        ...testState.document,
        content: "Concurrent local edit",
        updatedAt: "2026-06-01T10:00:05.000Z",
      };
      return {
        pageId: "notion-page",
        title: "Local title",
        icon: null,
        content: "Remote edit from Notion",
        lastEditedTime: "2026-06-01T10:30:00.000Z",
        warnings: [],
      };
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: true,
      },
    );

    expect(testState.document.content).toBe("Concurrent local edit");
    expect(status.hasConflict).toBe(true);
  });
});

describe("pushDocumentToNotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.document = {
      id: "doc-1",
      ownerEmail: "alice@example.com",
      title: "Local title",
      content: "Local body",
      icon: null,
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    testState.link = {
      documentId: "doc-1",
      ownerEmail: "alice@example.com",
      remotePageId: "notion-page",
      state: "linked",
      lastSyncedAt: "2026-06-01T09:00:00.000Z",
      lastPulledRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastPushedLocalUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastKnownRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastSyncedContentHash: hashContentForTest("Local body"),
      hasConflict: false,
      warningsJson: "[]",
    };

    notionMocks.getNotionConnectionForOwner.mockResolvedValue({
      accessToken: "notion-token",
    });
  });

  it("surfaces a conflict instead of force-pushing when Notion changed within the same minute", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    testState.document.content = "Local edit typed just now";

    // Same last_edited_time as the last sync — the timestamp alone would say
    // "no remote change" even though the content differs.
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T09:00:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Teammate's same-minute Notion edit",
      lastEditedTime: "2026-06-01T09:00:00.000Z",
      warnings: [],
    });

    const status = await pushDocumentToNotion(
      "alice@example.com",
      "doc-1",
      false,
    );

    expect(notionMocks.pushDocumentToNotionPage).not.toHaveBeenCalled();
    expect(status.hasConflict).toBe(true);
    expect(testState.link?.state).toBe("conflict");
  });

  it("pushes normally when the remote hash still matches the baseline", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    testState.document.content = "Local edit typed just now";

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T09:00:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T09:00:00.000Z",
      warnings: [],
    });
    notionMocks.pushDocumentToNotionPage.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local edit typed just now",
      lastEditedTime: "2026-06-01T10:05:00.000Z",
      warnings: [],
    });

    const status = await pushDocumentToNotion(
      "alice@example.com",
      "doc-1",
      false,
    );

    expect(notionMocks.pushDocumentToNotionPage).toHaveBeenCalled();
    expect(status.hasConflict).toBe(false);
    expect(testState.document.content).toBe("Local edit typed just now");
  });

  it("does not overwrite a newer local save with post-push normalized content", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T09:00:00.000Z",
    });
    notionMocks.pushDocumentToNotionPage.mockImplementation(async () => {
      // A newer local save lands in between the PATCH and the readback.
      testState.document = {
        ...testState.document,
        content: "Newer local save mid-push",
        updatedAt: "2026-06-01T10:00:05.000Z",
      };
      return {
        pageId: "notion-page",
        title: "Local title",
        icon: null,
        content: "Normalized pre-push content",
        lastEditedTime: "2026-06-01T10:05:00.000Z",
        warnings: [],
      };
    });

    await pushDocumentToNotion("alice@example.com", "doc-1", true);

    // The concurrent save must survive; normalized old content must not land.
    expect(testState.document.content).toBe("Newer local save mid-push");
  });

  it("leaves localChanged false when Notion's post-push readback normalizes the content (n-C)", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    testState.document.content = "Local edit typed just now";

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T09:00:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T09:00:00.000Z",
      warnings: [],
    });
    // Notion normalizes the pushed markdown into something byte-different —
    // the row must adopt exactly this readback, and the baseline hash must
    // match it, not the pre-push document.content that was sent.
    notionMocks.pushDocumentToNotionPage.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local edit typed just now (normalized)",
      lastEditedTime: "2026-06-01T10:05:00.000Z",
      warnings: [],
    });

    const status = await pushDocumentToNotion(
      "alice@example.com",
      "doc-1",
      false,
    );

    expect(status.localChanged).toBe(false);
    expect(testState.document.content).toBe(
      "Local edit typed just now (normalized)",
    );
    expect(testState.link?.lastSyncedContentHash).toBe(
      hashContentForTest("Local edit typed just now (normalized)"),
    );
  });

  it("converges the baseline instead of flagging a phantom conflict when content already matches", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    // Local content has moved on from the stored baseline (e.g. a previous
    // push's title-PATCH step failed after replace_content already
    // succeeded), but Notion's content already matches the new local content
    // byte-for-byte — both sides agree even though the stored baseline
    // metadata is stale.
    testState.document.content = "Content already applied both sides";

    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T09:05:00.000Z",
    });
    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Content already applied both sides",
      lastEditedTime: "2026-06-01T09:05:00.000Z",
      warnings: [],
    });

    const status = await pushDocumentToNotion(
      "alice@example.com",
      "doc-1",
      false,
    );

    expect(notionMocks.pushDocumentToNotionPage).not.toHaveBeenCalled();
    expect(Boolean(status.hasConflict)).toBe(false);
    expect(testState.link?.state).toBe("linked");
    expect(testState.link?.lastSyncedContentHash).toBe(
      hashContentForTest("Content already applied both sides"),
    );
  });
});

describe("pullDocumentFromNotion / pushDocumentToNotion sync claim (n-B)", () => {
  beforeEach(() => {
    // refreshDocumentSyncStatus throttles via a module-level Map keyed by
    // documentId; reset modules so the last test's throttle timestamp for
    // "doc-1" doesn't short-circuit this describe's refresh test.
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    testState.document = {
      id: "doc-1",
      ownerEmail: "alice@example.com",
      title: "Local title",
      content: "Local body",
      icon: null,
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    testState.link = {
      documentId: "doc-1",
      ownerEmail: "alice@example.com",
      remotePageId: "notion-page",
      state: "linked",
      lastSyncedAt: "2026-06-01T09:00:00.000Z",
      lastPulledRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastPushedLocalUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastKnownRemoteUpdatedAt: "2026-06-01T09:00:00.000Z",
      lastSyncedContentHash: hashContentForTest("Local body"),
      hasConflict: false,
      warningsJson: "[]",
      syncClaimedAt: null as string | null,
    };

    notionMocks.getNotionConnectionForOwner.mockResolvedValue({
      accessToken: "notion-token",
    });
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T09:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a push while another instance holds the claim, without calling Notion (n-B)", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    // Another tab/instance is already mid-sync for this document.
    testState.link.syncClaimedAt = new Date().toISOString();
    testState.document.content = "A local edit typed just now";

    const promise = pushDocumentToNotion("alice@example.com", "doc-1", false);
    await vi.runAllTimersAsync();
    const status = await promise;

    // Never proceeded to touch Notion — the claim was held the whole time
    // (retries also see it held, since nothing here ever releases it).
    expect(notionMocks.pushDocumentToNotionPage).not.toHaveBeenCalled();
    // Reports the current non-mutating status rather than racing the holder.
    expect(status.documentId).toBe("doc-1");
    expect(testState.document.content).toBe("A local edit typed just now");
  });

  it("rejects a pull while another instance holds the claim, without calling Notion (n-B)", async () => {
    const { pullDocumentFromNotion } = await import("./notion-sync.js");

    testState.link.syncClaimedAt = new Date().toISOString();

    const promise = pullDocumentFromNotion("alice@example.com", "doc-1", true);
    await vi.runAllTimersAsync();
    const status = await promise;

    expect(notionMocks.readNotionPageAsDocument).not.toHaveBeenCalled();
    expect(status.documentId).toBe("doc-1");
    // The document row must be untouched.
    expect(testState.document.content).toBe("Local body");
  });

  it("succeeds once the claim frees up mid-retry", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    testState.link.syncClaimedAt = new Date().toISOString();
    notionMocks.pushDocumentToNotionPage.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T10:05:00.000Z",
      warnings: [],
    });

    const promise = pushDocumentToNotion("alice@example.com", "doc-1", false);
    // Free the claim before the retry window elapses, simulating the other
    // holder finishing mid-retry.
    testState.link.syncClaimedAt = null;
    await vi.runAllTimersAsync();
    const status = await promise;

    expect(notionMocks.pushDocumentToNotionPage).toHaveBeenCalled();
    expect(status.hasConflict).toBe(false);
  });

  it("releases the claim after a push error so a subsequent push is not permanently blocked", async () => {
    const { pushDocumentToNotion } = await import("./notion-sync.js");

    notionMocks.pushDocumentToNotionPage.mockRejectedValueOnce(
      new Error("Notion is down"),
    );

    await expect(
      pushDocumentToNotion("alice@example.com", "doc-1", false),
    ).rejects.toThrow("Notion is down");
    expect(testState.link?.syncClaimedAt).toBeNull();

    // A follow-up push must be able to claim and proceed normally.
    notionMocks.pushDocumentToNotionPage.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Local body",
      lastEditedTime: "2026-06-01T10:05:00.000Z",
      warnings: [],
    });
    const status = await pushDocumentToNotion(
      "alice@example.com",
      "doc-1",
      false,
    );
    expect(status.hasConflict).toBe(false);
  });

  it("releases the claim after a pull error so a subsequent pull is not permanently blocked", async () => {
    const { pullDocumentFromNotion } = await import("./notion-sync.js");

    notionMocks.readNotionPageAsDocument.mockRejectedValueOnce(
      new Error("Notion is down"),
    );

    await expect(
      pullDocumentFromNotion("alice@example.com", "doc-1", true),
    ).rejects.toThrow("Notion is down");
    expect(testState.link?.syncClaimedAt).toBeNull();

    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Remote edit from Notion",
      lastEditedTime: "2026-06-01T10:00:10.000Z",
      warnings: [],
    });
    const status = await pullDocumentFromNotion(
      "alice@example.com",
      "doc-1",
      true,
    );
    expect(status.hasConflict).toBe(false);
    expect(testState.document.content).toBe("Remote edit from Notion");
  });

  it("refreshDocumentSyncStatus's auto-pull does not double-claim or double-release", async () => {
    const { refreshDocumentSyncStatus } = await import("./notion-sync.js");

    notionMocks.readNotionPageAsDocument.mockResolvedValue({
      pageId: "notion-page",
      title: "Local title",
      icon: null,
      content: "Remote edit from Notion",
      lastEditedTime: "2026-06-01T10:30:00.000Z",
      warnings: [],
    });
    notionMocks.fetchNotionPage.mockResolvedValue({
      id: "notion-page",
      last_edited_time: "2026-06-01T10:30:00.000Z",
    });

    const status = await refreshDocumentSyncStatus(
      "alice@example.com",
      "doc-1",
      {
        autoSync: true,
      },
    );

    expect(testState.document.content).toBe("Remote edit from Notion");
    // The claim taken by refreshDocumentSyncStatus itself must be released
    // exactly once — not left set (double-claim without matching release)
    // nor released twice (which would be a harmless no-op here, but the
    // absence of an error/hang confirms skipClaim prevented a second
    // claim attempt inside pullDocumentFromNotion from ever running).
    expect(testState.link?.syncClaimedAt).toBeNull();
    expect(status.hasConflict).toBe(false);
  });
});

describe("resolveDocumentSyncConflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws instead of defaulting an invalid direction to a force-push", async () => {
    const { resolveDocumentSyncConflict } = await import("./notion-sync.js");

    await expect(
      resolveDocumentSyncConflict(
        "alice@example.com",
        "doc-1",
        undefined as unknown as "pull",
      ),
    ).rejects.toThrow(/pull.*push/i);
    expect(notionMocks.pushDocumentToNotionPage).not.toHaveBeenCalled();
  });
});
