import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { firstRow } from "./first-row.js";

// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

type TaskStatus = "running" | "completed" | "errored";

const agents = vi.hoisted(() => ({
  spawned: [] as Array<Record<string, unknown>>,
  statuses: new Map<string, TaskStatus>(),
  aiReady: true,
  onSpawn: undefined as
    | ((options: Record<string, unknown>) => Promise<void>)
    | undefined,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    spawnTask: vi.fn(async (options: Record<string, unknown>) => {
      const index = agents.spawned.push(options);
      const taskId = `task-${index}`;
      agents.statuses.set(taskId, "running");
      await agents.onSpawn?.(options);
      return {
        taskId,
        threadId: `thread-${index}`,
        runId: `run-task-${taskId}`,
        description: String(options.description),
        status: "running",
        preview: "",
        summary: "",
        currentStep: "",
        createdAt: Date.now(),
      };
    }),
    getTask: vi.fn(async (taskId: string) => {
      const status = agents.statuses.get(taskId);
      return status
        ? {
            taskId,
            status,
            error: status === "errored" ? "The model refused." : undefined,
          }
        : undefined;
    }),
    isAgentChatAiSetupReady: vi.fn(async () => agents.aiReady),
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-column-fill-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let columnFill: typeof import("./column-fill.js");
let createDatabase: typeof import("../../actions/create-content-database.js").default;
let configureProperty: typeof import("../../actions/configure-document-property.js").default;
let getDatabase: typeof import("../../actions/get-content-database.js").default;
let createRow: typeof import("../../actions/add-database-item.js").default;
let setProperty: typeof import("../../actions/set-document-property.js").default;

const asOwner = async <T>(run: () => T): Promise<Awaited<T>> =>
  await runWithRequestContext({ userEmail: OWNER }, async () => await run());

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  columnFill = await import("./column-fill.js");
  createDatabase = (await import("../../actions/create-content-database.js"))
    .default;
  configureProperty = (
    await import("../../actions/configure-document-property.js")
  ).default;
  getDatabase = (await import("../../actions/get-content-database.js")).default;
  createRow = (await import("../../actions/add-database-item.js")).default;
  setProperty = (await import("../../actions/set-document-property.js"))
    .default;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(() => {
  agents.spawned.length = 0;
  agents.statuses.clear();
  agents.aiReady = true;
  agents.onSpawn = undefined;
});

function run(index: number) {
  return {
    threadId: `thread-${index}`,
    turnId: `run-task-task-${index}`,
  } as never;
}

function chatTurn(index: number) {
  return { threadId: `thread-${index}`, turnId: `chat-turn-${index}` } as never;
}

function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} not found.`);
  return value;
}

async function fixture(rowCount: number, filled = 0) {
  const created = await asOwner(() =>
    createDatabase.run({ title: "Articles" }),
  );
  const databaseId = created.database.id;
  const databaseDocumentId = created.database.documentId;
  const addProperty = async (
    name: string,
    type: "text" | "select",
    options?: unknown,
  ) => {
    const response = (await asOwner(() =>
      configureProperty.run({
        documentId: databaseDocumentId,
        databaseId,
        name,
        type,
        ...(options ? { options } : {}),
      } as never),
    )) as { properties: Array<{ definition: { id: string; name: string } }> };
    return found(
      response.properties.find(
        (candidate) => candidate.definition.name === name,
      ),
      `Property ${name}`,
    ).definition.id;
  };
  const summary = await addProperty("Summary", "text");
  const kind = await addProperty("Kind", "select", {
    options: [
      { id: "kind-guide", name: "Guide", color: "blue" },
      { id: "kind-news", name: "News", color: "green" },
    ],
  });
  const rows: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const response = await asOwner(() => getDatabase.run({ databaseId }));
    if (!("database" in response) || !response.mutationContract) {
      throw new Error("Fixture collection has no mutation contract.");
    }
    const contract = response.mutationContract;
    const row = await asOwner(() =>
      createRow.run({
        target: {
          spaceId: contract.target.spaceId,
          databaseId: contract.target.databaseId,
          databaseDocumentId: contract.target.databaseDocumentId,
        },
        expectedSchemaRevision: contract.schemaRevision,
        idempotencyKey: `seed-${databaseId}-${index}`,
        title: `Article ${index + 1}`,
        ...(index < filled
          ? { propertyValues: { [summary]: `Written ${index + 1}` } }
          : {}),
      }),
    );
    rows.push(row.receipt.row.documentId);
  }
  const row = (index: number) => found(rows[index], `Row ${index + 1}`);
  return { databaseId, databaseDocumentId, summary, kind, rows, row };
}

async function cells(fillId: string) {
  const fill = await asOwner(() => columnFill.readColumnFill(fillId));
  return new Map(fill.cells.map((cell) => [cell.documentId, cell.status]));
}

async function cellValue(documentId: string, propertyId: string) {
  const row = firstRow(
    await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      ),
  );
  return row ? JSON.parse(row.valueJson) : null;
}

function running(statuses: Map<string, string>) {
  return [...statuses].filter(([, status]) => status === "running");
}

describe("Fill with AI", () => {
  it("fills only empty cells, five rows at a time", async () => {
    const ids = await fixture(8, 2);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "One sentence on what the page covers",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );

    expect(fill.total).toBe(6);
    expect(fill.cells.map((cell) => cell.documentId)).toEqual(
      ids.rows.slice(2),
    );
    expect(agents.spawned).toHaveLength(5);
    expect(agents.spawned[0]).toMatchObject({
      ownerEmail: OWNER,
      quiet: true,
      parentDelegationDepth: 0,
      allowedActionNames: ["get-document", "fill-column-cell"],
      scope: { type: "content-column-fill", id: fill.id },
    });
    let statuses = await cells(fill.id);
    expect(running(statuses)).toHaveLength(5);
    expect(statuses.get(ids.row(7))).toBe("waiting");

    const saved = await asOwner(() =>
      columnFill.fillColumnCell(
        {
          fillId: fill.id,
          documentId: ids.row(2),
          value: "About sourdough.",
        },
        undefined,
      ),
    );
    expect(saved.status).toBe("filled");
    expect(await cellValue(ids.row(2), ids.summary)).toBe("About sourdough.");
    expect(agents.spawned).toHaveLength(6);
    statuses = await cells(fill.id);
    expect(statuses.get(ids.row(7))).toBe("running");
    expect(running(statuses)).toHaveLength(5);
  });

  it("rewrites cells that have a value when asked", async () => {
    const ids = await fixture(3, 2);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Rewrite it shorter",
        rewrite: true,
        documentIds: ids.rows,
      }),
    );
    expect(fill.total).toBe(3);
    expect(agents.spawned).toHaveLength(3);
  });

  it("keeps an edit made while a row's agent runs", async () => {
    const ids = await fixture(6);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    const [first, second, , , , last] = ids.rows as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    await asOwner(() =>
      setProperty.run({
        documentId: first,
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        value: "Mine",
      }),
    );
    await asOwner(() =>
      setProperty.run({
        documentId: last,
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        value: "Also mine",
      }),
    );

    const late = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: first, value: "The agent's" },
        undefined,
      ),
    );
    expect(late.status).toBe("kept");
    expect(await cellValue(first, ids.summary)).toBe("Mine");

    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: second, value: "Filled" },
        undefined,
      ),
    );
    const statuses = await cells(fill.id);
    expect(statuses.get(last)).toBe("kept");
    expect(agents.spawned).toHaveLength(5);
    expect(await cellValue(last, ids.summary)).toBe("Also mine");
  });

  it("lets a follow-up from the row's chat change a filled cell", async () => {
    const ids = await fixture(1);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    const row = ids.row(0);
    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "First try" },
        run(1),
      ),
    );
    const followUp = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "Shorter" },
        chatTurn(1),
      ),
    );
    expect(followUp.status).toBe("filled");
    expect(await cellValue(row, ids.summary)).toBe("Shorter");
    expect(
      (await asOwner(() => columnFill.readColumnFill(fill.id))).status,
    ).toBe("done");
  });

  it("keeps an edit made after a run's first save when the run saves again", async () => {
    const ids = await fixture(2);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    const row = ids.row(0);
    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "First try" },
        run(1),
      ),
    );
    await asOwner(() =>
      setProperty.run({
        documentId: row,
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        value: "Mine",
      }),
    );
    const again = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "Second try" },
        run(1),
      ),
    );
    expect(again.status).toBe("filled");
    expect(await cellValue(row, ids.summary)).toBe("Mine");
  });

  it("saves only to the cell a run was started for", async () => {
    const ids = await fixture(6);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );

    const waiting = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(5), value: "Too early" },
        run(1),
      ),
    );
    expect(waiting.status).toBe("waiting");
    expect(await cellValue(ids.row(5), ids.summary)).toBeNull();

    const otherRun = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(0), value: "Not mine" },
        run(2),
      ),
    );
    expect(otherRun.status).toBe("running");
    expect(await cellValue(ids.row(0), ids.summary)).toBeNull();

    await asOwner(() =>
      setProperty.run({
        documentId: ids.row(1),
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        value: "Mine",
      }),
    );
    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(1), value: "The agent's" },
        run(2),
      ),
    );
    const keptAgain = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(1), value: "The agent's" },
        run(2),
      ),
    );
    expect(keptAgain.status).toBe("kept");
    expect(await cellValue(ids.row(1), ids.summary)).toBe("Mine");
  });

  it("links a row's chat even when its run saves before it is recorded", async () => {
    const ids = await fixture(1);
    agents.onSpawn = async (options) => {
      const scope = options.scope as { id: string };
      await getDb()
        .update(schema.contentColumnFillCells)
        .set({ status: "filled" })
        .where(eq(schema.contentColumnFillCells.fillId, scope.id));
    };
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    expect(fill.cells[0]).toMatchObject({
      status: "filled",
      agentThreadId: "thread-1",
    });
  });

  it("leaves out rows the person can't edit", async () => {
    const ids = await fixture(3);
    await getDb()
      .update(schema.documents)
      .set({ ownerEmail: "someone-else@example.com" })
      .where(eq(schema.documents.id, ids.row(1)));
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    expect(fill.cells.map((cell) => cell.documentId)).toEqual([
      ids.row(0),
      ids.row(2),
    ]);
  });

  it("runs one fill per column at a time", async () => {
    const ids = await fixture(2);
    const first = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    agents.statuses.set("task-1", "errored");
    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: first.id, documentId: ids.row(1), value: "Done" },
        run(2),
      ),
    );
    expect(
      (await asOwner(() => columnFill.readColumnFill(first.id))).status,
    ).toBe("done");

    await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Shorter",
        rewrite: true,
        documentIds: ids.rows,
      }),
    );
    await expect(
      asOwner(() =>
        columnFill.startColumnFill({
          databaseId: ids.databaseId,
          propertyId: ids.summary,
          instruction: "Again",
          rewrite: true,
          documentIds: ids.rows,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "COLUMN_FILL_ALREADY_RUNNING" });
    await expect(
      asOwner(() =>
        columnFill.retryColumnFillCell({
          fillId: first.id,
          documentId: ids.row(0),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "COLUMN_FILL_ALREADY_RUNNING" });
  });

  it("picks only a select column's existing options", async () => {
    const ids = await fixture(1);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.kind,
        instruction: "What kind of article is this?",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    expect(String(agents.spawned[0]?.instructions)).toContain("Guide, News");
    const row = ids.row(0);
    await expect(
      asOwner(() =>
        columnFill.fillColumnCell(
          { fillId: fill.id, documentId: row, value: "Opinion" },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "COLUMN_FILL_INVALID_VALUE" });
    expect(await cellValue(row, ids.kind)).toBeNull();

    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "Guide" },
        undefined,
      ),
    );
    expect(await cellValue(row, ids.kind)).toBe("kind-guide");
  });

  it("stops by letting running rows finish and skipping the rest", async () => {
    const ids = await fixture(7);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    const stopped = await asOwner(() => columnFill.stopColumnFill(fill.id));
    expect(stopped.status).toBe("stopping");
    let statuses = await cells(fill.id);
    expect(statuses.get(ids.row(5))).toBe("skipped");
    expect(statuses.get(ids.row(6))).toBe("skipped");

    for (const row of ids.rows.slice(0, 5)) {
      await asOwner(() =>
        columnFill.fillColumnCell(
          { fillId: fill.id, documentId: row, value: "Done" },
          undefined,
        ),
      );
    }
    statuses = await cells(fill.id);
    expect(running(statuses)).toHaveLength(0);
    expect(agents.spawned).toHaveLength(5);
    expect(
      (await asOwner(() => columnFill.readColumnFill(fill.id))).status,
    ).toBe("stopped");
  });

  it("marks a row whose agent stopped without saving, then tries it again", async () => {
    const ids = await fixture(6);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });

    const read = await asOwner(() => columnFill.readColumnFill(fill.id));
    const failed = found(
      read.cells.find((cell) => cell.documentId === ids.rows[0]),
      "First cell",
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: "The model refused.",
      agentThreadId: "thread-1",
    });
    expect((await cells(fill.id)).get(ids.row(5))).toBe("running");
    expect(agents.spawned).toHaveLength(6);

    await asOwner(() =>
      columnFill.retryColumnFillCell({
        fillId: fill.id,
        documentId: ids.row(0),
      }),
    );
    expect((await cells(fill.id)).get(ids.row(0))).toBe("waiting");
    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(1), value: "Done" },
        undefined,
      ),
    );
    expect((await cells(fill.id)).get(ids.row(0))).toBe("running");
    expect(agents.spawned).toHaveLength(7);
  });

  it("says AI isn't set up before starting anything", async () => {
    const ids = await fixture(2);
    agents.aiReady = false;
    await expect(
      asOwner(() =>
        columnFill.startColumnFill({
          databaseId: ids.databaseId,
          propertyId: ids.summary,
          instruction: "Summarize",
          rewrite: false,
          documentIds: ids.rows,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "AI_SETUP_REQUIRED" });
    expect(agents.spawned).toHaveLength(0);
    const fills = await getDb()
      .select()
      .from(schema.contentColumnFills)
      .where(eq(schema.contentColumnFills.databaseId, ids.databaseId));
    expect(fills).toHaveLength(0);
  });
});
