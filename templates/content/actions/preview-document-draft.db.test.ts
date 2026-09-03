import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `preview-drafts-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let getDraft: typeof import("./get-preview-document-draft.js").default;
let updateDraft: typeof import("./update-preview-document-draft.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDraft = (await import("./get-preview-document-draft.js")).default;
  updateDraft = (await import("./update-preview-document-draft.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

let counter = 0;
async function createDocument() {
  const id = `draft_doc_${++counter}`;
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    title: "Builder row",
    content: "Server body",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `share_${counter}`,
      resourceId: id,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: now,
    });
  return id;
}

const payload = (content: string) => ({
  title: "Builder row",
  content,
  baseDocumentUpdatedAt: "server-v1",
  loadedContentWasEmpty: false,
  deferredReason: "hydration" as const,
});

function asUser<T>(userEmail: string, fn: () => Promise<T>, orgId?: string) {
  return runWithRequestContext({ userEmail, orgId }, fn);
}

describe("private preview document drafts", () => {
  it("runs the additive migration and projects only the caller's draft fields", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("owner draft"),
      }),
    );
    const result = await asUser(OWNER, () => getDraft.run({ documentId }));
    expect(result.draft).toMatchObject({
      documentId,
      content: "owner draft",
      version: 1,
    });
    expect(result.draft).not.toHaveProperty("ownerEmail");
    expect(result.draft).not.toHaveProperty("id");
  });

  it("keeps collaborator drafts private per request user", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("owner draft"),
      }),
    );
    await asUser(COLLABORATOR, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("collaborator draft"),
      }),
    );
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft?.content,
    ).toBe("owner draft");
    expect(
      (await asUser(COLLABORATOR, () => getDraft.run({ documentId }))).draft
        ?.content,
    ).toBe("collaborator draft");
  });

  it("keeps drafts isolated when a document moves between organizations", async () => {
    const documentId = await createDocument();
    await getDb()
      .update(schema.documents)
      .set({ orgId: "org-a" })
      .where(eq(schema.documents.id, documentId));
    await asUser(
      OWNER,
      () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: payload("org A draft"),
        }),
      "org-a",
    );
    await getDb()
      .update(schema.documents)
      .set({ orgId: "org-b" })
      .where(eq(schema.documents.id, documentId));

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }), "org-b")).draft,
    ).toBeNull();
    await asUser(
      OWNER,
      () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: payload("org B draft"),
        }),
      "org-b",
    );
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }), "org-b")).draft
        ?.content,
    ).toBe("org B draft");
  });

  it("fails closed after editor access is revoked", async () => {
    const documentId = await createDocument();
    await getDb()
      .delete(schema.documentShares)
      .where(
        and(
          eq(schema.documentShares.resourceId, documentId),
          eq(schema.documentShares.principalId, COLLABORATOR),
        ),
      );
    await expect(
      asUser(COLLABORATOR, () => getDraft.run({ documentId })),
    ).rejects.toThrow();
  });

  it("returns the current draft when two tabs race to create or update", async () => {
    const documentId = await createDocument();
    const first = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("tab A"),
      }),
    );
    const createRace = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("tab B"),
      }),
    );
    expect(first.status).toBe("saved");
    expect(createRace).toMatchObject({
      status: "conflict",
      draft: { content: "tab A", version: 1 },
    });

    const updated = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("tab A v2"),
      }),
    );
    expect(updated).toMatchObject({ status: "saved", draft: { version: 2 } });
    const stale = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("stale tab B"),
      }),
    );
    expect(stale).toMatchObject({
      status: "conflict",
      draft: { content: "tab A v2", version: 2 },
    });
  });

  it("does not let a stale delete erase a newer draft", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("v1"),
      }),
    );
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("v2"),
      }),
    );
    const staleDelete = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 1,
        expectedTitle: "Builder row",
        expectedContent: "v1",
      }),
    );
    expect(staleDelete).toMatchObject({
      status: "conflict",
      draft: { content: "v2", version: 2 },
    });
    const deleted = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "v2",
      }),
    );
    expect(deleted).toEqual({ status: "deleted", draft: null });
  });

  it("keeps C2 recoverable when older C1 persistence finishes after the C2 draft", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("C1"),
      }),
    );
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("C2"),
      }),
    );

    const c1CompletionCleanup = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "C1",
      }),
    );

    expect(c1CompletionCleanup).toMatchObject({
      status: "conflict",
      draft: { content: "C2", version: 2 },
    });
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ content: "C2", version: 2 });

    const c2CompletionCleanup = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "C2",
      }),
    );
    expect(c2CompletionCleanup).toEqual({ status: "deleted", draft: null });
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });
});
