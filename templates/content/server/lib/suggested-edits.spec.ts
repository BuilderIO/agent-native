import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const exclusions = vi.fn(async () => ({ rows: [] }));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: vi.fn(async () => true),
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: exclusions }),
}));

const {
  applyMarkdownSuggestionOperation,
  contentDocumentSuggestionAdapter,
  publishPersistedAcceptedSuggestion,
} = await import("./suggested-edits");

const operation = {
  ordinal: 0,
  kind: "replace_text",
  targetId: "body",
  before: { markdown: "Before" },
  after: { markdown: "After" },
  anchor: { prefix: "", suffix: "" },
  schemaVersion: 1,
};

const access = {
  role: "commenter" as const,
  resource: {
    id: "doc-1",
    content: "Before",
    updatedAt: "rev-1",
    trashedAt: null,
    sourceMode: null,
    sourceKind: null,
    sourcePath: null,
  },
};

function decisionCoordination() {
  const persistSync = vi.fn(async () => ({
    source: "action",
    type: "change",
    version: 1,
  }));
  return {
    ydoc: {
      doc: new Y.Doc(),
      baseVersion: null,
      persist: vi.fn(async () => {}),
    },
    sync: {
      persist: persistSync,
      isPersisted: () => persistSync.mock.calls.length > 0,
      publish: vi.fn(),
    },
  };
}

describe("Content document suggestion adapter", () => {
  beforeEach(() => exclusions.mockClear());

  it("validates a proposal without mutating canonical content", async () => {
    await expect(
      contentDocumentSuggestionAdapter.validateProposal({
        resourceType: "document",
        resourceId: "doc-1",
        baseRevision: "rev-1",
        operations: [operation],
        ctx: { suggestionAccess: access },
      }),
    ).resolves.toEqual([operation]);
    expect(exclusions).toHaveBeenCalledOnce();
  });

  it("rejects inline-database pages before creating a pending suggestion", async () => {
    const markdown = 'Before\n\n<InlineDatabase id="db-1" />';
    await expect(
      contentDocumentSuggestionAdapter.validateProposal({
        resourceType: "document",
        resourceId: "doc-1",
        baseRevision: "rev-1",
        operations: [
          {
            ...operation,
            before: { markdown },
            after: { markdown: markdown.replace("Before", "After") },
          },
        ],
        ctx: {
          suggestionAccess: {
            ...access,
            resource: { ...access.resource, content: markdown },
          },
        },
      }),
    ).rejects.toThrow("inline databases cannot receive suggestions yet");
  });

  it("does not publish a duplicate accepted retry without a persisted event", () => {
    const sync = decisionCoordination().sync;
    publishPersistedAcceptedSuggestion(sync, {
      decision: { outcome: "accepted" },
    });
    expect(sync.publish).not.toHaveBeenCalled();
  });

  it("snapshots and applies with an exact compare-and-swap", async () => {
    const writes: string[] = [];
    const tx = {
      execute: vi.fn(async (query: string | { sql: string }) => {
        const sql = typeof query === "string" ? query : query.sql;
        writes.push(sql);
        if (sql.startsWith("SELECT id,title")) {
          return {
            rows: [
              {
                id: "doc-1",
                title: "Page",
                content: "Before",
                owner_email: "owner@example.com",
                updated_at: "rev-1",
                source_mode: null,
                source_kind: null,
                source_path: null,
                trashed_at: null,
              },
            ],
          };
        }
        if (sql.startsWith("SELECT id FROM content_database_items")) {
          return { rows: [] };
        }
        return { rows: [], rowsAffected: 1 };
      }),
    };
    const coordination = decisionCoordination();
    await contentDocumentSuggestionAdapter.apply({
      resourceType: "document",
      resourceId: "doc-1",
      suggestion: {
        id: "suggestion-1",
        resourceType: "document",
        resourceId: "doc-1",
        adapterKind: contentDocumentSuggestionAdapter.kind,
        adapterVersion: 1,
        threadId: "thread-1",
        authorEmail: "commenter@example.com",
        actorKind: "human",
        baseRevision: "rev-1",
        status: "pending",
        summary: "Suggest edits",
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "private",
        createdAt: "now",
        updatedAt: "now",
        metadata: null,
        operations: [operation],
      },
      operations: [operation],
      access,
      ctx: {},
      transaction: tx,
      coordination,
    });
    expect(
      writes.some((sql) => sql.startsWith("INSERT INTO document_versions")),
    ).toBe(true);
    expect(
      writes.some((sql) => sql.startsWith("UPDATE documents SET content")),
    ).toBe(true);
    expect(coordination.ydoc.persist).toHaveBeenCalledWith(tx, "After");
    expect(coordination.sync.persist).toHaveBeenCalledWith(tx);
    expect(
      yDocToProsemirrorJSON(coordination.ydoc.doc, "default"),
    ).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "After" }],
        },
      ],
    });
  });

  it("reports an honest stale outcome before writing a version", async () => {
    const tx = {
      execute: vi.fn(async (query: string | { sql: string }) => {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.startsWith("SELECT id,title")) {
          return {
            rows: [
              {
                id: "doc-1",
                title: "Page",
                content: "Newer",
                owner_email: "owner@example.com",
                updated_at: "rev-2",
              },
            ],
          };
        }
        return { rows: [], rowsAffected: 0 };
      }),
    };
    const coordination = decisionCoordination();
    await expect(
      contentDocumentSuggestionAdapter.apply({
        resourceType: "document",
        resourceId: "doc-1",
        suggestion: {
          id: "suggestion-1",
          resourceType: "document",
          resourceId: "doc-1",
          adapterKind: contentDocumentSuggestionAdapter.kind,
          adapterVersion: 1,
          threadId: "thread-1",
          authorEmail: null,
          actorKind: "agent",
          baseRevision: "rev-1",
          status: "pending",
          summary: "Suggest edits",
          ownerEmail: null,
          orgId: null,
          visibility: "private",
          createdAt: "now",
          updatedAt: "now",
          metadata: null,
          operations: [operation],
        },
        operations: [operation],
        access,
        ctx: {},
        transaction: tx,
        coordination,
      }),
    ).rejects.toMatchObject({ name: "SuggestionStaleError" });
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });
});

describe("applyMarkdownSuggestionOperation", () => {
  const contextualOperation = {
    ...operation,
    before: { markdown: "Alpha old Omega", changedText: "old" },
    after: { markdown: "Alpha new Omega", changedText: "new" },
    anchor: { from: 6, to: 9, prefix: "Alpha ", suffix: " Omega" },
  };

  it("applies an independent edit after unrelated canonical changes", () => {
    expect(
      applyMarkdownSuggestionOperation(
        "Intro\nAlpha old Omega\nOutro",
        contextualOperation,
      ),
    ).toBe("Intro\nAlpha new Omega\nOutro");
  });

  it("refuses an ambiguous or changed anchor", () => {
    expect(
      applyMarkdownSuggestionOperation(
        "Alpha old Omega and Alpha old Omega",
        contextualOperation,
      ),
    ).toBeNull();
    expect(
      applyMarkdownSuggestionOperation(
        "Alpha changed Omega",
        contextualOperation,
      ),
    ).toBeNull();
  });
});
