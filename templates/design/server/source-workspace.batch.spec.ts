import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.stubEnv("APP_NAME", "source-batch-test");
vi.stubEnv("SOURCE_BATCH_TEST_DATABASE_URL", "pglite:memory://");

const accessState = vi.hoisted(() => ({ sourceType: "inline" }));

vi.mock("@agent-native/core/sharing", async () => {
  const { vi } = await import("vitest");
  return {
    assertAccess: vi.fn(async () => ({
      role: "editor",
      resource: {
        data: JSON.stringify({ sourceType: accessState.sourceType }),
      },
    })),
    resolveAccess: vi.fn().mockResolvedValue(null),
    registerShareableResource: vi.fn(),
  };
});

import {
  applyTextToYDoc,
  applyText,
  deleteCollabState,
  getCollabEmitter,
  getDoc,
  getText,
  releaseDoc,
  seedFromText,
} from "@agent-native/core/collab";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { eq, sql } from "drizzle-orm";

import { sourceContentHash } from "../shared/source-workspace.js";
import { getDb, schema } from "./db/index.js";
import {
  getDesignSourceMutationExec,
  withDesignSourceMutationTransaction,
  withPreparedSourceFileMutation,
  writeInlineSourceFile,
  writeInlineSourceFilesBatch,
  type SourceWorkspaceFile,
} from "./source-workspace.js";

const DESIGN_ID = "batch-design";
const SOURCE_ID = "a-screen-source";
const DESTINATION_ID = "z-screen-destination";
const SOURCE_BASE = '<main><section id="source">source</section></main>';
const DESTINATION_BASE =
  '<main><section id="destination">destination</section></main>';
const SOURCE_NEXT = '<main><section id="source">source moved</section></main>';
const DESTINATION_NEXT =
  '<main><section id="destination">destination moved</section></main>';
const DESTINATION_SQL_AHEAD =
  '<main><section id="destination">newer sql edit</section></main>';
const CONCURRENT_LIVE =
  '<main><section id="destination">concurrent live edit</section></main>';
const BASE_TIME = "2026-09-14T00:00:00.000Z";
const SQL_AHEAD_TIME = "2026-09-14T00:01:00.000Z";
const emitter = getCollabEmitter();
const events: Array<{ docId: string }> = [];
const recordEvent = (event: { docId: string }) => events.push(event);

function sourceFile(
  id: string,
  filename: string,
  content: string,
): SourceWorkspaceFile {
  return {
    id,
    designId: DESIGN_ID,
    filename,
    fileType: "html",
    content,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  };
}

async function execute(sqlText: string, args: unknown[] = []) {
  return getDbExec().execute({ sql: sqlText, args });
}

async function insertFile(id: string, filename: string, content: string) {
  await execute(
    `INSERT INTO design_files
      (id, design_id, filename, content, file_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'html', ?, ?)`,
    [id, DESIGN_ID, filename, content, BASE_TIME, BASE_TIME],
  );
}

async function persistedFiles() {
  const result = await execute(
    "SELECT id, content, updated_at FROM design_files ORDER BY id",
  );
  return result.rows;
}

async function persistedCollabRows() {
  const result = await execute(
    "SELECT doc_id, text_snapshot, version FROM _collab_docs WHERE doc_id = ? OR doc_id = ? ORDER BY doc_id",
    [SOURCE_ID, DESTINATION_ID],
  );
  return result.rows;
}

async function writePair(
  sourceContent = SOURCE_NEXT,
  destinationContent = DESTINATION_NEXT,
  expectedHtmlFileIds?: readonly string[],
) {
  return writeInlineSourceFilesBatch({
    designId: DESIGN_ID,
    files: [
      {
        file: sourceFile(SOURCE_ID, "source.html", SOURCE_BASE),
        content: sourceContent,
        expectedVersionHash: sourceContentHash(SOURCE_BASE),
      },
      {
        file: sourceFile(DESTINATION_ID, "destination.html", DESTINATION_BASE),
        content: destinationContent,
        expectedVersionHash: sourceContentHash(DESTINATION_BASE),
      },
    ],
    ...(expectedHtmlFileIds ? { expectedHtmlFileIds } : {}),
  });
}

