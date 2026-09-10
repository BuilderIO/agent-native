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
beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${dbPath}`;
  const module = await import("../server/db/index.js");
  schema = module.schema;
  db = module.getDb();
  await (await import("../server/plugins/db.js")).default(undefined as any);
  add = (await import("./add-comment.js")).default;
  update = (await import("./update-comment.js")).default;
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
