import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  chartSeriesFrom,
  resolveChartDataframe,
} from "../../app/components/notebook/chart-config.js";
import {
  chartCellContentsSchema,
  type CellDraft,
} from "../../app/lib/model/contracts.js";
import { withFixedClock } from "./clock.js";
import { seedLegacyPublishedProject } from "./legacy-published-fixture.test-support.js";

const databasePath = join(
  tmpdir(),
  `analytics2-store-${process.pid}-${Date.now()}.pglite`,
);
const previousDatabaseUrl = process.env.DATABASE_URL;
const owner = "owner@example.test";
const otherOwner = "someone-else@example.test";
const orgId = "org-workspace-test";
const scope = { ownerEmail: owner, orgId };
const otherScope = { ownerEmail: otherOwner, orgId };

let store: typeof import("./projects-store.js");
let cellsStore: typeof import("./cells-store.js");
let runsStore: typeof import("./runs-store.js");
let collectionsStore: typeof import("./collections-store.js");
let seed: typeof import("./seed.js");
let dbModule: typeof import("../db/index.js");
let schemaModule: typeof import("../db/schema.js");

const base = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};

function markdown(id: string, markdown: string): CellDraft {
  return { ...base, id, kind: "markdown", markdown };
}

function sql(id: string, source: string, resultVariable: string): CellDraft {
  return {
    ...base,
    id,
    kind: "sql",
    source,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable,
    outputResult: true,
  };
}

function chart(id: string, dataframe: string): CellDraft {
  return {
    ...base,
    id,
    kind: "chart",
    dataframe,
    chartSpec: {
      mark: "bar",
      xField: "day",
      yField: "total",
      seriesField: null,
      title: "Revenue",
    },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  await (await import("../plugins/db.js")).default();
  store = await import("./projects-store.js");
  cellsStore = await import("./cells-store.js");
  runsStore = await import("./runs-store.js");
  collectionsStore = await import("./collections-store.js");
  seed = await import("./seed.js");
  dbModule = await import("../db/index.js");
  schemaModule = await import("../db/schema.js");
}, 180_000);

afterAll(async () => {
  try {
    await (await import("@agent-native/core/db")).closeDbExec();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    rmSync(databasePath, { recursive: true, force: true });
  }
});