beforeAll(async () => {
  await getDbExec().execute("SELECT 1");
  await getDb().execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS designs (
        id TEXT PRIMARY KEY,
        updated_at TEXT
      )
    `),
  );
  await getDb().execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS design_files (
        id TEXT PRIMARY KEY,
        design_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        content_operation_source TEXT,
        content_operation_revision INTEGER,
        content_operation_result_hash TEXT,
        file_type TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      )
    `),
  );
  await deleteCollabState("source-batch-table-init");
});

beforeEach(async () => {
  accessState.sourceType = "inline";
  releaseDoc(SOURCE_ID);
  releaseDoc(DESTINATION_ID);
  await deleteCollabState(SOURCE_ID);
  await deleteCollabState(DESTINATION_ID);
  await execute("DELETE FROM design_files");
  await execute("DELETE FROM designs");
  await execute("INSERT INTO designs (id, updated_at) VALUES (?, ?)", [
    DESIGN_ID,
    BASE_TIME,
  ]);
  await insertFile(SOURCE_ID, "source.html", SOURCE_BASE);
  await insertFile(DESTINATION_ID, "destination.html", DESTINATION_BASE);
  await seedFromText(SOURCE_ID, SOURCE_BASE);
  await seedFromText(DESTINATION_ID, DESTINATION_BASE);
  events.length = 0;
});

afterAll(async () => {
  emitter.off("collab", recordEvent);
  releaseDoc(SOURCE_ID);
  releaseDoc(DESTINATION_ID);
  vi.unstubAllEnvs();
  await closeDbExec();
});

