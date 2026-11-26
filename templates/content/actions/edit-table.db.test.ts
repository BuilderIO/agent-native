import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./_document-edit-mutation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_document-edit-mutation.js")>();
  return { ...actual, mutateDocumentBody: vi.fn(actual.mutateDocumentBody) };
});

vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn(async () => undefined),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `edit-table-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "table-editor@example.com";
const DOCUMENT_ID = "edit-table-page";
const BODY = [
  "Before the table.",
  '<table header-row="true">',
  "<tr>",
  "<td>Item</td>",
  "<td>State</td>",
  "</tr>",
  "<tr>",
  "<td>Alpha</td>",
  "<td>Draft</td>",
  "</tr>",
  "</table>",
  "After the table.",
].join("\n");

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let mutateDocumentBody: typeof import("./_document-edit-mutation.js").mutateDocumentBody;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;
let editTable: typeof import("./edit-table.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  ({ mutateDocumentBody, documentRevisionToken } =
    await import("./_document-edit-mutation.js"));
  editTable = (await import("./edit-table.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.documentBodyIntents);
  await db.delete(schema.documentEditReceipts);
  await db.delete(schema.documentVersions);
  await db.delete(schema.documentShares);
  await db.delete(schema.documents);
  await db.insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Tables",
    content: BODY,
    bodyRevision: 0,
  });
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

const ctx = { caller: "mcp" as const, userEmail: OWNER };

function run(args: Parameters<typeof editTable.run>[0]) {
  return runWithRequestContext({ userEmail: OWNER }, () =>
    editTable.run(args, ctx),
  );
}

async function body(): Promise<string> {
  const rows = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, DOCUMENT_ID));
  const content = rows[0]?.content;
  if (typeof content !== "string") throw new Error("The page has no body.");
  return content;
}

describe("edit-table", () => {
  it("saves one table's change as a receipted edit and replays a retry", async () => {
    const args = {
      id: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, BODY),
      idempotencyKey: "add-beta",
      table: 1,
      operations: [
        { op: "insert-row" as const, cells: ["Beta", "Ready"] },
        { op: "set-color" as const, row: 3, color: "green_bg" as const },
      ],
    };
    const result = await run(args);
    expect(result.receipt.outcome).toBe("applied");
    expect(result.table).toEqual({
      table: 1,
      rows: 3,
      columns: 2,
      headerRow: true,
      headerColumn: false,
      fitPageWidth: false,
    });
    const saved = await body();
    expect(saved).toBe(
      BODY.replace(
        "</tr>\n</table>",
        '</tr>\n<tr color="green_bg">\n<td>Beta</td>\n<td>Ready</td>\n</tr>\n</table>',
      ),
    );
    expect(result.receipt.revisions.after).toBe(
      documentRevisionToken(1, saved),
    );

    const retry = await run(args);
    expect(retry.receipt.idempotency.result).toBe("replayed");
    expect(await body()).toBe(saved);
  });

  it("refuses a base the page has moved past, naming the current revision", async () => {
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, BODY),
      idempotencyKey: "intro",
      edits: [{ find: "Before the table.", replace: "Intro, edited." }],
      ctx,
    });
    const edited = await body();
    await expect(
      run({
        id: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, BODY),
        idempotencyKey: "header-column",
        table: 1,
        operations: [{ op: "set-header-column", value: true }],
      }),
    ).rejects.toMatchObject({
      errorCode: "STALE_BASE_REVISION",
      statusCode: 409,
      details: { currentRevision: documentRevisionToken(1, edited) },
    });
    expect(await body()).toBe(edited);

    const retried = await run({
      id: DOCUMENT_ID,
      baseRevision: documentRevisionToken(1, edited),
      idempotencyKey: "header-column",
      table: 1,
      operations: [{ op: "set-header-column", value: true }],
    });
    expect(retried.receipt.outcome).toBe("applied");
    expect(await body()).toContain(
      '<table header-row="true" header-column="true">',
    );
  });

  it("answers a change the table already has as unchanged, with its summary", async () => {
    const result = await run({
      id: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, BODY),
      idempotencyKey: "header-row",
      table: 1,
      operations: [{ op: "set-header-row", value: true }],
    });
    expect(result.receipt.outcome).toBe("unchanged");
    expect(result.table).toMatchObject({ table: 1, rows: 2, headerRow: true });
    expect(await body()).toBe(BODY);
  });

  it("refuses a change the table already had on a base the page has moved past", async () => {
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, BODY),
      idempotencyKey: "intro",
      edits: [{ find: "Before the table.", replace: "Intro, edited." }],
      ctx,
    });
    const edited = await body();
    await expect(
      run({
        id: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, BODY),
        idempotencyKey: "header-row",
        table: 1,
        operations: [{ op: "set-header-row", value: true }],
      }),
    ).rejects.toMatchObject({
      errorCode: "STALE_BASE_REVISION",
      statusCode: 409,
      details: { currentRevision: documentRevisionToken(1, edited) },
    });
  });

  it("replays a change the table already had after the page moves on", async () => {
    const args = {
      id: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, BODY),
      idempotencyKey: "header-row",
      table: 1,
      operations: [{ op: "set-header-row" as const, value: true }],
    };
    expect((await run(args)).receipt.outcome).toBe("unchanged");
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, BODY),
      idempotencyKey: "intro",
      edits: [{ find: "Before the table.", replace: "Intro, edited." }],
      ctx,
    });
    const retry = await run(args);
    expect(retry.receipt.idempotency.result).toBe("replayed");
    expect(retry.receipt.outcome).toBe("unchanged");
    expect(retry.table).toMatchObject({ table: 1, headerRow: true });
  });

  it("refuses a change the table already had when the page it lands on has moved", async () => {
    const mutate = vi.mocked(mutateDocumentBody);
    const original = mutate.getMockImplementation();
    if (!original) throw new Error("mutateDocumentBody isn't wrapped.");
    mutate.mockImplementationOnce(async (args) => {
      const result = await original(args);
      return {
        ...result,
        receipt: {
          ...result.receipt,
          revisions: { ...result.receipt.revisions, after: "live-revision" },
          hashes: { ...result.receipt.hashes, after: "live-hash" },
        },
      };
    });
    await expect(
      run({
        id: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, BODY),
        idempotencyKey: "header-row-live",
        table: 1,
        operations: [{ op: "set-header-row", value: true }],
      }),
    ).rejects.toMatchObject({
      errorCode: "STALE_BASE_REVISION",
      statusCode: 409,
      details: { currentRevision: "live-revision" },
    });
    expect(await body()).toBe(BODY);
  });

  it("answers a missing table and a bad position with their codes, writing nothing", async () => {
    const base = {
      id: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, BODY),
      idempotencyKey: "refused",
    };
    await expect(
      run({ ...base, table: 2, operations: [{ op: "insert-row" }] }),
    ).rejects.toMatchObject({ errorCode: "TABLE_NOT_FOUND", statusCode: 404 });
    await expect(
      run({
        ...base,
        table: 1,
        operations: [{ op: "delete-column", column: 3 }],
      }),
    ).rejects.toMatchObject({
      errorCode: "TABLE_POSITION_OUT_OF_RANGE",
      statusCode: 422,
    });
    expect(await body()).toBe(BODY);
    expect(await getDb().select().from(schema.documentEditReceipts)).toEqual(
      [],
    );
  });

  it("refuses a base revision the page never had", async () => {
    await expect(
      run({
        id: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, "some other body"),
        idempotencyKey: "stale",
        table: 1,
        operations: [{ op: "insert-row" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "STALE_BASE_REVISION",
      statusCode: 409,
    });
  });
});