describe("project store", () => {
  it("report A2-STALE-WORKING-DRAFT: rejects an edit after its draft stops being the working version", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Draft switched during edit",
      cells: [markdown("cel_stale_draft", "original")],
    });
    const cell = project.cells[0];
    if (!cell || cell.contents.kind !== "markdown")
      throw new Error("Markdown cell missing");
    const published = await seedLegacyPublishedProject(scope, project.id);
    if (!published.publishedVersionId)
      throw new Error("Published version missing");
    await dbModule
      .getDb()
      .update(schemaModule.projects)
      .set({ workingVersionId: published.publishedVersionId })
      .where(eq(schemaModule.projects.id, project.id));

    const result = await cellsStore.updateCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: cell.id,
      expectedUpdatedAt: cell.updatedAt,
      contents: { ...cell.contents, markdown: "late autosave" },
    });
    expect(result).toBeNull();
    const oldDraft = await cellsStore.readCells(
      scope,
      project.id,
      project.workingVersionId,
    );
    expect(oldDraft[0]?.contents).toMatchObject({ markdown: "original" });
    const current = await store.getProjectDocument(scope, project.id);
    expect(current?.cells[0]?.contents).toMatchObject({ markdown: "original" });
  });
  it("report A2-CELL-REVISION-COLLISION rejects a stale same-millisecond edit", async () => {
    await withFixedClock("2026-11-17T12:00:00.000Z", async () => {
      const project = await store.createProject({
        ...scope,
        title: "Concurrent edits",
        cells: [sql("cel_revision_collision", "select 1", "orders")],
      });
      const cell = project.cells[0];
      if (!cell || cell.contents.kind !== "sql")
        throw new Error("SQL cell missing");
      const input = {
        ...scope,
        projectId: project.id,
        versionId: project.workingVersionId,
        cellId: cell.id,
        expectedUpdatedAt: cell.updatedAt,
      };
      const first = await cellsStore.updateCell({
        ...input,
        contents: { ...cell.contents, source: "select 2" },
      });
      if (!first) throw new Error("First edit was rejected");
      expect(first.updatedAt).not.toBe(cell.updatedAt);
      const second = await cellsStore.updateCell({
        ...input,
        expectedUpdatedAt: first.updatedAt,
        contents: { ...cell.contents, source: "select 4" },
      });
      if (!second) throw new Error("Acknowledged edit was rejected");
      expect(second.updatedAt).not.toBe(first.updatedAt);
      const stale = await cellsStore.updateCell({
        ...input,
        contents: { ...cell.contents, source: "select 3" },
      });
      expect(stale).toBeNull();
      const saved = await cellsStore.readCells(
        scope,
        project.id,
        project.workingVersionId,
      );
      expect(saved[0]?.contents).toMatchObject({
        kind: "sql",
        source: "select 4",
      });
    });
  });
  it("report A2-REORDER-STALE-CONTENTS preserves an edit acknowledged before the move transaction", async () => {
    await withFixedClock("2026-11-17T12:00:00.000Z", async () => {
      const project = await store.createProject({
        ...scope,
        title: "Move during edit",
        cells: [
          markdown("cel_move_first", "first"),
          markdown("cel_move_edit", "old"),
        ],
      });
      const cell = project.cells[1];
      if (!cell || cell.contents.kind !== "markdown")
        throw new Error("Cell missing");
      const contents = cell.contents;
      const db = dbModule.getDb();
      const transaction = db.transaction.bind(db);
      let editedRevision = "";
      const intercepted = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (callback) => {
          const edited = await cellsStore.updateCell({
            ...scope,
            projectId: project.id,
            versionId: project.workingVersionId,
            cellId: cell.id,
            contents: { ...contents, markdown: "acknowledged edit" },
          });
          if (!edited) throw new Error("Edit rejected");
          editedRevision = edited.updatedAt;
          return transaction(callback);
        });
      try {
        const moved = await cellsStore.moveCell({
          ...scope,
          projectId: project.id,
          versionId: project.workingVersionId,
          cellId: cell.id,
          position: 0,
        });
        expect(moved.map((item) => item.id)).toEqual([
          cell.id,
          "cel_move_first",
        ]);
        const movedCell = moved[0];
        if (!movedCell) throw new Error("Moved cell missing");
        expect(movedCell.contents).toMatchObject({
          markdown: "acknowledged edit",
        });
        expect(Date.parse(movedCell.updatedAt)).toBeGreaterThan(
          Date.parse(editedRevision),
        );
        expect(
          await cellsStore.updateCell({
            ...scope,
            projectId: project.id,
            versionId: project.workingVersionId,
            cellId: cell.id,
            expectedUpdatedAt: editedRevision,
            contents: { ...contents, markdown: "stale edit" },
          }),
        ).toBeNull();
      } finally {
        intercepted.mockRestore();
      }
    });
  });
  it("creates a project with its cells in order", async () => {
    const project = await store.createProject({
      ...scope,
      title: "  Revenue review  ",
      description: "Monthly numbers",
      cells: [
        markdown("cel_a", "# Revenue"),
        sql("cel_b", "select 1", "orders"),
        chart("cel_c", "orders"),
      ],
    });

    expect(project.title).toBe("Revenue review");
    expect(project.cells.map((cell) => cell.contents.kind)).toEqual([
      "markdown",
      "sql",
      "chart",
    ]);
    const orders = project.cells.map((cell) => cell.contents.order);
    expect([...orders].sort()).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);

    const read = await store.getProjectDocument(scope, project.id);
    expect(read?.id).toBe(project.id);
    expect(read?.cells).toHaveLength(3);
  });

  it("keeps a project out of another account's workspace", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Private",
      cells: [markdown("cel_private", "secret")],
    });

    expect(await store.getProjectDocument(otherScope, project.id)).toBeNull();
    expect(await store.listProjects(otherScope)).toEqual([]);
    await expect(
      store.updateProject({
        ...otherScope,
        projectId: project.id,
        title: "hijack",
      }),
    ).rejects.toThrow();

    const stillThere = await store.getProjectDocument(scope, project.id);
    expect(stillThere?.title).toBe("Private");
  });

  it("adds a cell after a neighbour and moves it to the front", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Ordering",
      cells: [markdown("cel_one", "one"), markdown("cel_two", "two")],
    });
    const versionId = project.workingVersionId;

    const added = await cellsStore.addCell({
      ...scope,
      projectId: project.id,
      versionId,
      contents: markdown("cel_added", "added"),
      afterCellId: "cel_one",
    });
    let cells = await cellsStore.readCells(scope, project.id, versionId);
    expect(cells.map((cell) => cell.id)).toEqual([
      "cel_one",
      "cel_added",
      "cel_two",
    ]);

    cells = await cellsStore.moveCell({
      ...scope,
      projectId: project.id,
      versionId,
      cellId: added.id,
      position: 0,
    });
    expect(cells.map((cell) => cell.id)).toEqual([
      "cel_added",
      "cel_one",
      "cel_two",
    ]);
  });

  it("updates a cell's contents and deletes it", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Editing",
      cells: [sql("cel_edit", "select 1", "orders")],
    });
    const cell = project.cells[0];
    if (cell === undefined) throw new Error("the cell is missing");
    if (cell.contents.kind !== "sql") throw new Error("the cell is not SQL");

    const updated = await cellsStore.updateCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: cell.id,
      contents: { ...cell.contents, source: "select 2" },
    });
    if (updated === null) throw new Error("the updated cell is missing");
    expect(updated.contents.kind === "sql" && updated.contents.source).toBe(
      "select 2",
    );

    await cellsStore.deleteCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: cell.id,
    });
    const remaining = await cellsStore.readCells(
      scope,
      project.id,
      project.workingVersionId,
    );
    expect(remaining).toEqual([]);
  });

  // Retired 5bae60375d expectation ("skips a stored cell that a build cannot
  // parse"). Dropping an unreadable stored cell made a damaged project look
  // like a shorter, valid one. Missing data and unreadable data are different
  // states, so readCells now rejects with analytics_unreadable_stored_data.
  // The separate regression in model-repair.db.test.ts asserts that failure.
  it("reports a stored cell that a build cannot parse", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Unreadable row",
      cells: [markdown("cel_good", "good")],
    });
    const db = dbModule.getDb();
    await db.insert(schemaModule.cells).values({
      id: "cel_broken",
      projectId: project.id,
      versionId: project.workingVersionId,
      kind: "markdown",
      order: "z",
      contents: "not json",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(
      cellsStore.readCells(scope, project.id, project.workingVersionId),
    ).rejects.toMatchObject({ code: "analytics_unreadable_stored_data" });
  });

  it("moves a project to the trash and back", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Trash me",
      cells: [markdown("cel_trash", "bye")],
    });

    await store.updateProject({
      ...scope,
      projectId: project.id,
      trashed: true,
    });
    const live = await store.listProjects(scope);
    expect(live.some((row) => row.id === project.id)).toBe(false);
    const trashed = await store.listProjects({
      ...scope,
      trashed: true,
    });
    expect(trashed.some((row) => row.id === project.id)).toBe(true);

    await store.updateProject({
      ...scope,
      projectId: project.id,
      trashed: false,
    });
    const restored = await store.listProjects(scope);
    expect(restored.some((row) => row.id === project.id)).toBe(true);
  });

  it("filters the list by title, status and favourite", async () => {
    const unique = "Quarterly planning";
    const project = await store.createProject({
      ...scope,
      title: unique,
      cells: [markdown("cel_search", "plan")],
    });
    const found = await store.listProjects({
      ...scope,
      search: "quarterly",
    });
    expect(found.map((row) => row.id)).toEqual([project.id]);

    const { createStatus } = await import("./statuses-store.js");
    const status = await createStatus({ ...scope, name: "In review" });
    await store.updateProject({
      ...scope,
      projectId: project.id,
      favorited: true,
      statusId: status.id,
    });
    expect(
      (await store.listProjects({ ...scope, favorited: true })).map(
        (row) => row.id,
      ),
    ).toContain(project.id);
    expect(
      (await store.listProjects({ ...scope, statusId: status.id })).map(
        (row) => row.id,
      ),
    ).toEqual([project.id]);
  });

  it("publishes a new version and leaves the old one intact", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Publishing",
      cells: [
        markdown("cel_pub_one", "one"),
        sql("cel_pub_two", "select 1", "orders"),
      ],
    });
    const oldVersion = project.workingVersionId;

    const published = await seedLegacyPublishedProject(scope, project.id, "v1");
    expect(published.workingVersionId).toBe(oldVersion);
    expect(published.publishedVersionId).not.toBe(oldVersion);
    expect(published.cells.map((cell) => cell.contents.kind)).toEqual([
      "markdown",
      "sql",
    ]);
    expect(new Set(published.cells.map((cell) => cell.id)).size).toBe(2);

    const oldCells = await cellsStore.readCells(scope, project.id, oldVersion);
    expect(oldCells.map((cell) => cell.id)).toEqual([
      "cel_pub_one",
      "cel_pub_two",
    ]);
  });

  it("rejects direct cell mutations of a published version", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Immutable published cells",
      cells: [markdown("cel_immutable", "published")],
    });
    const published = await seedLegacyPublishedProject(scope, project.id);
    const versionId = published.publishedVersionId;
    if (!versionId) throw new Error("Published version missing");
    const [cell] = await cellsStore.readCells(scope, project.id, versionId);
    if (!cell || cell.contents.kind !== "markdown")
      throw new Error("Markdown cell missing");
    const target = { ...scope, projectId: project.id, versionId };
    const writes = [
      () =>
        cellsStore.addCell({
          ...target,
          contents: markdown("cel_injected", "draft"),
        }),
      () =>
        cellsStore.updateCell({
          ...target,
          cellId: cell.id,
          contents: { ...cell.contents, label: "draft" },
        }),
      () => cellsStore.moveCell({ ...target, cellId: cell.id, position: 0 }),
      () => cellsStore.deleteCell({ ...target, cellId: cell.id }),
    ];
    for (const write of writes)
      await expect(write()).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "project_version_read_only",
      });
    expect(await cellsStore.readCells(scope, project.id, versionId)).toEqual([
      cell,
    ]);
  });

  it("duplicates a project without sharing its cells", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Original",
      cells: [markdown("cel_dup", "copy me")],
    });
    const copy = await store.duplicateProject(scope, project.id);
    expect(copy.title).toBe("Original (copy)");
    expect(copy.id).not.toBe(project.id);
    expect(copy.cells).toHaveLength(1);
    expect(copy.cells[0]?.id).not.toBe("cel_dup");
    expect(
      copy.cells[0]?.contents.kind === "markdown" &&
        copy.cells[0].contents.markdown,
    ).toBe("copy me");
  });
});