describe("writeInlineSourceFilesBatch", () => {
  it("rolls back prepared collaboration state with the source transaction", async () => {
    await expect(
      withPreparedSourceFileMutation(SOURCE_ID, "agent", (lease) =>
        withDesignSourceMutationTransaction(DESIGN_ID, async (tx) => {
          applyTextToYDoc(lease.doc, "content", SOURCE_NEXT, "agent");
          await lease.persist(getDesignSourceMutationExec(tx), SOURCE_NEXT);
          throw new Error("rollback source mutation");
        }),
      ),
    ).rejects.toThrow("rollback source mutation");

    expect(await getText(SOURCE_ID)).toBe(SOURCE_BASE);
    expect(await persistedCollabRows()).toEqual([
      { doc_id: SOURCE_ID, text_snapshot: SOURCE_BASE, version: 0 },
      { doc_id: DESTINATION_ID, text_snapshot: DESTINATION_BASE, version: 0 },
    ]);
  });

  it("seeds an existing empty collaboration row before a no-op source write", async () => {
    await execute(
      "UPDATE _collab_docs SET yjs_state = '', text_snapshot = '' WHERE doc_id = ?",
      [SOURCE_ID],
    );
    releaseDoc(SOURCE_ID);

    await writeInlineSourceFile({
      designId: DESIGN_ID,
      file: sourceFile(SOURCE_ID, "source.html", SOURCE_BASE),
      content: SOURCE_BASE,
      expectedVersionHash: sourceContentHash(SOURCE_BASE),
    });

    const rows = await execute(
      "SELECT yjs_state, text_snapshot, version FROM _collab_docs WHERE doc_id = ?",
      [SOURCE_ID],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      text_snapshot: SOURCE_BASE,
      version: 1,
    });
    expect((rows.rows[0] as { yjs_state: string }).yjs_state).not.toBe("");
    expect(await getText(SOURCE_ID)).toBe(SOURCE_BASE);
  });

  it("seeds an existing empty collaboration row before a batch write", async () => {
    await execute(
      "UPDATE _collab_docs SET yjs_state = '', text_snapshot = '' WHERE doc_id = ?",
      [SOURCE_ID],
    );
    releaseDoc(SOURCE_ID);

    await writeInlineSourceFilesBatch({
      designId: DESIGN_ID,
      files: [
        {
          file: sourceFile(SOURCE_ID, "source.html", SOURCE_BASE),
          content: SOURCE_BASE,
          expectedVersionHash: sourceContentHash(SOURCE_BASE),
        },
      ],
    });

    const rows = await execute(
      "SELECT yjs_state, text_snapshot, version FROM _collab_docs WHERE doc_id = ?",
      [SOURCE_ID],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      text_snapshot: SOURCE_BASE,
      version: 1,
    });
    expect((rows.rows[0] as { yjs_state: string }).yjs_state).not.toBe("");
    expect(await getText(SOURCE_ID)).toBe(SOURCE_BASE);
  });

  it("serializes design-file insert and delete membership mutations", async () => {
    let releaseInsert!: () => void;
    let inserted!: () => void;
    const insertEntered = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const insertRelease = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });

    const insertRun = withDesignSourceMutationTransaction(
      DESIGN_ID,
      async (tx) => {
        await tx.insert(schema.designFiles).values({
          id: "membership-insert",
          designId: DESIGN_ID,
          filename: "inserted.html",
          content: "<main>inserted</main>",
          fileType: "html",
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        });
        inserted();
        await insertRelease;
      },
    );
    await insertEntered;

    let deleteEntered = false;
    const deleteRun = withDesignSourceMutationTransaction(
      DESIGN_ID,
      async (tx) => {
        deleteEntered = true;
        await tx
          .delete(schema.designFiles)
          .where(eq(schema.designFiles.id, DESTINATION_ID));
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(deleteEntered).toBe(false);

    releaseInsert();
    await Promise.all([insertRun, deleteRun]);
    expect(await persistedFiles()).toEqual([
      { id: SOURCE_ID, content: SOURCE_BASE, updated_at: BASE_TIME },
      {
        id: "membership-insert",
        content: "<main>inserted</main>",
        updated_at: BASE_TIME,
      },
    ]);
  });

  it("keeps a content snapshot inside the design mutation lock", async () => {
    let releaseFirst!: () => void;
    let snapshotTaken!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstSnapshot = new Promise<void>((resolve) => {
      snapshotTaken = resolve;
    });

    const firstRun = withDesignSourceMutationTransaction(
      DESIGN_ID,
      async (tx) => {
        const [captured] = await tx
          .select({ content: schema.designFiles.content })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.id, SOURCE_ID))
          .limit(1);
        expect(captured?.content).toBe(SOURCE_BASE);
        snapshotTaken();
        await firstRelease;
        await tx
          .update(schema.designFiles)
          .set({ content: SOURCE_NEXT })
          .where(eq(schema.designFiles.id, SOURCE_ID));
      },
    );
    await firstSnapshot;

    let secondEntered = false;
    const secondRun = withDesignSourceMutationTransaction(
      DESIGN_ID,
      async (tx) => {
        secondEntered = true;
        await tx
          .update(schema.designFiles)
          .set({ content: DESTINATION_NEXT })
          .where(eq(schema.designFiles.id, SOURCE_ID));
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(secondEntered).toBe(false);

    releaseFirst();
    await Promise.all([firstRun, secondRun]);
    const [winner] = await execute(
      "SELECT content FROM design_files WHERE id = ?",
      [SOURCE_ID],
    ).then((result) => result.rows);
    expect(winner).toEqual({ content: DESTINATION_NEXT });
  });

  it("serializes index and single-file source mutations before either takes the design lock", async () => {
    const run = async (fileId: string, first: string, second: string) => {
      const order: string[] = [];
      let enterFirst!: () => void;
      let releaseFirst!: () => void;
      const firstEntered = new Promise<void>((resolve) => {
        enterFirst = resolve;
      });
      const firstRelease = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const sourceMutation = (label: string, wait = false) =>
        withPreparedSourceFileMutation(fileId, undefined, async () => {
          order.push(`${label}-ydoc`);
          if (wait) {
            enterFirst();
            await firstRelease;
          }
          await withDesignSourceMutationTransaction(DESIGN_ID, async () => {
            order.push(`${label}-sql`);
          });
        });

      const firstRun = sourceMutation(first, true);
      await firstEntered;

      const secondRun = sourceMutation(second);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(order).toEqual([`${first}-ydoc`]);

      releaseFirst();
      await Promise.race([
        Promise.all([firstRun, secondRun]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("source mutation deadlocked")),
            1000,
          ),
        ),
      ]);
      expect(order).toEqual([
        `${first}-ydoc`,
        `${first}-sql`,
        `${second}-ydoc`,
        `${second}-sql`,
      ]);
    };

    await run("lock-order-index-first", "index", "rename");
    await run("lock-order-rename-first", "rename", "index");
  });

  it.each(["sql-ahead", "live-ahead"] as const)(
    "rejects a destination whose %s is newer than the captured base before writing",
    async (newerSide) => {
      if (newerSide === "sql-ahead") {
        await execute(
          "UPDATE design_files SET content = ?, updated_at = ? WHERE id = ?",
          [DESTINATION_SQL_AHEAD, SQL_AHEAD_TIME, DESTINATION_ID],
        );
      } else {
        await applyText(DESTINATION_ID, CONCURRENT_LIVE);
      }

      await expect(writePair()).rejects.toMatchObject({ statusCode: 409 });

      expect(await persistedFiles()).toEqual([
        { id: SOURCE_ID, content: SOURCE_BASE, updated_at: BASE_TIME },
        {
          id: DESTINATION_ID,
          content:
            newerSide === "sql-ahead"
              ? DESTINATION_SQL_AHEAD
              : DESTINATION_BASE,
          updated_at: newerSide === "sql-ahead" ? SQL_AHEAD_TIME : BASE_TIME,
        },
      ]);
      expect(await persistedCollabRows()).toEqual([
        {
          doc_id: SOURCE_ID,
          text_snapshot: SOURCE_BASE,
          version: 0,
        },
        {
          doc_id: DESTINATION_ID,
          text_snapshot:
            newerSide === "live-ahead" ? CONCURRENT_LIVE : DESTINATION_BASE,
          version: newerSide === "live-ahead" ? 1 : 0,
        },
      ]);
      expect(await getText(SOURCE_ID)).toBe(SOURCE_BASE);
      expect(await getText(DESTINATION_ID)).toBe(
        newerSide === "live-ahead" ? CONCURRENT_LIVE : DESTINATION_BASE,
      );
    },
  );

  it.each(["localhost", "fusion"] as const)(
    "rejects %s designs before writing a source batch",
    async (sourceType) => {
      accessState.sourceType = sourceType;

      emitter.on("collab", recordEvent);
      try {
        await expect(writePair()).rejects.toMatchObject({ statusCode: 409 });
      } finally {
        emitter.off("collab", recordEvent);
      }

      expect(await persistedFiles()).toEqual([
        { id: SOURCE_ID, content: SOURCE_BASE, updated_at: BASE_TIME },
        {
          id: DESTINATION_ID,
          content: DESTINATION_BASE,
          updated_at: BASE_TIME,
        },
      ]);
      expect(await persistedCollabRows()).toEqual([
        { doc_id: SOURCE_ID, text_snapshot: SOURCE_BASE, version: 0 },
        {
          doc_id: DESTINATION_ID,
          text_snapshot: DESTINATION_BASE,
          version: 0,
        },
      ]);
      expect(await getText(SOURCE_ID)).toBe(SOURCE_BASE);
      expect(await getText(DESTINATION_ID)).toBe(DESTINATION_BASE);
      expect(events).toEqual([]);
    },
  );

  it("rejects a full-set batch when a new HTML file appears after preflight", async () => {
    const exec = getDbExec();
    const originalTransaction = exec.transaction!;
    exec.transaction = async (run) => {
      await insertFile("late-screen", "late.html", "<main>late</main>");
      return originalTransaction(run);
    };

    try {
      await expect(
        writePair(SOURCE_NEXT, DESTINATION_NEXT, [SOURCE_ID, DESTINATION_ID]),
      ).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      exec.transaction = originalTransaction;
    }

    expect(await persistedFiles()).toEqual([
      { id: SOURCE_ID, content: SOURCE_BASE, updated_at: BASE_TIME },
      {
        id: "late-screen",
        content: "<main>late</main>",
        updated_at: BASE_TIME,
      },
      {
        id: DESTINATION_ID,
        content: DESTINATION_BASE,
        updated_at: BASE_TIME,
      },
    ]);
    expect(await persistedCollabRows()).toEqual([
      { doc_id: SOURCE_ID, text_snapshot: SOURCE_BASE, version: 0 },
      {
        doc_id: DESTINATION_ID,
        text_snapshot: DESTINATION_BASE,
        version: 0,
      },
    ]);
    expect(await getText(SOURCE_ID)).toBe(SOURCE_BASE);
    expect(await getText(DESTINATION_ID)).toBe(DESTINATION_BASE);
  });

  it.each([DESTINATION_BASE, DESTINATION_NEXT])(
    "rolls both file and collab rows back when the second collab CAS misses for %s",
    async (destinationContent) => {
      await getDb().execute(
        sql.raw(`
        CREATE OR REPLACE FUNCTION force_destination_collab_conflict()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.doc_id = '${SOURCE_ID}' AND NEW.version = OLD.version + 1 THEN
            UPDATE _collab_docs
            SET version = version + 1
            WHERE doc_id = '${DESTINATION_ID}';
          END IF;
          RETURN NEW;
        END;
        $$;
      `),
      );
      await getDb().execute(
        sql.raw(`
        CREATE TRIGGER force_destination_collab_conflict
        AFTER UPDATE ON _collab_docs
        FOR EACH ROW EXECUTE FUNCTION force_destination_collab_conflict();
      `),
      );

      const sourceBefore = await getText(SOURCE_ID);
      const destinationBefore = await getText(DESTINATION_ID);
      const removeListener = () => emitter.off("collab", recordEvent);
      emitter.on("collab", recordEvent);
      try {
        await expect(
          writePair(SOURCE_NEXT, destinationContent),
        ).rejects.toMatchObject({
          statusCode: 409,
        });

        expect(await persistedFiles()).toEqual([
          { id: SOURCE_ID, content: SOURCE_BASE, updated_at: BASE_TIME },
          {
            id: DESTINATION_ID,
            content: DESTINATION_BASE,
            updated_at: BASE_TIME,
          },
        ]);
        expect(await persistedCollabRows()).toEqual([
          { doc_id: SOURCE_ID, text_snapshot: SOURCE_BASE, version: 0 },
          {
            doc_id: DESTINATION_ID,
            text_snapshot: DESTINATION_BASE,
            version: 0,
          },
        ]);
        expect(await getText(SOURCE_ID)).toBe(sourceBefore);
        expect(await getText(DESTINATION_ID)).toBe(destinationBefore);
        expect(events).toEqual([]);
      } finally {
        removeListener();
        await getDb().execute(
          sql.raw(`
          DROP TRIGGER force_destination_collab_conflict ON _collab_docs;
        `),
        );
        await getDb().execute(
          sql.raw("DROP FUNCTION force_destination_collab_conflict()"),
        );
      }
    },
  );

  it("commits both file and collab rows before publishing either prepared doc", async () => {
    emitter.on("collab", recordEvent);
    const sourceBefore = await getDoc(SOURCE_ID);
    const destinationBefore = await getDoc(DESTINATION_ID);
    const exec = getDbExec();
    const originalTransaction = exec.transaction!;
    let sawUnpublishedTransaction = false;
    exec.transaction = (run) =>
      originalTransaction(async (tx) => {
        const result = await run(tx);
        sawUnpublishedTransaction = true;
        expect(events).toEqual([]);
        expect(sourceBefore.getText("content").toString()).toBe(SOURCE_BASE);
        expect(destinationBefore.getText("content").toString()).toBe(
          DESTINATION_BASE,
        );
        return result;
      });

    try {
      const result = await writePair();
      expect(sawUnpublishedTransaction).toBe(true);
      expect(result.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: SOURCE_ID,
            versionHash: sourceContentHash(SOURCE_NEXT),
            changed: true,
          }),
          expect.objectContaining({
            id: DESTINATION_ID,
            versionHash: sourceContentHash(DESTINATION_NEXT),
            changed: true,
          }),
        ]),
      );
      expect(result.collaboration).toMatchObject({
        status: "synced",
        files: [
          { fileId: SOURCE_ID, status: "synced" },
          { fileId: DESTINATION_ID, status: "synced" },
        ],
      });
      expect(await persistedFiles()).toEqual([
        expect.objectContaining({ id: SOURCE_ID, content: SOURCE_NEXT }),
        expect.objectContaining({
          id: DESTINATION_ID,
          content: DESTINATION_NEXT,
        }),
      ]);
      expect(await persistedCollabRows()).toEqual([
        { doc_id: SOURCE_ID, text_snapshot: SOURCE_NEXT, version: 1 },
        {
          doc_id: DESTINATION_ID,
          text_snapshot: DESTINATION_NEXT,
          version: 1,
        },
      ]);
      expect(await getText(SOURCE_ID)).toBe(SOURCE_NEXT);
      expect(await getText(DESTINATION_ID)).toBe(DESTINATION_NEXT);
      expect(events.map(({ docId }) => docId).sort()).toEqual(
        [SOURCE_ID, DESTINATION_ID].sort(),
      );
    } finally {
      exec.transaction = originalTransaction;
      emitter.off("collab", recordEvent);
    }
  });

  it("initializes an absent collab row from the captured SQL base", async () => {
    releaseDoc(DESTINATION_ID);
    await deleteCollabState(DESTINATION_ID);

    await writePair();

    expect(await persistedFiles()).toEqual([
      expect.objectContaining({ id: SOURCE_ID, content: SOURCE_NEXT }),
      expect.objectContaining({
        id: DESTINATION_ID,
        content: DESTINATION_NEXT,
      }),
    ]);
    expect(await getText(DESTINATION_ID)).toBe(DESTINATION_NEXT);
    expect(await persistedCollabRows()).toEqual([
      { doc_id: SOURCE_ID, text_snapshot: SOURCE_NEXT, version: 1 },
      {
        doc_id: DESTINATION_ID,
        text_snapshot: DESTINATION_NEXT,
        version: 0,
      },
    ]);
  });

  it("seeds an absent collab row even when that file's content is unchanged", async () => {
    releaseDoc(DESTINATION_ID);
    await deleteCollabState(DESTINATION_ID);

    const result = await writePair(SOURCE_NEXT, DESTINATION_BASE);

    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: DESTINATION_ID,
          changed: false,
          updatedAt: BASE_TIME,
        }),
      ]),
    );
    expect(await persistedFiles()).toEqual([
      expect.objectContaining({ id: SOURCE_ID, content: SOURCE_NEXT }),
      {
        id: DESTINATION_ID,
        content: DESTINATION_BASE,
        updated_at: BASE_TIME,
      },
    ]);
    expect(await persistedCollabRows()).toEqual([
      { doc_id: SOURCE_ID, text_snapshot: SOURCE_NEXT, version: 1 },
      {
        doc_id: DESTINATION_ID,
        text_snapshot: DESTINATION_BASE,
        version: 0,
      },
    ]);
  });

  it("keeps unchanged SQL timestamps while CAS-persisting every collab member", async () => {
    emitter.on("collab", recordEvent);
    let result: Awaited<ReturnType<typeof writePair>>;
    try {
      result = await writePair(SOURCE_NEXT, DESTINATION_BASE);
    } finally {
      emitter.off("collab", recordEvent);
    }

    expect(await persistedFiles()).toEqual([
      expect.objectContaining({ id: SOURCE_ID, content: SOURCE_NEXT }),
      {
        id: DESTINATION_ID,
        content: DESTINATION_BASE,
        updated_at: BASE_TIME,
      },
    ]);
    expect(await persistedCollabRows()).toEqual([
      { doc_id: SOURCE_ID, text_snapshot: SOURCE_NEXT, version: 1 },
      {
        doc_id: DESTINATION_ID,
        text_snapshot: DESTINATION_BASE,
        version: 1,
      },
    ]);
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: DESTINATION_ID,
          changed: false,
          updatedAt: BASE_TIME,
        }),
      ]),
    );
    expect(events.map(({ docId }) => docId).sort()).toEqual(
      [SOURCE_ID, DESTINATION_ID].sort(),
    );
  });
});
