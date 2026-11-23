import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  getRunTurnRef,
  runWithRequestContext,
} from "@agent-native/core/server";
import { putOrgSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerChatThreadsShareable } from "../../../packages/core/dist/chat-threads/store.js";
import type { ProjectDocument } from "../app/lib/model/contracts.js";
import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  createProject,
  duplicateProject,
  getProjectDocument,
} from "../server/model/projects-store.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import addProjectCell from "./add-project-cell.js";
import createNotebookThread from "./create-notebook-thread.js";
import createProjectAction from "./create-project.js";
import decideNotebookPendingChanges from "./decide-notebook-pending-changes.js";
import deleteProjectCell from "./delete-project-cell.js";
import getNotebookPendingChanges from "./get-notebook-pending-changes.js";
import getProject from "./get-project.js";
import runProjectCell from "./run-project-cell.js";
import saveProjectCell from "./save-project-cell.js";

const round = mkdtempSync(join(tmpdir(), "add-project-cell-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "add-cell-owner@example.test";
const orgId = `qa-add-cell-${randomUUID()}`;

const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};

function asActor<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA add-cell account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

async function toolContext(project: ProjectDocument) {
  const head = project.draftHead;
  if (!head) throw new Error("Expected an accepted draft head");
  const { threadId } = await asActor(() =>
    createNotebookThread.run(
      {
        projectId: project.id,
        head,
        opId: randomUUID(),
      },
      context,
    ),
  );
  const runId = randomUUID();
  const turnId = randomUUID();
  await getRunTurnRef(runId);
  await getDbExec().execute({
    sql: "INSERT INTO agent_runs (id, thread_id, status, started_at, turn_id) VALUES (?, ?, 'completed', ?, ?)",
    args: [runId, threadId, Date.now(), turnId],
  });
  return {
    ...context,
    caller: "tool" as const,
    threadId,
    runId,
    turnId,
    toolCallId: randomUUID(),
  };
}

beforeAll(async () => {
  registerChatThreadsShareable();
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_add_cell_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA add-cell workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/add-project-cell-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("add-project-cell kinds", () => {
  it("inherits the last accepted source after the cell that selected it is deleted", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Source preference",
    });
    await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "sql" }, context),
    );
    const added = await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "sql" }, context),
    );
    const selected = added.project.cells.find(
      ({ id }) => id === added.createdCellId,
    );
    if (selected?.contents.kind !== "sql")
      throw new Error("Expected a SQL cell");
    const contents = {
      ...selected.contents,
      dataConnectionId: null,
      connectionMode: "dataframes" as const,
    };
    await asActor(() =>
      saveProjectCell.run(
        { projectId: project.id, cellId: selected.id, contents },
        context,
      ),
    );
    await asActor(() =>
      deleteProjectCell.run(
        { projectId: project.id, cellId: selected.id },
        context,
      ),
    );
    const inherited = await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "sql" }, context),
    );
    expect(
      inherited.project.cells.find(({ id }) => id === inherited.createdCellId)
        ?.contents,
    ).toMatchObject({ dataConnectionId: null, connectionMode: "dataframes" });
  });

  it("report 1794945614.960449: stores the workspace default for manual and agent-created cells", async () => {
    await putOrgSetting(orgId, "analytics.data.default-connection", {
      id: SAMPLE_DATA_SOURCE_ID,
    });
    try {
      const project = await createProject({
        ownerEmail: owner,
        orgId,
        title: "Default",
      });
      const added = await asActor(() =>
        addProjectCell.run({ projectId: project.id, kind: "sql" }, context),
      );
      expect(added.project.cells[0]?.contents).toMatchObject({
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      });
      const readback = await getProjectDocument(
        { ownerEmail: owner, orgId },
        project.id,
      );
      expect(readback?.cells[0]?.contents).toMatchObject({
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      });
      const draft = added.project.cells.at(0)?.contents;
      if (!draft || draft.kind !== "sql") throw new Error("SQL cell missing");
      const { id: _id, order: _order, ...contents } = draft;
      const created = await asActor(() =>
        createProjectAction.run(
          { cells: [{ ...contents, dataConnectionId: null }] },
          { ...context, caller: "agent" },
        ),
      );
      const agentProject = await getProjectDocument(
        { ownerEmail: owner, orgId },
        created.id,
      );
      expect(agentProject?.cells[0]?.contents).toMatchObject({
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      });
      const imported = await asActor(() =>
        createProjectAction.run(
          {
            cells: [
              {
                ...contents,
                dataConnectionId: null,
                connectionMode: "dataframes",
              },
            ],
          },
          { ...context, caller: "agent" },
        ),
      );
      const importedProject = await getProjectDocument(
        { ownerEmail: owner, orgId },
        imported.id,
      );
      expect(importedProject?.cells[0]?.contents).toMatchObject({
        dataConnectionId: null,
        connectionMode: "dataframes",
      });
    } finally {
      await putOrgSetting(orgId, "analytics.data.default-connection", {
        id: null,
      });
    }
  });
  it("stages one named SQL cell for a tool retry and keeps the accepted notebook unchanged", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Named SQL",
    });
    const input = addProjectCell.schema.parse({
      projectId: project.id,
      kind: "sql",
      name: "base",
      source: "SELECT 1 AS value",
    });
    const tool = await toolContext(project);
    const added = await asActor(() => addProjectCell.run(input, tool));
    const replayed = await asActor(() =>
      addProjectCell.run(input, { ...tool, caller: "mcp" }),
    );
    expect(added.createdCellId).toBeDefined();
    expect(added.proposalIds).toHaveLength(1);
    expect(replayed.createdCellId).toBe(added.createdCellId);
    expect(replayed.proposalIds).toEqual(added.proposalIds);
    await expect(
      asActor(() => addProjectCell.run({ ...input, source: "SELECT 2" }, tool)),
    ).rejects.toMatchObject({ errorCode: "intent_mismatch" });
    const accepted = await getProjectDocument(
      { ownerEmail: owner, orgId },
      project.id,
    );
    expect(accepted?.cells).toEqual([]);
    const pending = await asActor(() =>
      getNotebookPendingChanges.run(
        {
          projectId: project.id,
          threadId: tool.threadId,
        },
        context,
      ),
    );
    expect(pending.changes).toHaveLength(1);
    expect(pending.changes[0]?.after?.cells[0]?.contents).toMatchObject({
      kind: "sql",
      label: "base",
      resultVariable: "base",
      source: "SELECT 1 AS value",
    });
    await expect(
      asActor(() =>
        addProjectCell.run(
          { projectId: project.id, kind: "text", source: "SELECT 1" },
          { ...context, caller: "tool" },
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "cell_source_kind_invalid",
    });
  });
  it("report 1794945614.960449: rejects contradictory SQL source selection on create and save", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Contradictory source",
    });
    const added = await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "sql" }, context),
    );
    const cell = added.project.cells.at(0);
    if (!cell || cell.contents.kind !== "sql")
      throw new Error("SQL cell missing");
    const contradictory = {
      ...cell.contents,
      dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      connectionMode: "dataframes" as const,
    };
    await expect(
      asActor(() =>
        saveProjectCell.run(
          { projectId: project.id, cellId: cell.id, contents: contradictory },
          context,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_cell_connection" });
    const { id: _id, order: _order, ...draft } = contradictory;
    await expect(
      asActor(() => createProjectAction.run({ cells: [draft] }, context)),
    ).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "invalid_project_starter",
      details: { field: "starter" },
    });
  });
  it("retains a unique requested SQL variable ending in a number", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "SQL variable",
    });
    const added = await asActor(() =>
      addProjectCell.run(
        { projectId: project.id, kind: "sql", name: "base1" },
        context,
      ),
    );
    expect(added.project.cells[0]?.contents).toMatchObject({
      label: "base1",
      resultVariable: "base1",
    });
  });
  it("accepts a SQL cell label with spaces", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "SQL label",
    });
    const added = await asActor(() =>
      addProjectCell.run(
        { projectId: project.id, kind: "sql", name: "Monthly revenue" },
        context,
      ),
    );
    expect(added.project.cells[0]?.contents).toMatchObject({
      label: "Monthly revenue",
      resultVariable: "dataframe",
    });
  });
  it("inserts before the first cell and rejects invalid or conflicting anchors", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Prepend",
    });
    const initial = await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "markdown" }, context),
    );
    const anchor = initial.createdCellId;
    if (!anchor) throw new Error("Initial cell was not created.");
    const inserted = await asActor(() =>
      addProjectCell.run(
        {
          projectId: project.id,
          kind: "input",
          inputType: "DROPDOWN",
          beforeCellId: anchor,
        },
        context,
      ),
    );
    expect(inserted.project.cells.map((cell) => cell.id)).toEqual([
      inserted.createdCellId,
      anchor,
    ]);
    expect(inserted.project.cells[0]?.contents).toMatchObject({
      kind: "input",
      inputType: "DROPDOWN",
    });
    await expect(
      asActor(() =>
        addProjectCell.run(
          { projectId: project.id, kind: "markdown", beforeCellId: "missing" },
          context,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asActor(() =>
        addProjectCell.run(
          {
            projectId: project.id,
            kind: "markdown",
            beforeCellId: anchor,
            afterCellId: anchor,
          },
          context,
        ),
      ),
    ).rejects.toThrow();
  });
  it("adds markdown and text cells after the current ones", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA add cell",
    });
    const withMarkdown = await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "markdown" }, context),
    );
    expect(withMarkdown.project.cells.at(-1)?.contents).toMatchObject({
      kind: "markdown",
      markdown: "",
    });
    expect(withMarkdown.createdCellId).toBe(
      withMarkdown.project.cells.at(-1)?.id,
    );
    const withText = await asActor(() =>
      addProjectCell.run({ projectId: project.id, kind: "text" }, context),
    );
    expect(withText.project.cells.at(-1)?.contents).toMatchObject({
      kind: "text",
      text: "",
    });
    expect(withText.createdCellId).toBe(withText.project.cells.at(-1)?.id);
  });

  it("places a chosen component as a component import cell", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA add component",
    });
    const added = await asActor(() =>
      addProjectCell.run(
        {
          projectId: project.id,
          kind: "component-import",
          name: "Revenue block",
          componentVersionId: "cmp_revenue",
        },
        context,
      ),
    );
    expect(added.project.cells.at(-1)?.contents).toMatchObject({
      kind: "component-import",
      componentVersionId: "cmp_revenue",
      title: "Revenue block",
    });
  });

  it("adds a dbt Semantic Layer cell with its connection and an empty metric choice", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA add semantic layer cell",
    });
    const bare = await asActor(() =>
      addProjectCell.run(
        { projectId: project.id, kind: "dbt-metric" },
        context,
      ),
    );
    expect(bare.project.cells.at(-1)?.contents).toMatchObject({
      kind: "dbt-metric",
      dataConnectionId: null,
      metrics: [],
      selectedTimegrain: null,
      selectedDimensions: [],
    });
    const bound = await asActor(() =>
      addProjectCell.run(
        {
          projectId: project.id,
          kind: "dbt-metric",
          dataConnectionId: SAMPLE_DATA_SOURCE_ID,
        },
        context,
      ),
    );
    expect(bound.project.cells.at(-1)?.contents).toMatchObject({
      kind: "dbt-metric",
      dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    });
    await expect(
      asActor(() =>
        addProjectCell.run(
          {
            projectId: project.id,
            kind: "markdown",
            dataConnectionId: SAMPLE_DATA_SOURCE_ID,
          },
          context,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "cell_source_kind_invalid" });
  });

  it("creates a dropdown input with its parameter type and clears state", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA input cell",
    });
    const added = await asActor(() =>
      addProjectCell.run(
        { projectId: project.id, kind: "input", inputType: "DROPDOWN" },
        context,
      ),
    );
    expect(added.project.cells.at(-1)?.contents).toMatchObject({
      kind: "input",
      name: "input_1",
      inputType: "DROPDOWN",
      defaultValueString: "",
      options: [],
      optional: false,
    });
  });

  it("allocates unique SQL input names even when two cells are added together", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA input numbering",
    });
    await Promise.all(
      (["CHECKBOX", "TEXT_INPUT"] as const).map((inputType) =>
        asActor(() =>
          addProjectCell.run(
            { projectId: project.id, kind: "input", inputType },
            context,
          ),
        ),
      ),
    );
    const document = await getProjectDocument(
      { ownerEmail: owner, orgId },
      project.id,
    );
    expect(document?.cells.map((cell) => cell.contents)).toEqual([
      expect.objectContaining({ kind: "input", name: "input_1" }),
      expect.objectContaining({ kind: "input", name: "input_2" }),
    ]);
  });

  it("repairs a legacy input name and binds the saved name in notebook SQL", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA legacy input name",
      cells: [
        {
          kind: "input",
          label: "Channel",
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          name: "Input 1",
          inputType: "TEXT_INPUT",
          defaultValueString: "partner",
        },
      ],
    });
    const input = project.cells.at(0);
    if (input?.contents.kind !== "input") throw new Error("Input cell missing");
    const contents = input.contents;
    const rename = (name: string) =>
      asActor(() =>
        saveProjectCell.run(
          {
            projectId: project.id,
            cellId: input.id,
            contents: { ...contents, name },
          },
          context,
        ),
      );
    await expect(rename("channel pick")).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "project_input_name_invalid",
    });
    const renamed = await rename("channel_pick");
    expect(renamed.project.cells[0]?.contents).toMatchObject({
      label: "Channel",
      name: "channel_pick",
      defaultValueString: "partner",
    });
    await expect(
      asActor(() =>
        addProjectCell.run(
          {
            projectId: project.id,
            kind: "input",
            inputType: "TEXT_INPUT",
            name: "channel_pick",
          },
          context,
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 409, errorCode: "name_taken" });
    const added = await asActor(() =>
      addProjectCell.run(
        {
          projectId: project.id,
          kind: "sql",
          source: "SELECT {{ channel_pick }} AS channel FROM orders LIMIT 1",
        },
        context,
      ),
    );
    if (!added.createdCellId) throw new Error("SQL cell missing");
    const cellId = added.createdCellId;
    const result = await asActor(() =>
      runProjectCell.run({ projectId: project.id, cellId }, context),
    );
    expect(result.output).toMatchObject({
      type: "table",
      rows: [["partner"]],
    });
  });

  it("creates a multiselect input that starts with an empty selection", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA multiselect",
    });
    const added = await asActor(() =>
      addProjectCell.run(
        { projectId: project.id, kind: "input", inputType: "MULTISELECT" },
        context,
      ),
    );
    expect(added.project.cells.at(-1)?.contents).toMatchObject({
      kind: "input",
      inputType: "MULTISELECT",
      defaultValueString: "[]",
      options: [],
    });
  });

  it("refuses an input cell without a parameter type", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA input type required",
    });
    await expect(
      asActor(() =>
        addProjectCell.run({ projectId: project.id, kind: "input" }, context),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "input_type_required",
    });
  });

  it("keeps the current tab in place when a bound thread stages a cell", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA tab navigation",
    });
    const tool = await toolContext(project);
    const browserTabId = `qa-tab-${randomUUID()}`;
    const actor = {
      userEmail: owner,
      orgId,
      authUserId: owner,
      isSyntheticTraffic: true,
    };
    await runWithRequestContext(
      { ...actor, run: { browserTabId } },
      async () => {
        const result = await addProjectCell.run(
          { projectId: project.id, kind: "markdown" },
          tool,
        );
        expect(result.proposalIds).toHaveLength(1);
        expect(result.project.cells).toEqual([]);
        expect(result.navigation).toBeUndefined();
        expect(await readAppStateForCurrentTab("navigate")).toBeNull();
      },
    );
    await runWithRequestContext(
      { ...actor, run: { browserTabId: `other-${randomUUID()}` } },
      async () => {
        expect(await readAppStateForCurrentTab("navigate")).toBeNull();
      },
    );
  });
});

