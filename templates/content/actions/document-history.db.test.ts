import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";

const writeAppStateMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal()),
  writeAppState: writeAppStateMock,
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `document-history-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "history-owner@example.com";
const DOCUMENT_ID = "history-document";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let updateDocument: typeof import("./update-document.js").default;
let restoreDocumentVersion: typeof import("./restore-document-version.js").default;
let listDocumentHistory: typeof import("./list-document-history.js").default;
let listDocumentHistoryCheckpoints: typeof import("./list-document-history-checkpoints.js").default;
let getDocumentHistoryCheckpoint: typeof import("./get-document-history-checkpoint.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  updateDocument = (await import("./update-document.js")).default;
  restoreDocumentVersion = (await import("./restore-document-version.js"))
    .default;
  listDocumentHistory = (await import("./list-document-history.js")).default;
  listDocumentHistoryCheckpoints = (
    await import("./list-document-history-checkpoints.js")
  ).default;
  getDocumentHistoryCheckpoint = (
    await import("./get-document-history-checkpoint.js")
  ).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

beforeEach(async () => {
  writeAppStateMock.mockReset();
  writeAppStateMock.mockResolvedValue(undefined);
  await getDb().delete(schema.documentVersions);
  await getDb().delete(schema.documents);
  const now = new Date(Date.now() - 60_000).toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Draft",
    content: "start",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function asOwner<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

async function currentDocument() {
  const [document] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, DOCUMENT_ID));
  return document;
}

describe("grouped document history", () => {
  it("retains every saved checkpoint in session A and attributes session B to its own result", async () => {
    let current = await currentDocument();
    for (const content of ["session A first", "session A final"]) {
      const result = await asOwner(() =>
        updateDocument.run(
          {
            id: DOCUMENT_ID,
            content,
            baseUpdatedAt: current.updatedAt,
            historySessionId: "session-a",
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
      expect("conflict" in result && result.conflict).toBe(false);
      current = await currentDocument();
    }
    await asOwner(() =>
      updateDocument.run(
        {
          id: DOCUMENT_ID,
          content: "session B final",
          baseUpdatedAt: current.updatedAt,
          historySessionId: "session-b",
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );

    const firstPage = await asOwner(() =>
      listDocumentHistory.run({ documentId: DOCUMENT_ID, limit: 1 }),
    );
    expect(firstPage.groups).toHaveLength(1);
    expect(firstPage.groups[0]).toMatchObject({
      id: `human:${OWNER}:session-b`,
      kind: "human_session",
      actorEmail: OWNER,
      actorKind: "human",
    });
    expect(firstPage.hasMore).toBe(true);
    const secondPage = await asOwner(() =>
      listDocumentHistory.run({
        documentId: DOCUMENT_ID,
        limit: 1,
        cursor: firstPage.nextCursor!,
      }),
    );
    expect(secondPage.groups[0]?.id).toBe(`human:${OWNER}:session-a`);

    const sessionA = await asOwner(() =>
      listDocumentHistoryCheckpoints.run({
        documentId: DOCUMENT_ID,
        groupId: `human:${OWNER}:session-a`,
        limit: 10,
      }),
    );
    expect(sessionA.checkpoints).toHaveLength(3);
    const details = await Promise.all(
      sessionA.checkpoints.map((checkpoint) =>
        asOwner(() =>
          getDocumentHistoryCheckpoint.run({
            documentId: DOCUMENT_ID,
            versionId: checkpoint.id,
          }),
        ),
      ),
    );
    expect(details.map((item) => item.checkpoint.content)).toEqual([
      "session A final",
      "session A first",
      "start",
    ]);
    expect(
      details.find((item) => item.checkpoint.content === "session A final")
        ?.checkpoint.checkpointKind,
    ).toBe("after");

    const sessionBRows = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, DOCUMENT_ID),
          eq(schema.documentVersions.groupId, `human:${OWNER}:session-b`),
        ),
      );
    expect(sessionBRows).toHaveLength(1);
    expect(sessionBRows[0]).toMatchObject({
      content: "session B final",
      checkpointKind: "after",
    });
  });

  it("uses the agent run instead of a supplied browser session for attribution", async () => {
    await recordDocumentHistoryTransition({
      db: getDb(),
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      before: { title: "Draft", content: "start" },
      after: { title: "Agent title", content: "start" },
      cause: {
        historySessionId: "untrusted-human-session",
        operation: "update-document",
        ctx: {
          caller: "tool",
          userEmail: OWNER,
          runId: "agent-run-1",
          turnId: "turn-1",
        },
      },
      now: new Date().toISOString(),
    });
    const [row] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.checkpointKind, "after"));
    expect(row).toMatchObject({
      groupId: `agent:${OWNER}:agent-run-1`,
      groupKind: "agent_run",
      actorEmail: OWNER,
      actorKind: "agent",
      title: "Agent title",
    });
  });

  it("pages same-timestamp checkpoints with the after state first", async () => {
    const createdAt = new Date().toISOString();
    await getDb()
      .insert(schema.documentVersions)
      .values([
        {
          id: "same-time-before",
          ownerEmail: OWNER,
          documentId: DOCUMENT_ID,
          groupId: "same-time-group",
          groupKind: "operation",
          title: "Before",
          content: "before",
          checkpointKind: "before",
          createdAt,
        },
        {
          id: "same-time-after",
          ownerEmail: OWNER,
          documentId: DOCUMENT_ID,
          groupId: "same-time-group",
          groupKind: "operation",
          title: "After",
          content: "after",
          checkpointKind: "after",
          createdAt,
        },
      ]);
    const first = await asOwner(() =>
      listDocumentHistoryCheckpoints.run({
        documentId: DOCUMENT_ID,
        groupId: "same-time-group",
        limit: 1,
      }),
    );
    expect(first.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      "same-time-after",
    ]);
    const second = await asOwner(() =>
      listDocumentHistoryCheckpoints.run({
        documentId: DOCUMENT_ID,
        groupId: "same-time-group",
        limit: 1,
        cursor: first.nextCursor!,
      }),
    );
    expect(second.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      "same-time-before",
    ]);
  });

  it("advances updatedAt across same-millisecond saves so stale restore guards stay distinct", async () => {
    const fixedMs = Date.parse("2026-01-02T03:04:05.000Z");
    const fixedUpdatedAt = new Date(fixedMs).toISOString();
    await getDb()
      .update(schema.documents)
      .set({ updatedAt: fixedUpdatedAt })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(fixedMs);
    try {
      const first = await asOwner(() =>
        updateDocument.run(
          {
            id: DOCUMENT_ID,
            content: "same tick one",
            baseUpdatedAt: fixedUpdatedAt,
            historySessionId: "same-tick-one",
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
      expect("conflict" in first && first.conflict).toBe(false);
      const afterFirst = await currentDocument();
      expect(afterFirst.updatedAt).toBe(new Date(fixedMs + 1).toISOString());

      const second = await asOwner(() =>
        updateDocument.run(
          {
            id: DOCUMENT_ID,
            content: "same tick two",
            baseUpdatedAt: afterFirst.updatedAt,
            historySessionId: "same-tick-two",
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
      expect("conflict" in second && second.conflict).toBe(false);
      const afterSecond = await currentDocument();
      expect(afterSecond.updatedAt).toBe(new Date(fixedMs + 2).toISOString());

      const stale = await asOwner(() =>
        updateDocument.run(
          {
            id: DOCUMENT_ID,
            content: "stale overwrite",
            baseUpdatedAt: afterFirst.updatedAt,
            historySessionId: "same-tick-stale",
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
      expect("conflict" in stale && stale.conflict).toBe(true);
      expect(await currentDocument()).toMatchObject({
        content: "same tick two",
        updatedAt: afterSecond.updatedAt,
      });
    } finally {
      dateNow.mockRestore();
    }
  });

  it("restores atomically and writes nothing when the expected current state is stale", async () => {
    let current = await currentDocument();
    await asOwner(() =>
      updateDocument.run(
        {
          id: DOCUMENT_ID,
          content: "state A",
          baseUpdatedAt: current.updatedAt,
          historySessionId: "session-a",
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    const [stateA] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.groupId, `human:${OWNER}:session-a`),
          eq(schema.documentVersions.checkpointKind, "after"),
        ),
      )
      .orderBy(asc(schema.documentVersions.createdAt));
    current = await currentDocument();
    await asOwner(() =>
      updateDocument.run(
        {
          id: DOCUMENT_ID,
          content: "state B",
          baseUpdatedAt: current.updatedAt,
          historySessionId: "session-b",
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    current = await currentDocument();
    const beforeRestoreCount = (
      await getDb().select().from(schema.documentVersions)
    ).length;
    const restored = await asOwner(() =>
      restoreDocumentVersion.run(
        {
          documentId: DOCUMENT_ID,
          versionId: stateA.id,
          expectedUpdatedAt: current.updatedAt,
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(restored.content).toBe("state A");
    expect((await currentDocument()).content).toBe("state A");
    const afterRestoreCount = (
      await getDb().select().from(schema.documentVersions)
    ).length;
    expect(afterRestoreCount).toBe(beforeRestoreCount + 1);

    await expect(
      asOwner(() =>
        restoreDocumentVersion.run(
          {
            documentId: DOCUMENT_ID,
            versionId: stateA.id,
            expectedUpdatedAt: current.updatedAt,
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_RESTORE_CONFLICT" });
    expect((await currentDocument()).content).toBe("state A");
    expect(await getDb().select().from(schema.documentVersions)).toHaveLength(
      afterRestoreCount,
    );
  });

  it("does not expose checkpoints through another document or to an unauthorized caller", async () => {
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "other-document",
      ownerEmail: OWNER,
      title: "Other",
      content: "other body",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.documentVersions).values({
      id: "other-checkpoint",
      ownerEmail: OWNER,
      documentId: "other-document",
      title: "Other",
      content: "private checkpoint",
      createdAt: now,
    });

    await expect(
      asOwner(() =>
        getDocumentHistoryCheckpoint.run({
          documentId: DOCUMENT_ID,
          versionId: "other-checkpoint",
        }),
      ),
    ).rejects.toThrow("Checkpoint not found");
    await expect(
      runWithRequestContext({ userEmail: "outsider@example.com" }, () =>
        listDocumentHistory.run({ documentId: DOCUMENT_ID, limit: 10 }),
      ),
    ).rejects.toBeDefined();
  });

  it("fails loudly instead of restoring SQL behind a linked local file", async () => {
    const current = await currentDocument();
    await getDb().insert(schema.documentVersions).values({
      id: "linked-file-checkpoint",
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      title: "Older local title",
      content: "older local body",
      createdAt: new Date().toISOString(),
    });
    await getDb()
      .update(schema.documents)
      .set({
        sourceMode: "local-files",
        sourceKind: "file",
        sourcePath: "notes/page.md",
      })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    await expect(
      asOwner(() =>
        restoreDocumentVersion.run(
          {
            documentId: DOCUMENT_ID,
            versionId: "linked-file-checkpoint",
            expectedUpdatedAt: current.updatedAt,
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_RESTORE_SOURCE_UNSUPPORTED",
    });
    expect(await currentDocument()).toMatchObject({
      title: "Draft",
      content: "start",
    });
  });

  it("rolls the document update back when the restore checkpoint cannot persist", async () => {
    let current = await currentDocument();
    await asOwner(() =>
      updateDocument.run(
        {
          id: DOCUMENT_ID,
          content: "restore target",
          baseUpdatedAt: current.updatedAt,
          historySessionId: "target",
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    const [target] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.groupId, `human:${OWNER}:target`),
          eq(schema.documentVersions.checkpointKind, "after"),
        ),
      );
    current = await currentDocument();
    await asOwner(() =>
      updateDocument.run(
        {
          id: DOCUMENT_ID,
          content: "must survive failed restore",
          baseUpdatedAt: current.updatedAt,
          historySessionId: "current",
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    current = await currentDocument();
    const beforeCount = (await getDb().select().from(schema.documentVersions))
      .length;
    const { getDbExec } = await import("@agent-native/core/db");
    await getDbExec().execute(`
      CREATE FUNCTION reject_restore_checkpoint_fn() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        IF NEW.operation = 'restore-document-version' THEN
          RAISE EXCEPTION 'injected history failure';
        END IF;
        RETURN NEW;
      END;
      $body$
    `);
    await getDbExec().execute(`
      CREATE TRIGGER reject_restore_checkpoint
      BEFORE INSERT ON document_versions
      FOR EACH ROW EXECUTE FUNCTION reject_restore_checkpoint_fn()
    `);
    try {
      await expect(
        asOwner(() =>
          restoreDocumentVersion.run(
            {
              documentId: DOCUMENT_ID,
              versionId: target.id,
              expectedUpdatedAt: current.updatedAt,
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        ),
      ).rejects.toThrow();
      expect(await currentDocument()).toMatchObject({
        content: "must survive failed restore",
        updatedAt: current.updatedAt,
      });
      expect(await getDb().select().from(schema.documentVersions)).toHaveLength(
        beforeCount,
      );
    } finally {
      await getDbExec().execute(
        `DROP TRIGGER reject_restore_checkpoint ON document_versions`,
      );
      await getDbExec().execute(`DROP FUNCTION reject_restore_checkpoint_fn()`);
    }
  });

  it("allows only one of two simultaneous restores prepared from the same state", async () => {
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documentVersions)
      .values([
        {
          id: "simultaneous-target-a",
          ownerEmail: OWNER,
          documentId: DOCUMENT_ID,
          title: "Target A",
          content: "target A",
          createdAt: now,
        },
        {
          id: "simultaneous-target-b",
          ownerEmail: OWNER,
          documentId: DOCUMENT_ID,
          title: "Target B",
          content: "target B",
          createdAt: new Date(new Date(now).getTime() + 1).toISOString(),
        },
      ]);
    const current = await currentDocument();
    const results = await Promise.allSettled(
      ["simultaneous-target-a", "simultaneous-target-b"].map((versionId) =>
        asOwner(() =>
          restoreDocumentVersion.run(
            {
              documentId: DOCUMENT_ID,
              versionId,
              expectedUpdatedAt: current.updatedAt,
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { errorCode: "DOCUMENT_RESTORE_CONFLICT" },
    });
    expect(["target A", "target B"]).toContain(
      (await currentDocument()).content,
    );
  });

  it("reports a committed restore as success when its postcommit refresh signal fails", async () => {
    const current = await currentDocument();
    await getDb().insert(schema.documentVersions).values({
      id: "refresh-failure-target",
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      title: "Restored despite refresh failure",
      content: "restored body",
      createdAt: new Date().toISOString(),
    });
    writeAppStateMock.mockRejectedValueOnce(
      new Error("injected refresh failure"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const restored = await asOwner(() =>
        restoreDocumentVersion.run(
          {
            documentId: DOCUMENT_ID,
            versionId: "refresh-failure-target",
            expectedUpdatedAt: current.updatedAt,
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
      expect(restored).toMatchObject({
        title: "Restored despite refresh failure",
        content: "restored body",
      });
      expect(await currentDocument()).toMatchObject({
        title: "Restored despite refresh failure",
        content: "restored body",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "restore-document-version: refresh signal publish failed after commit",
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
