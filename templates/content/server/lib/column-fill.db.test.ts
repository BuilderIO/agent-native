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
  threads: new Map<string, unknown>(),
  onSpawn: undefined as
    | ((options: Record<string, unknown>) => Promise<void>)
    | undefined,
  onGetThread: undefined as (() => Promise<void>) | undefined,
  onReadGenerations: undefined as (() => Promise<void>) | undefined,
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
      agents.threads.set(`thread-${index}`, options.scope);
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
    getThread: vi.fn(async (id: string) => {
      const hook = agents.onGetThread;
      agents.onGetThread = undefined;
      await hook?.();
      return agents.threads.has(id)
        ? { id, scope: agents.threads.get(id) }
        : null;
    }),
    isAgentChatAiSetupReady: vi.fn(async () => agents.aiReady),
  };
});

vi.mock("../../actions/_property-generations.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../actions/_property-generations.js")
    >();
  return {
    ...actual,
    readPropertyGenerations: vi.fn(
      async (...args: Parameters<typeof actual.readPropertyGenerations>) => {
        const generations = await actual.readPropertyGenerations(...args);
        const hook = agents.onReadGenerations;
        agents.onReadGenerations = undefined;
        await hook?.();
        return generations;
      },
    ),
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
  agents.threads.clear();
  agents.aiReady = true;
  agents.onSpawn = undefined;
  agents.onGetThread = undefined;
  agents.onReadGenerations = undefined;
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
      scope: {
        type: "content-column-fill",
        id: `${fill.id}:${ids.row(2)}:0`,
      },
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
        run(1),
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
        run(1),
      ),
    );
    expect(late.status).toBe("kept");
    expect(await cellValue(first, ids.summary)).toBe("Mine");

    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: second, value: "Filled" },
        run(2),
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

  it("keeps a retry's value when a follow-up from the failed run's chat saves after it", async () => {
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
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });
    agents.onGetThread = async () => {
      await columnFill.retryColumnFillCell({
        fillId: fill.id,
        documentId: row,
      });
      await columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "From the retry" },
        run(2),
      );
    };

    const followUp = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "From the old chat" },
        chatTurn(1),
      ),
    );
    expect(followUp.message).toContain("nothing was saved");
    expect(await cellValue(row, ids.summary)).toBe("From the retry");
    expect((await cells(fill.id)).get(row)).toBe("filled");
  });

  it("treats a follow-up that lands as its cell is tried again as an edit", async () => {
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
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });
    agents.onGetThread = async () => {
      await columnFill.retryColumnFillCell({
        fillId: fill.id,
        documentId: row,
      });
    };
    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "From the old chat" },
        chatTurn(1),
      ),
    );
    expect((await cells(fill.id)).get(row)).toBe("running");

    const retried = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "From the retry" },
        run(2),
      ),
    );
    expect(retried.status).toBe("kept");
    expect(await cellValue(row, ids.summary)).toBe("From the old chat");
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

    await getDb()
      .update(schema.contentColumnFillCells)
      .set({ agentThreadId: null })
      .where(
        and(
          eq(schema.contentColumnFillCells.fillId, fill.id),
          eq(schema.contentColumnFillCells.documentId, ids.row(0)),
        ),
      );
    const beforeLinked = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(0), value: "Not mine" },
        run(2),
      ),
    );
    expect(beforeLinked.status).toBe("running");
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
      const [fillId, documentId] = (options.scope as { id: string }).id.split(
        ":",
      ) as [string, string];
      await columnFill.fillColumnCell(
        { fillId, documentId, value: "Quick" },
        run(agents.spawned.length),
      );
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
    expect(await cellValue(ids.row(0), ids.summary)).toBe("Quick");
  });

  it("lets a retried run save before it is recorded", async () => {
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
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });
    expect((await cells(fill.id)).get(ids.row(0))).toBe("failed");

    agents.onSpawn = async () => {
      await columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(0), value: "Second run" },
        run(agents.spawned.length),
      );
    };
    const retried = await asOwner(() =>
      columnFill.retryColumnFillCell({
        fillId: fill.id,
        documentId: ids.row(0),
      }),
    );
    expect(retried.cells[0]).toMatchObject({
      status: "filled",
      agentThreadId: "thread-2",
    });
    expect(await cellValue(ids.row(0), ids.summary)).toBe("Second run");
  });

  it("keeps a newer run's chat link when an older run's start returns late", async () => {
    const ids = await fixture(1);
    let retried = false;
    agents.onSpawn = async (options) => {
      if (retried) return;
      retried = true;
      const [fillId, documentId] = (options.scope as { id: string }).id.split(
        ":",
      ) as [string, string];
      await columnFill.fillColumnCell(
        { fillId, documentId, value: null, reason: "Empty page" },
        run(1),
      );
      await columnFill.retryColumnFillCell({ fillId, documentId });
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
    expect(agents.spawned).toHaveLength(2);
    expect(fill.cells[0]).toMatchObject({
      status: "running",
      agentThreadId: "thread-2",
    });
  });

  it("ignores an earlier run that starts late after Try again", async () => {
    const ids = await fixture(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let secondStarted!: () => void;
    const retryStarted = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    agents.onSpawn = async () => {
      if (agents.spawned.length === 1) {
        started();
        await gate;
      } else {
        secondStarted();
        await secondGate;
      }
    };
    const start = asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    await firstStarted;
    const scope = agents.spawned[0]?.scope as { id: string } | undefined;
    const fillId = scope?.id.split(":")[0] ?? "";
    const readCell = async () =>
      (
        await getDb()
          .select()
          .from(schema.contentColumnFillCells)
          .where(eq(schema.contentColumnFillCells.fillId, fillId))
      )[0];
    await getDb()
      .update(schema.contentColumnFillCells)
      .set({ status: "failed", error: "The agent didn't start." })
      .where(eq(schema.contentColumnFillCells.fillId, fillId));
    const retry = asOwner(() =>
      columnFill.retryColumnFillCell({ fillId, documentId: ids.row(0) }),
    );
    await retryStarted;
    release();
    await start;

    expect(await readCell()).toMatchObject({ attempt: 1, taskId: null });

    releaseSecond();
    await retry;
    const afterSecond = await readCell();
    expect(afterSecond).toMatchObject({
      attempt: 1,
      status: "running",
      taskId: "task-2",
      agentThreadId: "thread-2",
    });
  });

  it("goes past waiting cells that were all edited", async () => {
    const ids = await fixture(11);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    for (const index of [5, 6, 7, 8, 9]) {
      await asOwner(() =>
        setProperty.run({
          documentId: ids.row(index),
          databaseId: ids.databaseId,
          propertyId: ids.summary,
          value: "Mine",
        }),
      );
    }
    for (let index = 1; index <= 5; index += 1) {
      agents.statuses.set(`task-${index}`, "errored");
    }
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });

    const states = await cells(fill.id);
    expect(states.get(ids.row(5))).toBe("kept");
    expect(states.get(ids.row(9))).toBe("kept");
    expect(states.get(ids.row(10))).toBe("running");
    expect(agents.spawned).toHaveLength(6);
  });

  it("doesn't start a run for a row the owner can no longer edit", async () => {
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
    await getDb()
      .update(schema.documents)
      .set({ ownerEmail: "someone-else@example.com", visibility: "public" })
      .where(eq(schema.documents.id, ids.row(5)));
    for (let index = 1; index <= 5; index += 1) {
      agents.statuses.set(`task-${index}`, "errored");
    }
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });

    const read = await asOwner(() => columnFill.readColumnFill(fill.id));
    expect(
      read.cells.find((cell) => cell.documentId === ids.row(5)),
    ).toMatchObject({
      status: "failed",
      error: "You can no longer edit this row.",
    });
    expect(agents.spawned).toHaveLength(5);
  });

  it("stops saving to a row the person can no longer edit", async () => {
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
    await getDb()
      .update(schema.documents)
      .set({ ownerEmail: "someone-else@example.com", visibility: "public" })
      .where(eq(schema.documents.id, ids.row(0)));
    const saved = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(0), value: "Not allowed" },
        run(1),
      ),
    );
    expect(saved.status).toBe("failed");
    expect(await cellValue(ids.row(0), ids.summary)).toBeNull();
  });

  it("saves nothing without a run behind the save", async () => {
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
    const saved = await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(0), value: "Direct" },
        undefined,
      ),
    );
    expect(saved.status).toBe("running");
    expect(await cellValue(ids.row(0), ids.summary)).toBeNull();
  });

  it("keeps a value typed into a failed cell when it's tried again", async () => {
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
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });
    expect((await cells(fill.id)).get(ids.row(0))).toBe("failed");
    await asOwner(() =>
      setProperty.run({
        documentId: ids.row(0),
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        value: "Mine",
      }),
    );

    const retried = await asOwner(() =>
      columnFill.retryColumnFillCell({
        fillId: fill.id,
        documentId: ids.row(0),
      }),
    );
    expect(retried.cells[0]?.status).toBe("kept");
    expect(agents.spawned).toHaveLength(1);
    expect(await cellValue(ids.row(0), ids.summary)).toBe("Mine");
  });

  it("refuses a save from a cell's earlier run after Try again", async () => {
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
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });
    let stale: { status: string } | undefined;
    agents.onSpawn = async () => {
      stale = await columnFill.fillColumnCell(
        { fillId: fill.id, documentId: ids.row(0), value: "Stale" },
        run(1),
      );
    };

    await asOwner(() =>
      columnFill.retryColumnFillCell({
        fillId: fill.id,
        documentId: ids.row(0),
      }),
    );
    expect(stale?.status).toBe("running");
    expect(await cellValue(ids.row(0), ids.summary)).toBeNull();
  });

  it("tries a failed cell again once when two tries overlap", async () => {
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
    const retry = () =>
      columnFill.retryColumnFillCell({ fillId: fill.id, documentId: row });
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });
    agents.onReadGenerations = async () => {
      await retry();
      agents.statuses.set("task-2", "errored");
      await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });
    };

    const late = await asOwner(retry);
    expect(late.status).toBe("done");
    expect(late.cells[0]?.status).toBe("failed");
    expect(agents.spawned).toHaveLength(2);
  });

  it("stops starting rows between batches when the sweep is told to stop", async () => {
    const ids = await fixture(12);
    const fill = await asOwner(() =>
      columnFill.startColumnFill({
        databaseId: ids.databaseId,
        propertyId: ids.summary,
        instruction: "Summarize",
        rewrite: false,
        documentIds: ids.rows,
      }),
    );
    for (const task of [...agents.statuses.keys()]) {
      agents.statuses.set(task, "errored");
    }
    const sweep = new AbortController();
    agents.onSpawn = async () => {
      sweep.abort();
      throw new Error("No room.");
    };
    await columnFill.sweepColumnFills({
      deadlineAt: Date.now() + 10_000,
      signal: sweep.signal,
    });
    expect(agents.spawned).toHaveLength(10);
    const statuses = await cells(fill.id);
    expect(statuses.get(ids.row(9))).toBe("failed");
    expect(statuses.get(ids.row(10))).toBe("waiting");
    expect(statuses.get(ids.row(11))).toBe("waiting");
  });

  it("won't try a cell again while its fill is stopping", async () => {
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
    await asOwner(() => columnFill.stopColumnFill(fill.id));

    await expect(
      asOwner(() =>
        columnFill.retryColumnFillCell({
          fillId: fill.id,
          documentId: ids.row(0),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "COLUMN_FILL_STOPPING" });
    expect((await cells(fill.id)).get(ids.row(0))).toBe("failed");
  });

  it("fails a fill's next cells when its column can't be filled anymore", async () => {
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
    await getDb()
      .update(schema.documentPropertyDefinitions)
      .set({ type: "date" })
      .where(eq(schema.documentPropertyDefinitions.id, ids.summary));
    agents.statuses.set("task-1", "errored");
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });

    const read = await asOwner(() => columnFill.readColumnFill(fill.id));
    expect(
      read.cells.find((cell) => cell.documentId === ids.row(5)),
    ).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Fill with AI works on"),
    });
    expect(agents.spawned).toHaveLength(5);
  });

  it("stops a fill when its owner can no longer edit the collection", async () => {
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
    await getDb()
      .update(schema.documents)
      .set({ ownerEmail: "someone-else@example.com", visibility: "public" })
      .where(eq(schema.documents.id, ids.databaseDocumentId));
    await columnFill.sweepColumnFills({ deadlineAt: Date.now() + 10_000 });

    const read = await asOwner(() => columnFill.readColumnFill(fill.id));
    expect(read.status).toBe("stopping");
    expect((await cells(fill.id)).get(ids.row(5))).toBe("skipped");
    expect(agents.spawned).toHaveLength(5);
  });

  it("lists a running fill behind newer fills of other columns", async () => {
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
    const later = new Date(Date.now() + 60_000).toISOString();
    await getDb()
      .insert(schema.contentColumnFills)
      .values(
        Array.from({ length: 50 }, (_, index) => ({
          id: `${fill.id}-old-${index}`,
          ownerEmail: OWNER,
          orgId: null,
          databaseId: ids.databaseId,
          databaseDocumentId: ids.databaseDocumentId,
          propertyId: ids.kind,
          instruction: "Pick a kind",
          rewrite: false,
          status: "done",
          total: 0,
          createdAt: later,
          updatedAt: later,
        })),
      );

    const listed = await asOwner(() =>
      columnFill.listColumnFills(ids.databaseId),
    );
    expect(listed.map((item) => item.id)).toContain(fill.id);
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
          run(1),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "COLUMN_FILL_INVALID_VALUE" });
    expect(await cellValue(row, ids.kind)).toBeNull();

    await asOwner(() =>
      columnFill.fillColumnCell(
        { fillId: fill.id, documentId: row, value: "Guide" },
        run(1),
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

    for (const [index, row] of ids.rows.slice(0, 5).entries()) {
      await asOwner(() =>
        columnFill.fillColumnCell(
          { fillId: fill.id, documentId: row, value: "Done" },
          run(index + 1),
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
        run(2),
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