it("binds Single value at insertion and persists a tool-created metric only after review", async () => {
  const { id: projectId } = await createProject({
    ownerEmail: owner,
    orgId,
    title: "Single value",
  });
  const add = (args: Parameters<typeof addProjectCell.run>[0]) =>
    asActor(() =>
      addProjectCell.run(addProjectCell.schema.parse(args), context),
    );
  const blank = await add({ projectId, kind: "metric" });
  expect(blank.project.cells[0]?.contents).toMatchObject({
    kind: "metric",
    metricConfig: { version: 1, source: null, mode: "aggregate" },
  });
  const sql = await add({ projectId, kind: "sql", name: "sales" });
  const cellId = sql.createdCellId;
  if (!cellId) throw new Error("Missing sales cell");
  const notebook = await add({
    projectId,
    kind: "metric",
    afterCellId: cellId,
  });
  const source = { cellId, exportId: "result" };
  expect(notebook.project.cells.at(-1)?.contents).toMatchObject({
    kind: "metric",
    metricConfig: { source, fieldId: null, aggregation: null },
  });

  const tool = await toolContext(notebook.project);
  const metricConfig = {
    version: 1,
    revision: 0,
    source,
    fieldId: null,
    mode: "row",
    aggregation: null,
    row: -1,
    title: "Sales",
    format: "currency",
  };
  const args = addProjectCell.schema.parse({
    projectId,
    kind: "metric",
    metricConfig,
  });
  const staged = await asActor(() => addProjectCell.run(args, tool));
  expect(staged.project.cells).toHaveLength(3);
  expect(staged.proposalIds).toHaveLength(1);
  const key = { projectId, threadId: tool.threadId };
  const pendingChanges = () =>
    asActor(() => getNotebookPendingChanges.run(key, context));
  const pending = await pendingChanges();
  expect(pending.changes[0]?.after?.cells).toContainEqual(
    expect.objectContaining({
      contents: expect.objectContaining({ metricConfig }),
    }),
  );
  const confirm = (review: typeof pending) =>
    asActor(() =>
      decideNotebookPendingChanges.run(
        {
          ...key,
          opId: randomUUID(),
          expectedOverlayRevision: review.overlayRevision,
          observedHead: review.acceptedHead,
          selection: {
            kind: "all",
            reviewedSetDigest: review.reviewedSetDigest,
          },
          decision: "confirm",
        },
        context,
      ),
    );
  const read = () => asActor(() => getProject.run({ projectId }, context));
  await confirm(pending);
  const metric = (await read()).project.cells.find(
    ({ id }) => id === staged.createdCellId,
  );
  if (metric?.contents.kind !== "metric" || !metric.contents.metricConfig)
    throw new Error("Missing accepted metric");
  expect(metric.contents.metricConfig).toEqual(metricConfig);
  const changed = { ...metric.contents.metricConfig, revision: 1, row: 0 };
  const update = await asActor(() =>
    saveProjectCell.run(
      {
        projectId,
        cellId: metric.id,
        contents: { ...metric.contents, metricConfig: changed },
        expectedUpdatedAt: metric.updatedAt,
      },
      { ...tool, toolCallId: randomUUID() },
    ),
  );
  expect(update.editStatus).toBe("pending_review");
  expect(
    update.project.cells.find(({ id }) => id === metric.id)?.contents,
  ).toMatchObject({ metricConfig });
  await confirm(await pendingChanges());
  expect(
    (await read()).project.cells.find(({ id }) => id === metric.id)?.contents,
  ).toMatchObject({ metricConfig: changed });

  const copy = await duplicateProject({ ownerEmail: owner, orgId }, projectId);
  const copiedSource = copy.cells.find(
    ({ contents }) => contents.kind === "sql",
  );
  expect(copiedSource?.id).toBeDefined();
  expect(copiedSource?.id).not.toBe(cellId);
  expect(copy.cells.at(-1)?.contents).toMatchObject({
    metricConfig: {
      ...changed,
      source: { ...source, cellId: copiedSource?.id },
    },
  });
});

