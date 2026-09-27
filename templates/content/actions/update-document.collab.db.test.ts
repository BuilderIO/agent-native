import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeCollabStateVector } from "../shared/collab-state-vector.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `update-document-collab-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let updateDocumentAction: typeof import("./update-document.js").default;
let editDocumentAction: typeof import("./edit-document.js").default;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  updateDocumentAction = (await import("./update-document.js")).default;
  editDocumentAction = (await import("./edit-document.js")).default;
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createDocument(content: string) {
  const now = new Date().toISOString();
  const id = nextId("doc");
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    parentId: null,
    title: "Page",
    content,
    position: 0,
    visibility: "private",
    orgId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function documentRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row;
}

function type(doc: Y.Doc, text: string) {
  doc.getText("t").insert(doc.getText("t").length, text);
}

function sync(from: Y.Doc, to: Y.Doc) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

function liveSave(
  id: string,
  tab: { session: string; doc: Y.Doc },
  content: string,
  extra: Record<string, unknown> = {},
) {
  const attemptId = nextId("attempt");
  return {
    attemptId,
    result: runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content,
          editorSessionId: tab.session,
          editorEditGeneration: ++counter,
          browserSaveAttemptId: attemptId,
          collabStateVector: encodeCollabStateVector(tab.doc),
          ...extra,
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    ) as Promise<any>,
  };
}

describe("update-document live-editor saves", () => {
  it("orders tab saves by the shared document state, not by text merges", async () => {
    const seed = "Alpha\n\nBravo";
    const id = await createDocument(seed);
    const a = { session: nextId("tab-a"), doc: new Y.Doc() };
    const b = { session: nextId("tab-b"), doc: new Y.Doc() };

    type(a.doc, "a1");
    const first = await liveSave(id, a, "Alpha a1\nBravo", {
      baseRevision: documentRevisionToken(0, seed),
      collabIntegratedRevision: documentRevisionToken(0, seed),
    }).result;
    expect(first.collabBodySave).toBe("applied");
    expect(first.collabContentRevision).toBe(first.revision);

    sync(a.doc, b.doc);
    type(b.doc, "b1");
    // B's text base is stale; the state vector proves it already has A's edit.
    const second = await liveSave(id, b, "Alpha a1\nBravo b1", {
      baseRevision: documentRevisionToken(0, seed),
    }).result;
    expect(second.collabBodySave).toBe("applied");
    expect(second.content).toBe("Alpha a1\nBravo b1");

    const late = await liveSave(id, a, "Alpha a1\nBravo").result;
    expect(late.collabBodySave).toBe("covered");
    expect(late.content).toBe("Alpha a1\nBravo b1");
    const row = await documentRow(id);
    expect(row.content).toBe("Alpha a1\nBravo b1");
    expect(row.collabStateVectorRevision).toBe(row.bodyRevision);
    expect(row.collabBodyRevision).toBe(row.bodyRevision);
  });

  it("asks a tab missing a peer's edits to sync, then accepts its merged state", async () => {
    const id = await createDocument("Alpha\nBravo");
    const a = { session: nextId("tab-a"), doc: new Y.Doc() };
    const b = { session: nextId("tab-b"), doc: new Y.Doc() };
    type(a.doc, "a1");
    await liveSave(id, a, "Alpha a1\nBravo", {
      collabIntegratedRevision: documentRevisionToken(0, "Alpha\nBravo"),
    }).result;
    type(b.doc, "b1");

    const { attemptId, result } = liveSave(id, b, "Alpha\nBravo b1");
    const concurrent = await result;
    expect(concurrent).toMatchObject({
      conflict: true,
      collabSyncRequired: true,
    });
    expect((await documentRow(id)).content).toBe("Alpha a1\nBravo");
    const receipts = await getDb()
      .select()
      .from(schema.documentBrowserSaveAttempts)
      .where(
        and(
          eq(schema.documentBrowserSaveAttempts.documentId, id),
          eq(schema.documentBrowserSaveAttempts.attemptId, attemptId),
        ),
      );
    expect(receipts).toHaveLength(0);

    sync(a.doc, b.doc);
    const merged = await liveSave(id, b, "Alpha a1\nBravo b1").result;
    expect(merged.collabBodySave).toBe("applied");
    expect((await documentRow(id)).content).toBe("Alpha a1\nBravo b1");
  });

  it("requires proof of integration before replacing an agent-written body", async () => {
    const seed = "Alpha\nBravo\nCharlie";
    const id = await createDocument(seed);
    const a = { session: nextId("tab-a"), doc: new Y.Doc() };
    type(a.doc, "a1");
    const live = await liveSave(id, a, "Alpha a1\nBravo\nCharlie", {
      collabIntegratedRevision: documentRevisionToken(0, seed),
    }).result;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: live.revision,
          idempotencyKey: nextId("agent"),
          find: "Charlie",
          replace: "Charlie agent",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const agentRow = await documentRow(id);
    expect(agentRow.collabStateVectorRevision).not.toBe(agentRow.bodyRevision);

    type(a.doc, "a2");
    const unproven = await liveSave(id, a, "Alpha a1 a2\nBravo\nCharlie", {
      baseRevision: live.revision,
    }).result;
    expect(unproven.collabBodySave).toBeUndefined();
    expect((await documentRow(id)).content).toBe(
      "Alpha a1\nBravo\nCharlie agent",
    );

    const agentRevision = documentRevisionToken(
      agentRow.bodyRevision,
      agentRow.content,
    );
    const integrated = await liveSave(
      id,
      a,
      "Alpha a1 a2\nBravo\nCharlie agent",
      { collabIntegratedRevision: agentRevision },
    ).result;
    expect(integrated.collabBodySave).toBe("applied");
    expect(integrated.content).toBe("Alpha a1 a2\nBravo\nCharlie agent");
  });

  it("keeps later text merges provable across live-editor revisions", async () => {
    const seed = "Alpha\nBravo\nCharlie";
    const id = await createDocument(seed);
    const a = { session: nextId("tab-a"), doc: new Y.Doc() };
    type(a.doc, "a1");
    await liveSave(id, a, "Alpha a1\nBravo\nCharlie", {
      collabIntegratedRevision: documentRevisionToken(0, seed),
    }).result;
    type(a.doc, "a2");
    await liveSave(id, a, "Alpha a2\nBravo\nCharlie").result;

    const baseRevision = documentRevisionToken(0, seed);
    const legacy = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: "Alpha\nBravo\nCharlie legacy",
          baseRevision,
          authoredBaseRevision: baseRevision,
          authoredBaseContent: seed,
          authoredCandidateContent: "Alpha\nBravo\nCharlie legacy",
          editorSessionId: nextId("legacy-tab"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("legacy-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect((legacy as any).preservationRequired).toBeUndefined();
    expect((await documentRow(id)).content).toBe(
      "Alpha a2\nBravo\nCharlie legacy",
    );
  });

  it("rejects an unreadable state vector instead of treating it as empty", async () => {
    const id = await createDocument("Alpha");
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          {
            id,
            content: "Alpha b",
            editorSessionId: nextId("tab"),
            editorEditGeneration: 1,
            browserSaveAttemptId: nextId("attempt"),
            collabStateVector: "not base64!",
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_COLLAB_BODY_SAVE" });
  });
});