describe("run outputs", () => {
  it("records a run and replaces the cell's shown output", async () => {
    const project = await store.createProject({
      ...scope,
      title: "Runs",
      cells: [sql("cel_run", "select 1", "orders")],
    });

    await runsStore.recordRun({
      ...scope,
      projectId: project.id,
      cellId: "cel_run",
      status: "complete",
      output: {
        type: "table",
        columns: [{ name: "total", type: "number" }],
        rows: [[1]],
        rowCount: 1,
        truncated: false,
      },
    });
    await runsStore.recordRun({
      ...scope,
      projectId: project.id,
      cellId: "cel_run",
      status: "complete",
      output: {
        type: "metric",
        value: 2,
        formatted: "2",
      },
    });

    const current = await runsStore.readCellOutput(
      scope,
      project.id,
      "cel_run",
    );
    expect(current?.output?.type).toBe("metric");
    const history = await runsStore.listRuns(scope, project.id);
    expect(history).toHaveLength(2);
    const outputs = await runsStore.readProjectOutputs(scope, project.id);
    expect(outputs["cel_run"]?.output?.type).toBe("metric");

    await runsStore.clearCellOutput(scope, project.id, "cel_run");
    expect(
      await runsStore.readCellOutput(scope, project.id, "cel_run"),
    ).toBeNull();
    expect(await runsStore.listRuns(scope, project.id)).toHaveLength(2);
  });
});

