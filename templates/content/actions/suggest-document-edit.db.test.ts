import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-suggest-document-edit-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");
type SuggestAction = typeof import("./suggest-document-edit.js").default;
type CreateDocumentAction = typeof import("./create-document.js").default;
type GetDocumentAction = typeof import("./get-document.js").default;
type ListSuggestionsAction =
  typeof import("@agent-native/core/review/suggestions/actions/list-resource-suggestions").default;
type UpdateDocumentAction = typeof import("./update-document.js").default;

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let suggestDocumentEdit: SuggestAction;
let createDocument: CreateDocumentAction;
let getDocument: GetDocumentAction;
let listResourceSuggestions: ListSuggestionsAction;
let updateDocument: UpdateDocumentAction;

const ctx = {
  caller: "cli" as const,
  userEmail: "owner@example.com",
};

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await (
    await import("../server/plugins/suggested-edits.js")
  ).default(undefined as never);
  suggestDocumentEdit = (await import("./suggest-document-edit.js")).default;
  createDocument = (await import("./create-document.js")).default;
  getDocument = (await import("./get-document.js")).default;
  listResourceSuggestions = (
    await import("@agent-native/core/review/suggestions/actions/list-resource-suggestions")
  ).default;
  updateDocument = (await import("./update-document.js")).default;
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let sequence = 0;

async function createPage(content: string) {
  return runWithRequestContext(
    { userEmail: ctx.userEmail, orgId: null },
    async () => {
      sequence += 1;
      const result = (await createDocument.run(
        {
          title: `Suggest edit page ${sequence}`,
          content,
        },
        ctx,
      )) as { id: string };
      const doc = (await getDocument.run({ id: result.id }, ctx)) as {
        revision: string;
      };
      return { id: result.id as string, revision: doc.revision };
    },
  );
}

describe("suggest-document-edit", () => {
  it("creates a pending suggestion and leaves the page unchanged", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Hello suggestion probe.");
        const result = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `se-${id}-1`,
            find: "Hello suggestion probe.",
            replace: "Hello, suggestion probe.",
          },
          ctx,
        )) as { suggestionId: string; status: string; url: string };

        expect(result.status).toBe("pending");
        expect(result.url).toContain(id);

        const after = (await getDocument.run({ id }, ctx)) as {
          content: string;
          revision: string;
        };
        expect(after.content).toBe("Hello suggestion probe.");
        expect(after.revision).toBe(revision);

        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as { suggestions: Array<{ id: string; status: string }> };
        expect(listed.suggestions.map((s) => s.id)).toContain(
          result.suggestionId,
        );
      },
    );
  });

  it("replays the same idempotency key instead of duplicating", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Repeatable body text.");
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `replay-${id}`,
          find: "Repeatable body text.",
          replace: "Replaced body text.",
        };
        const first = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
        };
        const second = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
        };
        expect(second.suggestionId).toBe(first.suggestionId);
      },
    );
  });

  it("replays the same logical edit after the document changed", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Original body line.");
        const args = {
          id,
          baseRevision: revision,
          idempotencyKey: `moved-${id}`,
          find: "Original body line.",
          replace: "Edited body line.",
        };
        const first = (await suggestDocumentEdit.run(args, ctx)) as {
          suggestionId: string;
        };
        await updateDocument.run(
          { id, content: "The page changed underneath the proposal." },
          ctx,
        );
        const retry = (await suggestDocumentEdit.run(
          {
            ...args,
            baseRevision:
              "body:0:sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
          ctx,
        )) as { suggestionId: string };
        expect(retry.suggestionId).toBe(first.suggestionId);
      },
    );
  });

  it("rejects key reuse for a different edit", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Two possible edits here.");
        await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `reuse-${id}`,
            find: "Two possible edits",
            replace: "One settled edit",
          },
          ctx,
        );
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `reuse-${id}`,
              find: "possible edits here",
              replace: "different edit there",
            },
            ctx,
          ),
        ).rejects.toThrow(
          /already created suggestion .* with a different edit/,
        );
      },
    );
  });

  it("rejects key reuse across documents", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const first = await createPage("Identical body text.");
        const second = await createPage("Identical body text.");
        await suggestDocumentEdit.run(
          {
            id: first.id,
            baseRevision: first.revision,
            idempotencyKey: `cross-doc-${first.id}`,
            find: "Identical body text.",
            replace: "Edited body text.",
          },
          ctx,
        );
        await expect(
          suggestDocumentEdit.run(
            {
              id: second.id,
              baseRevision: second.revision,
              idempotencyKey: `cross-doc-${first.id}`,
              find: "Identical body text.",
              replace: "Edited body text.",
            },
            ctx,
          ),
        ).rejects.toThrow(
          /already created suggestion .* with a different edit/,
        );
      },
    );
  });

  it("records external agent attribution for mcp callers", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Attribution body text.");
        const result = (await suggestDocumentEdit.run(
          {
            id,
            baseRevision: revision,
            idempotencyKey: `attr-${id}`,
            find: "Attribution body text.",
            replace: "Edited body text.",
          },
          { caller: "mcp" as const, userEmail: ctx.userEmail },
        )) as { suggestionId: string };
        const listed = (await listResourceSuggestions.run(
          { resourceType: "document", resourceId: id },
          ctx,
        )) as { suggestions: Array<{ id: string; actorKind: string }> };
        const recorded = listed.suggestions.find(
          (item) => item.id === result.suggestionId,
        );
        expect(recorded?.actorKind).toBe("agent");
      },
    );
  });

  it("reports a missing find with the fix in the message", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id, revision } = await createPage("Unique body text.");
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `missing-${id}`,
              find: "Text that is not on the page.",
              replace: "x",
            },
            ctx,
          ),
        ).rejects.toThrow(/does not appear on the page/);
      },
    );
  });

  it("rejects an ambiguous find", async () => {
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        const { id } = await createPage(
          "Same text.\n\nSame text.\n\nSame text.",
        );
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: "body:0:x",
              idempotencyKey: `ambiguous-${id}`,
              find: "Same text.",
              replace: "y",
            },
            ctx,
          ),
        ).rejects.toThrow(/appears 3 times/);
      },
    );
  });

  it("requires baseRevision and idempotencyKey from external callers", async () => {
    const { id } = await createPage("Protocol body.");
    await expect(
      suggestDocumentEdit.run(
        { id, find: "Protocol body.", replace: "x" },
        { caller: "mcp" as const, userEmail: ctx.userEmail },
      ),
    ).rejects.toThrow(/baseRevision and idempotencyKey/);
  });

  it("rejects pages that cannot receive suggestions", async () => {
    const { id, revision } = await createPage("Database item body.");
    const db = getDb();
    const now = new Date().toISOString();
    const databaseId = `suggest-edit-db-${sequence}`;
    await db.insert(schema.contentDatabases).values({
      id: databaseId,
      ownerEmail: ctx.userEmail,
      documentId: `suggest-edit-db-doc-${sequence}`,
      title: "Test database",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `suggest-edit-item-${sequence}`,
      ownerEmail: ctx.userEmail,
      databaseId,
      documentId: id,
      createdAt: now,
      updatedAt: now,
    });
    await runWithRequestContext(
      { userEmail: ctx.userEmail, orgId: null },
      async () => {
        await expect(
          suggestDocumentEdit.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: `db-${id}`,
              find: "Database item body.",
              replace: "x",
            },
            ctx,
          ),
        ).rejects.toThrow(/cannot receive suggestions/i);
      },
    );
  });
});
