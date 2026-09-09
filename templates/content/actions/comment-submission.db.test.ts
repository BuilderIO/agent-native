import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dbPath = join(
  tmpdir(),
  `comment-submission-${process.pid}-${Date.now()}.pglite`,
);
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: vi.fn(async () => ({
    resource: {
      ownerEmail: "owner@example.test",
      title: "Fixture",
      orgId: null,
    },
  })),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestRunContext: () => ({ caller: "mcp" }),
  getRequestUserEmail: () => "author@example.test",
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "author@example.test",
  }),
);
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => false),
}));

let db: ReturnType<typeof import("../server/db/index.js").getDb>;
let schema: typeof import("../server/db/schema.js");
let add: typeof import("./add-comment.js").default;
let update: typeof import("./update-comment.js").default;
let remove: typeof import("./delete-comment.js").default;
beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${dbPath}`;
  const module = await import("../server/db/index.js");
  schema = module.schema;
  db = module.getDb();
  await (await import("../server/plugins/db.js")).default(undefined as any);
  add = (await import("./add-comment.js")).default;
  update = (await import("./update-comment.js")).default;
  remove = (await import("./delete-comment.js")).default;
  await db.insert(schema.documents).values({
    id: "receipt-fixture",
    ownerEmail: "owner@example.test",
    title: "Comment fixture",
  });
}, 60000);
afterAll(() => rmSync(dbPath, { force: true, recursive: true }));
const create = (args: Record<string, unknown>) =>
  (add as any).run({
    documentId: "receipt-fixture",
    content: "Same text",
    ...args,
  });
const resolve = (id: string) =>
  (update as any).run({ id, documentId: "receipt-fixture", resolved: true });

describe("comment receipts and thread state on PostgreSQL-compatible storage", () => {
  it.each(["add", "reply", "edit", "resolve", "reopen", "delete"])(
    "rejects %s when Trash commits after access check and before the mutation transaction",
    async (operation) => {
      const documentId = `trash-comment-${operation}`;
      await db.insert(schema.documents).values({
        id: documentId,
        ownerEmail: "owner@example.test",
        title: "Comment lifecycle fixture",
      });
      const root = await create({ documentId });
      if (operation === "reopen") {
        await (update as any).run({ id: root.id, resolved: true });
      }
      const before = await db
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.documentId, documentId));
      const { assertAccess } = await import("@agent-native/core/sharing");
      vi.mocked(assertAccess).mockImplementationOnce(async () => {
        await db
          .update(schema.documents)
          .set({
            trashedAt: new Date().toISOString(),
            trashRootId: documentId,
          })
          .where(eq(schema.documents.id, documentId));
        return {
          resource: {
            ownerEmail: "owner@example.test",
            title: "Fixture",
            orgId: null,
          },
        } as Awaited<ReturnType<typeof assertAccess>>;
      });
      const attempt =
        operation === "add"
          ? create({ documentId, content: "Rejected new comment" })
          : operation === "reply"
            ? create({ documentId, threadId: root.id, parentId: root.id })
            : operation === "delete"
              ? (remove as any).run({ id: root.id, documentId })
              : (update as any).run({
                  id: root.id,
                  documentId,
                  ...(operation === "edit"
                    ? { content: "Rejected edit" }
                    : { resolved: operation === "resolve" }),
                });
      await expect(attempt).rejects.toMatchObject({
        errorCode: "DOCUMENT_TRASHED",
        statusCode: 409,
      });
      expect(
        await db
          .select()
          .from(schema.documentComments)
          .where(eq(schema.documentComments.documentId, documentId)),
      ).toEqual(before);
    },
  );

  it("deduplicates overlapping UUID submissions in the database", async () => {
    const clientOperationId = crypto.randomUUID();
    const results = await Promise.all([
      create({ clientOperationId }),
      create({ clientOperationId }),
    ]);
    expect(results.map((result) => result.id)).toEqual([
      clientOperationId,
      clientOperationId,
    ]);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.id, clientOperationId)),
    ).toHaveLength(1);
  });
  it("preserves a receipt across post-insert notification failure", async () => {
    const { notifyDocumentComment } =
      await import("../server/lib/comment-notifications.js");
    vi.mocked(notifyDocumentComment).mockRejectedValueOnce(
      new Error("Notification unavailable"),
    );
    const clientOperationId = crypto.randomUUID();
    await expect(create({ clientOperationId })).rejects.toThrow(
      "Notification unavailable",
    );
    expect(await create({ clientOperationId })).toMatchObject({
      id: clientOperationId,
      replayed: true,
      notified: null,
    });
  });
  it.each([false, true])(
    "keeps replies consistent when resolution and insertion overlap (resolve first: %s)",
    async (resolveFirst) => {
      const root = await create({ clientOperationId: crypto.randomUUID() });
      const reply = () =>
        create({
          clientOperationId: crypto.randomUUID(),
          threadId: root.id,
          parentId: root.id,
        });
      // PGlite serializes transactions; this proves both action orderings, not cross-connection lock contention.
      const results = await Promise.allSettled(
        resolveFirst
          ? [resolve(root.id), reply()]
          : [reply(), resolve(root.id)],
      );
      expect(results.some((result) => result.status === "fulfilled")).toBe(
        true,
      );
      const rows = await db
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.threadId, root.id));
      expect(rows.every((row) => row.resolved === 1)).toBe(true);
      await expect(reply()).rejects.toThrow("Reopen the thread");
    },
  );
});