describe("collections", () => {
  it("nests folders and links projects to a collection", async () => {
    const folder = await collectionsStore.createCollection({
      ...scope,
      name: "Team",
      kind: "folder",
    });
    const child = await collectionsStore.createCollection({
      ...scope,
      name: "Analyses",
      parentId: folder.id,
    });
    const project = await store.createProject({
      ...scope,
      title: "In a collection",
      cells: [markdown("cel_coll", "hello")],
    });
    await collectionsStore.addProjectToCollection({
      ...scope,
      projectId: project.id,
      collectionId: child.id,
    });

    const tree = await collectionsStore.listCollections(scope);
    const parent = tree.find((node) => node.id === folder.id);
    expect(parent?.children.map((node) => node.id)).toEqual([child.id]);

    const inCollection = await store.listProjects({
      ...scope,
      collectionId: child.id,
    });
    expect(inCollection.map((row) => row.id)).toEqual([project.id]);

    await collectionsStore.removeProjectFromCollection({
      ...scope,
      projectId: project.id,
      collectionId: child.id,
    });
    expect(
      await store.listProjects({ ...scope, collectionId: child.id }),
    ).toEqual([]);
  });
});

describe("sample workspace", () => {
  const seedOwner = "new-account@example.test";
  const seedScope = { ownerEmail: seedOwner, orgId };

  it("creates the starting projects once and only once", async () => {
    const first = await seed.ensureSampleWorkspace(seedScope);
    expect(first.created).toBe(true);
    expect(first.projectIds).toHaveLength(3);

    const projects = await store.listProjects(seedScope);
    expect(projects.map((project) => project.title).sort()).toEqual([
      "Customer segments",
      "Revenue overview",
      "Signup funnel",
    ]);

    const revenue = projects.find(
      (project) => project.title === "Revenue overview",
    );
    if (revenue === undefined) throw new Error("the sample project is missing");
    const document = await store.getProjectDocument(seedScope, revenue.id);
    expect(document?.cells.length).toBeGreaterThan(3);

    const outputs = await runsStore.readProjectOutputs(seedScope, revenue.id);
    expect(
      outputs[seed.sampleCellId(seedScope, "revenue", "table")]?.output?.type,
    ).toBe("table");
    expect(
      outputs[seed.sampleCellId(seedScope, "revenue", "chart")]?.output?.type,
    ).toBe("chart");
    expect(
      outputs[seed.sampleCellId(seedScope, "revenue", "metric")]?.output?.type,
    ).toBe("metric");

    const seededCharts = [
      {
        slug: "revenue",
        projectId: revenue.id,
        cell: "chart",
      },
      {
        slug: "revenue",
        projectId: revenue.id,
        cell: "channel",
      },
      {
        slug: "segments",
        projectId: seed.sampleProjectId(seedScope, "segments"),
        cell: "chart",
      },
      {
        slug: "funnel",
        projectId: seed.sampleProjectId(seedScope, "funnel"),
        cell: "chart",
      },
    ] as const;
    for (const expected of seededCharts) {
      const document = await store.getProjectDocument(
        seedScope,
        expected.projectId,
      );
      const cellId = seed.sampleCellId(seedScope, expected.slug, expected.cell);
      const contents = document?.cells.find(
        (cell) => cell.id === cellId,
      )?.contents;
      const chart = chartCellContentsSchema.safeParse(contents);
      expect(chart.success, `${expected.projectId}/${expected.cell}`).toBe(
        true,
      );
      if (!chart.success) continue;

      const resolved = resolveChartDataframe(chart.data.dataframe, [], null);
      expect(resolved.status).toBe("ready");
      if (resolved.status !== "ready")
        throw new Error("Expected sample chart data");
      const series = chartSeriesFrom(chart.data.chartSpec, resolved.dataframe);
      expect(series.columns).toEqual([
        chart.data.chartSpec.xField,
        chart.data.chartSpec.yField,
      ]);
      expect(series.rows.length).toBeGreaterThan(0);

      const savedOutput = (
        await runsStore.readProjectOutputs(seedScope, expected.projectId)
      )[cellId]?.output;
      expect(savedOutput?.type).toBe("chart");
      if (savedOutput?.type !== "chart") continue;

      expect(savedOutput.columns).toEqual(series.columns);
      expect(savedOutput.rows).toEqual(series.rows);
    }

    const collections = await seedOwnerCollections();
    expect(
      collections.some((collection) => collection.name === "Starting point"),
    ).toBe(true);
    const sampleCollection = collections.find(
      (collection) => collection.id === seed.sampleCollectionId(seedScope),
    );
    expect(sampleCollection?.description).toBe(
      "Example projects built on the sample data.",
    );
    const memberships = await dbModule
      .getDb()
      .select({ projectId: dbModule.schema.projectCollections.projectId })
      .from(dbModule.schema.projectCollections)
      .where(
        eq(
          dbModule.schema.projectCollections.collectionId,
          seed.sampleCollectionId(seedScope),
        ),
      );
    expect(memberships.map((entry) => entry.projectId).sort()).toEqual(
      first.projectIds.slice().sort(),
    );

    const second = await seed.ensureSampleWorkspace(seedScope);
    expect(second).toEqual({ projectIds: [], created: false });
    expect(await store.listProjects(seedScope)).toHaveLength(3);

    async function seedOwnerCollections() {
      const tree = await collectionsStore.listCollections(seedScope);
      return tree;
    }
  });

  it("seeds the same content for two accounts", async () => {
    const other = "second-account@example.test";
    const otherSeedScope = { ownerEmail: other, orgId };
    await seed.ensureSampleWorkspace(otherSeedScope);
    const firstList = await store.listProjects(seedScope);
    const secondList = await store.listProjects(otherSeedScope);
    expect(secondList.map((project) => project.title)).toEqual(
      firstList.map((project) => project.title),
    );

    const firstDocument = await store.getProjectDocument(
      seedScope,
      seed.sampleProjectId(seedScope, "revenue"),
    );
    const secondDocument = await store.getProjectDocument(
      otherSeedScope,
      seed.sampleProjectId(otherSeedScope, "revenue"),
    );
    const shape = (document: typeof firstDocument) =>
      document?.cells.map((cell) => {
        const { id: _id, ...rest } = cell.contents;
        return rest;
      });
    expect(shape(secondDocument)).toEqual(shape(firstDocument));
  });

  it("repairs legacy seeded chart dataframe names when reading historical sample projects", async () => {
    await seed.ensureSampleWorkspace(seedScope);
    const legacyCharts = [
      {
        slug: "funnel",
        cell: "chart",
        legacyDataframe: "users_by_stage",
      },
      {
        slug: "segments",
        cell: "chart",
        legacyDataframe: "customers_by_segment",
      },
      {
        slug: "revenue",
        cell: "chart",
        legacyDataframe: "revenue_by_month",
      },
      {
        slug: "revenue",
        cell: "channel",
        legacyDataframe: "revenue_by_channel",
      },
    ] as const;

    for (const entry of legacyCharts) {
      const projectId = seed.sampleProjectId(seedScope, entry.slug);
      const cellId = seed.sampleCellId(seedScope, entry.slug, entry.cell);
      const document = await store.getProjectDocument(seedScope, projectId);
      const stored = document?.cells.find((cell) => cell.id === cellId);
      expect(stored?.contents.kind).toBe("chart");
      if (!stored || stored.contents.kind !== "chart") continue;

      const legacyCell = {
        ...stored,
        contents: {
          ...stored.contents,
          dataframe: entry.legacyDataframe,
        },
      };
      const repaired = seed.readSeededSampleCell(
        seedScope,
        legacyCell,
        undefined,
      );
      expect(repaired.cell.contents.kind).toBe("chart");
      if (repaired.cell.contents.kind !== "chart") continue;
      expect(repaired.cell.contents.dataframe).not.toBe(entry.legacyDataframe);

      const resolved = resolveChartDataframe(
        repaired.cell.contents.dataframe,
        [],
        null,
      );
      expect(resolved.status).toBe("ready");
      if (resolved.status !== "ready") continue;
      const series = chartSeriesFrom(
        repaired.cell.contents.chartSpec,
        resolved.dataframe,
      );
      const savedOutput = (
        await runsStore.readProjectOutputs(seedScope, projectId)
      )[cellId]?.output;
      expect(savedOutput?.type).toBe("chart");
      if (savedOutput?.type !== "chart") continue;
      expect(series.columns).toEqual(savedOutput.columns);
      expect(series.rows).toEqual(savedOutput.rows);

      const userEdited = {
        ...stored,
        contents: {
          ...stored.contents,
          dataframe: "sessions",
        },
      };
      const untouched = seed.readSeededSampleCell(
        seedScope,
        userEdited,
        undefined,
      );
      expect(untouched.cell.contents).toEqual(userEdited.contents);
    }
  });
});