it("restores a deleted cell at the requested position with its identity and settings", async () => {
  const project = await createProject({
    ownerEmail: owner,
    orgId,
    title: "Restore cell",
  });
  const { createdCellId, project: draft } = await asActor(() =>
    addProjectCell.run(
      {
        projectId: project.id,
        kind: "sql",
        source: "select * from orders",
      },
      context,
    ),
  );
  const cell = draft.cells.at(0);
  if (!cell || !createdCellId) throw Error("Missing SQL cell");
  const trailing = await asActor(() =>
    addProjectCell.run({ projectId: project.id, kind: "text" }, context),
  );
  const removed = await asActor(() =>
    deleteProjectCell.run(
      { projectId: project.id, cellId: createdCellId },
      context,
    ),
  );
  expect(removed.project.cells.map((item) => item.id)).toEqual([
    trailing.createdCellId,
  ]);
  if (!trailing.createdCellId) throw Error("Missing trailing cell");
  await asActor(() =>
    addProjectCell.run(
      {
        projectId: project.id,
        kind: "sql",
        beforeCellId: trailing.createdCellId,
        restore: cell.contents,
      },
      context,
    ),
  );
  const saved = await getProjectDocument(
    { ownerEmail: owner, orgId },
    project.id,
  );
  expect(saved?.cells.map((item) => item.id)).toEqual([
    createdCellId,
    trailing.createdCellId,
  ]);
  expect(saved?.cells[0]?.contents).toMatchObject({
    kind: "sql",
    source: "select * from orders",
    resultVariable: "dataframe",
  });
});

