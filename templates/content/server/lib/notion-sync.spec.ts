import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

const notionMocks = vi.hoisted(() => ({
  createNotionPageWithMarkdown: vi.fn(),
  fetchNotionPage: vi.fn(),
  getNotionConnectionForOwner: vi.fn(),
  normalizeNotionPageId: vi.fn((input: string) => input),
  notionFetch: vi.fn(),
  readNotionPageAsDocument: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn(),
    eq: vi.fn(),
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
    },
    documentSyncLinks: {
      documentId: "documentSyncLinks.documentId",
      ownerEmail: "documentSyncLinks.ownerEmail",
    },
  };

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.documents) return [testState.document];
          if (table === schema.documentSyncLinks) {
            return testState.link ? [testState.link] : [];
          }
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
        where: async () => {
          if (table === schema.documents) {
            testState.document = { ...testState.document, ...updates };
          }
        },
      }),
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
});
