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

  it("validates amendments against transactional canonical state without writing it", async () => {
    const tx = {
      execute: vi.fn(async (query: { sql: string }) => {
        expect(query.sql).toMatch(/^SELECT/);
        if (query.sql.startsWith("SELECT content,")) {
          return { rows: [{ content: "Before", updated_at: "rev-1" }] };
        }
        return { rows: [] };
      }),
    };
    await expect(
      contentDocumentSuggestionAdapter.validateProposal({
        resourceType: "document",
        resourceId: "doc-1",
        baseRevision: "rev-1",
        operations: [operation],
        ctx: {
          transaction: tx,
          suggestionAccess: {
            ...access,
            resource: {
              ...access.resource,
              content: "stale cache",
              updatedAt: "old",
            },
          },
        },
      }),
    ).resolves.toEqual([operation]);
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(exclusions).not.toHaveBeenCalled();
  });

  it("rejects amendments when transactional canonical state moved", async () => {
    const tx = {
      execute: vi.fn(async () => ({
        rows: [{ content: "Changed", updated_at: "rev-2" }],
      })),
    };
    await expect(
      contentDocumentSuggestionAdapter.validateProposal({
        resourceType: "document",
        resourceId: "doc-1",
        baseRevision: "rev-1",
        operations: [operation],
        ctx: { transaction: tx, suggestionAccess: access },
      }),
    ).rejects.toMatchObject({
      errorCode: "suggestion_conflict",
      statusCode: 409,
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
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
        revision: 1,
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
          revision: 1,
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
  function change(before: string, from: number, to: number, inserted: string) {
    return {
      ...operation,
      before: { markdown: before, changedText: before.slice(from, to) },
      after: {
        markdown: before.slice(0, from) + inserted + before.slice(to),
        changedText: inserted,
      },
      anchor: {
        from,
        to,
        prefix: before.slice(Math.max(0, from - 32), from),
        suffix: before.slice(to, to + 32),
      },
    };
  }

  const contextualOperation = {
    ...operation,
    before: { markdown: "Alpha old Omega", changedText: "old" },
    after: { markdown: "Alpha new Omega", changedText: "new" },
    anchor: { from: 6, to: 9, prefix: "Alpha ", suffix: " Omega" },
  };

  it.each([false, true])(
    "retains exact saved proposals after surrounding acceptances, reverse=%s",
    (reverse) => {
      const saved =
        "This reads better compared to the original.\nEditors publish carefully.\nFinal sentence.";
      const surrounding = change(
        saved,
        0,
        71,
        "This reads more clearly than the original.\u00a0Indeed.\nEditors publish carefully.\nAlso:\u00a0",
      );
      const addition = change(
        saved,
        86,
        86,
        "\u00a0Added words\u00a0revised\u00a0finally.",
      );
      let current = saved;
      for (const edit of reverse
        ? [addition, surrounding]
        : [surrounding, addition]) {
        const result = applyMarkdownSuggestionOperation(current, edit);
        expect(result).not.toBeNull();
        current = result!;
      }
      expect(current).toBe(
        "This reads more clearly than the original.\u00a0Indeed.\nEditors publish carefully.\nAlso:\u00a0Final sentence.\u00a0Added words\u00a0revised\u00a0finally.",
      );
      expect(
        applyMarkdownSuggestionOperation(
          current,
          change(saved, 52, 59, "review"),
        ),
      ).toBe(current.replace("publish", "review"));
      expect(
        applyMarkdownSuggestionOperation(
          current,
          change(saved, 44, 44, "Review note.\u00a0"),
        ),
      ).toBe(current.replace("Editors", "Review note.\u00a0Editors"));
      const remaining = [
        change(saved, 52, 59, "review"),
        change(saved, 44, 44, "Review note.\u00a0"),
      ];
      for (const edit of reverse ? remaining.reverse() : remaining) {
        const result = applyMarkdownSuggestionOperation(current, edit);
        expect(result).not.toBeNull();
        current = result!;
      }
      expect(current).toBe(
        "This reads more clearly than the original.\u00a0Indeed.\nReview note.\u00a0Editors review carefully.\nAlso:\u00a0Final sentence.\u00a0Added words\u00a0revised\u00a0finally.",
      );
    },
  );

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

  it.each([false, true])(
    "accepts neighboring independent edits in either order (reverse: %s)",
    (reverse) => {
      const before =
        "Alpha Beta Gamma. Added words.\nThe team will publish on Monday.\nThird paragraph stays unchanged.";
      const first = change(before, 0, 5, "First");
      const end = before.indexOf("\n");
      const next = change(before, end, end, " Next.");
      const ordered = reverse ? [next, first] : [first, next];
      const intermediate = applyMarkdownSuggestionOperation(
        before,
        ordered[0]!,
      );
      expect(intermediate).not.toBeNull();
      expect(applyMarkdownSuggestionOperation(intermediate!, ordered[1]!)).toBe(
        before.replace("Alpha", "First").replace("words.", "words. Next."),
      );
    },
  );

  it.each(["A", "A much longer opening"])(
    "maps replacement and insertion offsets after a length shift: %s",
    (opening) => {
      const before = "Alpha Beta Gamma. Final line.";
      const current = before.replace("Alpha", opening);
      expect(
        applyMarkdownSuggestionOperation(
          current,
          change(before, 6, 10, "Second"),
        ),
      ).toBe(`${opening} Second Gamma. Final line.`);
      expect(
        applyMarkdownSuggestionOperation(
          current,
          change(before, 17, 17, " Next."),
        ),
      ).toBe(`${opening} Beta Gamma. Next. Final line.`);
    },
  );

  it("preserves newer text on both sides when an exact context still matches", () => {
    const before = "Alpha old Omega";
    expect(
      applyMarkdownSuggestionOperation(
        `Intro\n${before}\nOutro`,
        change(before, 6, 9, "new"),
      ),
    ).toBe("Intro\nAlpha new Omega\nOutro");
  });

  it("refuses changed targets, intersecting edits, and competing insertions", () => {
    const before = "Alpha Beta Gamma.";
    expect(
      applyMarkdownSuggestionOperation(
        "Alpha Better Gamma.",
        change(before, 6, 10, "Second"),
      ),
    ).toBeNull();
    expect(
      applyMarkdownSuggestionOperation(
        "Alpha Better Gamma.",
        change(before, 8, 12, "replacement"),
      ),
    ).toBeNull();
    expect(
      applyMarkdownSuggestionOperation(
        "Alpha New Beta Gamma.",
        change(before, 6, 6, "Other "),
      ),
    ).toBeNull();
  });

  it("refuses ambiguous repeated text when the canonical deletion can slide", () => {
    const before = "xabababZ";
    for (const from of [1, 3, 5]) {
      expect(
        applyMarkdownSuggestionOperation(
          "xababZ",
          change(before, from, from + 2, "new"),
        ),
      ).toBeNull();
    }
  });

  it("keeps changes surrounding an unmatched target as an explicit conflict", () => {
    const before = "Alpha Beta Gamma.";
    expect(
      applyMarkdownSuggestionOperation(
        "First Beta Last.",
        change(before, 6, 10, "Second"),
      ),
    ).toBeNull();
  });

  it("rejects a payload whose changed text and anchor do not describe its snapshot", () => {
    const malformed = change("Alpha Beta Gamma.", 6, 10, "Second");
    malformed.anchor.from = 0;
    expect(
      applyMarkdownSuggestionOperation("First Beta Gamma.", malformed),
    ).toBeNull();
  });
});