it.each(["unchanged", "changed"])(
  "undo restores a deleted SQL output only when its input is unchanged (%s)",
  async (inputState) => {
    const { id: projectId } = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Restore query result",
    });
    const input = await asActor(() =>
      addProjectCell.run(
        { projectId, kind: "input", name: "channel", inputType: "TEXT_INPUT" },
        context,
      ),
    );
    const contents = input.project.cells.at(0)?.contents;
    if (contents?.kind !== "input") throw new Error("Missing input cell");
    const setInput = (value: string) =>
      asActor(() =>
        saveProjectCell.run(
          {
            projectId,
            cellId: contents.id,
            contents: { ...contents, defaultValueString: value },
          },
          context,
        ),
      );
    await setInput("direct");
    const created = await asActor(() =>
      addProjectCell.run(
        {
          projectId,
          kind: "sql",
          source: "select {{ channel }} as channel from orders limit 1",
        },
        context,
      ),
    );
    const query = created.project.cells.at(-1)?.contents;
    if (query?.kind !== "sql") throw new Error("Missing SQL cell");
    const cellId = query.id;
    const read = () => asActor(() => getProject.run({ projectId }, context));
    await asActor(() => runProjectCell.run({ projectId, cellId }, context));
    const original = (await read()).outputs[cellId];
    expect(original.output).toMatchObject({
      type: "table",
      rows: [["direct"]],
    });

    const deletion = { projectId, cellId, keepOutputForUndo: true };
    const removed: { outputUndoToken?: string; project: unknown } =
      await asActor(() => deleteProjectCell.run(deletion, context));
    expect((await read()).outputs[cellId]).toBeUndefined();
    if (inputState === "changed") await setInput("partner");
    const restoration = {
      projectId,
      kind: "sql" as const,
      restore: query,
      outputUndoToken: removed.outputUndoToken,
    };
    await asActor(() => addProjectCell.run(restoration, context));
    const settled = await read();
    expect(settled.project.cells.some((cell) => cell.id === cellId)).toBe(true);
    expect(settled.outputs[cellId]).toEqual(
      inputState === "unchanged" ? original : undefined,
    );
  },
);
