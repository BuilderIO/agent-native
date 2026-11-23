import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { fail } from "@agent-native/core/action";
import {
  arbitraryFromJsonSchema,
  checkActionProperties,
} from "@agent-native/core/action-properties";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { and, eq } from "@agent-native/core/db/schema";
import {
  organizations,
  orgMembers,
  ORG_MIGRATIONS,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { upsertWorkspaceConnection } from "@agent-native/core/workspace-connections";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ensureChatThreadTables,
  registerChatThreadsShareable,
} from "../../../packages/core/dist/chat-threads/store.js";
import { getDb, schema } from "../server/db/index.js";
import { updateCell } from "../server/model/cells-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { encodeJsonColumn } from "../server/model/json-column.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { getProjectQueryState } from "../server/model/project-query.js";
import { getProjectDocument } from "../server/model/projects-store.js";
import { createProject } from "../server/model/projects-store.js";
import {
  clearCellOutput,
  listRuns,
  readCellOutput,
  readProjectOutputs,
} from "../server/model/runs-store.js";
import * as sampleQueryModule from "../server/model/sample-query.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";
import addCell from "./add-project-cell.js";
import cancelCell from "./cancel-project-cell.js";
import deleteCell from "./delete-project-cell.js";
import formatNotebookSql from "./format-notebook-sql.js";
import getProject from "./get-project.js";
import runCell from "./run-project-cell.js";
import runPublishedCell from "./run-published-project-cell.js";
import saveCell from "./save-project-cell.js";

const provider = vi.hoisted(() => vi.fn());
const cancelProvider = vi.hoisted(() => vi.fn());
const assertDefaultGrant = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const workspaceDefault = vi.hoisted(() => vi.fn().mockResolvedValue(null));
// Replace only the warehouse call. The module's other exports (the builtin
// sample-connection check in particular) are still imported by the code under
// test, so a wholesale mock makes them undefined rather than stubbed.
vi.mock("../server/model/data-connections.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/model/data-connections.js")
  >()),
  defaultDataConnectionId: workspaceDefault,
  executeConnectionQuery: provider,
  cancelConnectionQuery: cancelProvider,
  canReadConnectionResults: vi.fn().mockResolvedValue(true),
}));
vi.mock("../server/lib/project-action-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/project-action-access.js")
  >()),
  assertGrantedDataConnection: assertDefaultGrant,
}));
vi.mock(
  "../server/lib/org-bigquery-credentials.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/lib/org-bigquery-credentials.js")
    >()),
    getOrganizationBigQueryCredentialReadiness: async () => "configured",
  }),
);
const round = mkdtempSync(join(tmpdir(), "project-query-"));
const oldDatabase = process.env.DATABASE_URL;
const email = "query-owner@example.test";
const peer = "query-peer@example.test";
const member = "query-member@example.test";
const orgId = `qa-query-${randomUUID()}`;
const otherOrg = `qa-query-${randomUUID()}`;
const scope = { ownerEmail: email, orgId };
const context = {
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
};
const actor = <T>(call: () => T, actorEmail = email, actorOrg = orgId) =>
  runWithRequestContext(
    { userEmail: actorEmail, orgId: actorOrg, isSyntheticTraffic: true },
    call,
  );
function page(overrides: Record<string, unknown> = {}) {
  return {
    jobComplete: true,
    status: "complete",
    jobReference: { projectId: "qa-warehouse", jobId: "qa-job" },
    columns: [{ name: "precise_id", type: "INTEGER" }],
    rows: [["9007199254740993"]],
    totalRows: "1",
    pageToken: null,
    hasNextPage: false,
    totalBytesProcessed: "0",
    ...overrides,
  };
}
async function fixture(
  overrides: {
    source?: string;
    dataConnectionId?: string | null;
    ownerEmail?: string;
  } = {},
) {
  const cellId = `cell-${randomUUID()}`;
  const project = await createProject({
    ...scope,
    ownerEmail: overrides.ownerEmail ?? email,
    title: "QA test query",
    cells: [
      {
        id: cellId,
        kind: "sql",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: overrides.source ?? "SELECT 9007199254740993 AS precise_id",
        dataConnectionId:
          overrides.dataConnectionId === undefined
            ? "qa-connection"
            : overrides.dataConnectionId,
        databaseSchema: null,
        resultVariable: "dataframe",
        outputResult: true,
      },
    ],
  });
  return { projectId: project.id, cellId };
}
beforeAll(async () => {
  registerChatThreadsShareable();
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_query_org_migrations",
  })(null);
  await ensureChatThreadTables();
  await ensureAnalyticsDatabase();
  for (const id of [orgId, otherOrg]) {
    await getDb().insert(organizations).values({
      id,
      name: "QA test workspace",
      createdBy: email,
      createdAt: Date.now(),
    });
    await getDb().insert(orgMembers).values({
      id: randomUUID(),
      orgId: id,
      email,
      role: "owner",
      joinedAt: Date.now(),
    });
  }
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: peer,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: member,
    role: "member",
    joinedAt: Date.now(),
  });
  await actor(() =>
    upsertWorkspaceConnection({
      id: "qa-connection",
      provider: "bigquery",
      label: "QA test warehouse",
      status: "connected",
      allowedApps: ["analytics-2"],
      config: { viewAccessGroupIds: [] },
    }),
  );
});
beforeEach(() => {
  workspaceDefault.mockReset().mockResolvedValue(null);
  assertDefaultGrant.mockReset().mockResolvedValue(undefined);
  provider.mockReset();
  cancelProvider.mockReset();
});
afterAll(async () => {
  await closeDbExec();
  if (oldDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldDatabase;
  if (
    !resolve(round).startsWith(resolve(tmpdir()) + "/project-query-") ||
    resolve(round) === resolve(process.cwd())
  ) {
    throw new Error("Refused cleanup outside the owned query-test round");
  }
  rmSync(round, { recursive: true });
});

describe("saved SQL cell execution boundary", () => {
  it.each([
    [422, "warehouse_query_failed", "Unrecognized name: missing at [1:8]"],
    [403, "warehouse_query_denied", "Access Denied: Table qa.test.orders"],
  ])(
    "retains BigQuery's %i reason in notebook output and published errors",
    async (statusCode, errorCode, message) => {
      const input = await fixture();
      provider.mockImplementation(async () =>
        fail(message, { statusCode, errorCode }),
      );
      await expect(
        actor(() => runCell.run(input, context)),
      ).rejects.toMatchObject({ message });
      expect(
        await readCellOutput(scope, input.projectId, input.cellId),
      ).toMatchObject({
        status: "error",
        output: { type: "error", message },
      });
      await seedLegacyPublishedProject(scope, input.projectId);
      await expect(
        actor(() =>
          runPublishedCell.run(
            { ...input, version: "latest", values: {} },
            context,
          ),
        ),
      ).rejects.toMatchObject({ statusCode, errorCode, message });
    },
  );

  it.each([
    [
      400,
      "invalidQuery",
      "BigQuery rejected the SQL. Check the query for invalid identifiers or syntax errors.",
    ],
    [
      403,
      "accessDenied",
      "Access to this query result was denied. Check the selected connection's permissions.",
    ],
  ])(
    "persists a readable organization warehouse diagnostic for %s %s",
    async (providerStatus, providerReason, message) => {
      const input = await fixture();
      provider.mockImplementation(async () =>
        fail("BigQuery could not complete this request.", {
          statusCode: 502,
          errorCode: "organization_query_provider_failed",
          details: { providerStatus, providerReason },
        }),
      );
      await expect(
        actor(() => runCell.run(input, context)),
      ).rejects.toMatchObject({
        errorCode: "organization_query_provider_failed",
        message,
        details: { providerStatus, providerReason },
      });
      expect(
        await readCellOutput(scope, input.projectId, input.cellId),
      ).toMatchObject({
        status: "error",
        output: { type: "error", message },
      });
    },
  );

  it("inserts a Python cell at the saved gap and rejects duplicate variable names", async () => {
    const { projectId, cellId } = await fixture();
    const second = await actor(() =>
      addCell.run({ projectId, kind: "sql", afterCellId: cellId }, context),
    );
    const inserted = await actor(() =>
      addCell.run({ projectId, kind: "code", afterCellId: cellId }, context),
    );
    const project = await getProjectDocument(scope, projectId);
    expect(project?.cells.map(({ id }) => id)).toEqual([
      cellId,
      inserted.createdCellId,
      second.createdCellId,
    ]);
    expect(project?.cells[1]?.contents).toMatchObject({
      kind: "code",
      language: "python",
      label: null,
    });
    const sql = project?.cells[2];
    if (sql?.contents.kind !== "sql")
      throw new Error("Missing SQL result variable fixture");
    await expect(
      actor(() =>
        saveCell.run(
          {
            projectId,
            cellId: sql.id,
            contents: { ...sql.contents, resultVariable: "DataFrame" },
          },
          context,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "project_result_variable_taken" });
    expect(
      (await getProjectDocument(scope, projectId))?.cells[2]?.contents,
    ).toMatchObject({ resultVariable: "dataframe_2" });
  });

  it("formats a SQL draft with lowercase keywords and four-space columns without saving it", async () => {
    const input = await fixture();
    await expect(
      actor(() =>
        formatNotebookSql.run({
          ...input,
          source: "SELECT a,b FROM t",
        }),
      ),
    ).resolves.toEqual({ formattedSource: "select\n    a,\n    b\nfrom t\n" });
    expect(
      (await getProjectDocument(scope, input.projectId))?.cells[0]?.contents,
    ).toMatchObject({
      source: "SELECT 9007199254740993 AS precise_id",
    });
  }, 20_000);

  it("seeks a completed result without replacing its stored prefix", async () => {
    const input = await fixture();
    const initial = page({
      totalRows: "20000",
      pageToken: "next",
      hasNextPage: true,
    });
    provider.mockResolvedValueOnce(initial).mockResolvedValueOnce(
      page({
        rows: Array.from({ length: 50 }, (_, i) => [String(19951 + i)]),
        totalRows: "20000",
      }),
    );
    await actor(() => runCell.run(input, context));
    const state = await actor(() =>
      getProjectQueryState(input.projectId, input.cellId),
    );
    if (!state) throw new Error("Missing completed warehouse query state");
    const seek = {
      ...input,
      operation: "page" as const,
      rowOffset: 19950,
      requestId: state.requestId,
    };
    const result = await actor(() => runCell.run(seek, context));
    expect(result.output).toMatchObject({
      type: "table",
      rowCount: 50,
      rows: Array.from({ length: 50 }, (_, i) => [19951 + i]),
    });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1]?.[0]).toMatchObject({
      job: initial.jobReference,
      first: 50,
      rowOffset: 19950,
    });
    expect(
      await readCellOutput(scope, input.projectId, input.cellId),
    ).toMatchObject({
      status: "complete",
      output: { rows: initial.rows, truncated: true },
    });
    await expect(
      actor(() => runCell.run({ ...seek, requestId: randomUUID() }, context)),
    ).rejects.toMatchObject({ errorCode: "project_query_changed" });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("restores a deleted warehouse result and its existing page continuation", async () => {
    const input = await fixture();
    provider.mockResolvedValueOnce(
      page({
        totalRows: "100",
        hasNextPage: true,
        pageToken: "next",
      }),
    );
    await actor(() => runCell.run(input, context));
    const get = () =>
      actor(() => getProject.run({ projectId: input.projectId }, context));
    const previous = await get();
    const saved = previous.project.cells.find(({ id }) => id === input.cellId);
    if (!saved) throw new Error("Missing SQL cell");
    const deletion = await actor(() =>
      deleteCell.run({ ...input, keepOutputForUndo: true }, context),
    );
    await actor(() =>
      addCell.run(
        {
          projectId: input.projectId,
          kind: "sql",
          restore: saved.contents,
          outputUndoToken: deletion.outputUndoToken,
        },
        context,
      ),
    );
    const current = await get();
    expect(current.outputs[input.cellId]).toEqual(
      previous.outputs[input.cellId],
    );
    expect(current.queryStates[input.cellId]).toMatchObject({
      hasNextPage: true,
      totalRows: "100",
    });
    expect(current.queryStates[input.cellId]?.requestId).toBe(
      previous.queryStates[input.cellId]?.requestId,
    );
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("retains the provider total on a truncated published result", async () => {
    const input = await fixture({ source: "SELECT 1 AS n" });
    await seedLegacyPublishedProject(scope, input.projectId);
    let served = 0;
    provider.mockImplementation(async () => {
      served += 1000;
      return page({
        rows: Array.from({ length: 1000 }, (_, i) => [String(served + i)]),
        totalRows: "20000",
        pageToken: `next-${served}`,
        hasNextPage: true,
      });
    });
    const result = await actor(() =>
      runPublishedCell.run(
        { ...input, version: "latest", values: {} },
        context,
      ),
    );
    expect(result.output).toMatchObject({
      type: "table",
      rowCount: 10_000,
      totalRows: "20000",
      truncated: true,
    });
  });

  it("report SAYA-1117-INPUT-DOCS-ARRAY binds a multiselect array in notebook SQL", async () => {
    const cellId = `cell-${randomUUID()}`;
    const base = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    const project = await createProject({
      ...scope,
      title: "Multiselect parameter",
      cells: [
        {
          ...base,
          id: `cell-${randomUUID()}`,
          kind: "input",
          name: "regions",
          inputType: "MULTISELECT",
          defaultValueString: JSON.stringify(["east", "west' OR true --"]),
        },
        {
          ...base,
          id: cellId,
          kind: "sql",
          source: "SELECT {{ regions | array }} FROM orders LIMIT 1",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: "dataframe",
          outputResult: true,
        },
      ],
    });
    const result = await actor(() =>
      runCell.run({ projectId: project.id, cellId }, context),
    );
    expect(result.output).toMatchObject({
      type: "table",
      rows: [["east", "west' OR true --"]],
    });
  });
  it("report A2-STALE-WORKING-DRAFT: refuses a query result after its draft stops being the working version", async () => {
    const input = await fixture();
    const published = await seedLegacyPublishedProject(scope, input.projectId);
    if (!published.publishedVersionId)
      throw new Error("Published version missing");
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await getDb()
      .update(schema.projects)
      .set({ workingVersionId: published.publishedVersionId })
      .where(eq(schema.projects.id, input.projectId));
    release(page());
    await expect(pending).rejects.toMatchObject({
      errorCode: "project_query_changed",
      statusCode: 409,
    });
    expect(
      await readCellOutput(scope, input.projectId, input.cellId),
    ).toBeNull();
  });
  // oracle-change: draft runs bind query-driven inputs in the notebook execution service through dynamicOptions checked against the producer's verified result, so run-project-cell no longer pages and judges legacy optionsSource choices
  it("report FLOW-parameter-query: evaluates the saved input on each run", async () => {
    const cellId = `cell-${randomUUID()}`;
    const inputId = `cell-${randomUUID()}`;
    const base = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    const project = await createProject({
      ...scope,
      title: "Parameterized query",
      cells: [
        {
          ...base,
          id: inputId,
          kind: "input",
          name: "region",
          inputType: "TEXT_INPUT",
          defaultValueString: "marketplace",
        },
        {
          ...base,
          id: cellId,
          kind: "sql",
          source: "SELECT {{ region }} AS selected FROM orders LIMIT 1",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: "dataframe",
          outputResult: true,
        },
      ],
    });
    const run = () =>
      actor(() => runCell.run({ projectId: project.id, cellId }, context));
    expect((await run()).output).toMatchObject({
      type: "table",
      rows: [["marketplace"]],
    });
    const document = await getProjectDocument(scope, project.id);
    const input = document?.cells.find((entry) => entry.id === inputId);
    if (!document || input?.contents.kind !== "input")
      throw new Error("Expected input cell");
    await updateCell({
      ...scope,
      projectId: project.id,
      versionId: document.workingVersionId,
      cellId: inputId,
      contents: {
        ...input.contents,
        defaultValueString: "partner' OR true --",
      },
      expectedUpdatedAt: input.updatedAt,
    });
    expect((await run()).output).toMatchObject({
      type: "table",
      rows: [["partner' OR true --"]],
    });
    const latest = await getProjectDocument(scope, project.id);
    const renamed = latest?.cells.find((entry) => entry.id === inputId);
    if (!latest || renamed?.contents.kind !== "input")
      throw new Error("Expected input cell");
    await updateCell({
      ...scope,
      projectId: project.id,
      versionId: latest.workingVersionId,
      cellId: inputId,
      contents: { ...renamed.contents, name: "other" },
    });
    await expect(run()).rejects.toMatchObject({
      errorCode: "project_input_invalid",
      statusCode: 422,
    });
    expect(await readCellOutput(scope, project.id, cellId)).toMatchObject({
      status: "error",
      output: { type: "error", message: "Invalid input value." },
    });
  });
  it("rejects a result when a saved parameter changes during execution", async () => {
    const cellId = `cell-${randomUUID()}`;
    const inputId = `cell-${randomUUID()}`;
    const base = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    const project = await createProject({
      ...scope,
      title: "Input race",
      cells: [
        {
          ...base,
          id: inputId,
          kind: "input",
          name: "region",
          inputType: "TEXT_INPUT",
          defaultValueString: "marketplace",
        },
        {
          ...base,
          id: cellId,
          kind: "sql",
          source: "SELECT {{ region }} AS selected",
          dataConnectionId: "qa-connection",
          databaseSchema: null,
          resultVariable: "dataframe",
          outputResult: true,
        },
      ],
    });
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = actor(() =>
      runCell.run({ projectId: project.id, cellId }, context),
    );
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    expect(provider.mock.calls[0]?.[0]).toMatchObject({
      query: "SELECT @template_0 AS selected",
      parameters: [
        { name: "template_0", parameterValue: { value: "marketplace" } },
      ],
    });
    const document = await getProjectDocument(scope, project.id);
    const input = document?.cells.find((entry) => entry.id === inputId);
    if (!document || input?.contents.kind !== "input")
      throw new Error("Expected input cell");
    await updateCell({
      ...scope,
      projectId: project.id,
      versionId: document.workingVersionId,
      cellId: inputId,
      contents: { ...input.contents, defaultValueString: "partner" },
    });
    release(page());
    await expect(pending).rejects.toMatchObject({
      errorCode: "project_query_changed",
      statusCode: 409,
    });
    expect(
      (await readCellOutput(scope, project.id, cellId))?.output?.type,
    ).not.toBe("table");
  });
  it("polls and cancels only the matching parameter snapshot", async () => {
    const cellId = `cell-${randomUUID()}`;
    const inputId = `cell-${randomUUID()}`;
    const base = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    const project = await createProject({
      ...scope,
      title: "Parameter jobs",
      cells: [
        {
          ...base,
          id: inputId,
          kind: "input",
          name: "region",
          inputType: "TEXT_INPUT",
          defaultValueString: "marketplace",
        },
        {
          ...base,
          id: cellId,
          kind: "sql",
          source: "SELECT {{ region }} AS selected",
          dataConnectionId: "qa-connection",
          databaseSchema: null,
          resultVariable: "dataframe",
          outputResult: true,
        },
      ],
    });
    const input = { projectId: project.id, cellId };
    const requestId = randomUUID();
    const running = page({
      jobComplete: false,
      status: "running",
      rows: [],
      totalRows: null,
    });
    provider.mockResolvedValueOnce(running).mockResolvedValueOnce(running);
    await actor(() => runCell.run({ ...input, requestId }, context));
    expect(
      await actor(() => getProjectQueryState(project.id, cellId)),
    ).toMatchObject({ status: "running", requestId });
    expect(
      await actor(() =>
        runCell.run({ ...input, requestId, operation: "poll" }, context),
      ),
    ).toMatchObject({ status: "running" });
    cancelProvider.mockResolvedValueOnce("cancelled");
    expect(
      await actor(() => cancelCell.run({ ...input, requestId }, context)),
    ).toMatchObject({ status: "cancelled" });
    const nextRequestId = randomUUID();
    provider.mockResolvedValueOnce(running);
    await actor(() =>
      runCell.run({ ...input, requestId: nextRequestId }, context),
    );
    const document = await getProjectDocument(scope, project.id);
    const parameter = document?.cells.find((entry) => entry.id === inputId);
    if (!document || parameter?.contents.kind !== "input")
      throw new Error("Expected input cell");
    await updateCell({
      ...scope,
      projectId: project.id,
      versionId: document.workingVersionId,
      cellId: inputId,
      contents: { ...parameter.contents, defaultValueString: "partner" },
    });
    expect(
      await actor(() => getProjectQueryState(project.id, cellId)),
    ).toBeNull();
    await expect(
      actor(() =>
        runCell.run(
          { ...input, requestId: nextRequestId, operation: "poll" },
          context,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "project_query_changed" });
    expect(provider).toHaveBeenCalledTimes(3);
  });
  // Notebook dataframe variables: bbf76552d5964a49c6c00248fcf2e264b3112ce919420c9c4fc66ad690079b20.js:643-647; projectDataframes: 9a419699*.js:294-310.
  // oracle-change: Dataframes SQL runs in the notebook kernel over verified Arrow artifacts instead of Postgres tables run-project-cell materialized into private blobs, so in-process sample-table races, rotating-cursor blob capture and duplicate-name refusals are gone
  it("requires a complete Arrow artifact for a legacy sample preview", async () => {
    const firstId = `cell-${randomUUID()}`;
    const secondId = `cell-${randomUUID()}`;
    const shared = {
      kind: "sql" as const,
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      dataConnectionId: null,
      databaseSchema: null,
      outputResult: true,
    };
    const project = await createProject({
      ...scope,
      title: "Chained SQL",
      cells: [
        {
          ...shared,
          id: firstId,
          source: "SELECT * FROM orders LIMIT 2",
          resultVariable: "dataframe",
        },
        {
          ...shared,
          id: secondId,
          source: "SELECT COUNT(*) AS count FROM dataframe",
          resultVariable: "result",
          connectionMode: "dataframes",
        },
      ],
    });
    const first = await actor(() =>
      runCell.run({ projectId: project.id, cellId: firstId }, context),
    );
    expect(first.output).toMatchObject({
      type: "table",
      rowCount: 2,
      truncated: false,
    });
    await expect(
      actor(() =>
        runCell.run({ projectId: project.id, cellId: secondId }, context),
      ),
    ).rejects.toMatchObject({ errorCode: "dataframe_incomplete" });
    expect(await readCellOutput(scope, project.id, secondId)).toBeNull();
    await seedLegacyPublishedProject(scope, project.id);
    await expect(
      actor(() =>
        runPublishedCell.run(
          {
            projectId: project.id,
            version: project.workingVersionId,
            cellId: secondId,
            values: {},
          },
          context,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "project_version_not_found" });
  });
  it("requires a complete Arrow artifact for a legacy warehouse preview", async () => {
    const sampleId = `cell-${randomUUID()}`;
    const providerId = `cell-${randomUUID()}`;
    const downstreamId = `cell-${randomUUID()}`;
    const shared = {
      kind: "sql" as const,
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      databaseSchema: null,
      outputResult: true,
    };
    const project = await createProject({
      ...scope,
      title: "Dataframe sources",
      cells: [
        {
          ...shared,
          id: sampleId,
          source: "SELECT * FROM orders LIMIT 2",
          dataConnectionId: null,
          resultVariable: "sample_frame",
        },
        {
          ...shared,
          id: providerId,
          source: "SELECT secret FROM warehouse",
          dataConnectionId: "qa-connection",
          resultVariable: "warehouse",
        },
        {
          ...shared,
          id: downstreamId,
          source: "SELECT * FROM warehouse",
          dataConnectionId: null,
          resultVariable: "result",
          connectionMode: "dataframes",
        },
      ],
    });
    await actor(() =>
      runCell.run({ projectId: project.id, cellId: sampleId }, context),
    );
    provider.mockResolvedValueOnce(
      page({
        columns: [{ name: "secret", type: "STRING" }],
        rows: [["private-value"]],
      }),
    );
    await actor(() =>
      runCell.run({ projectId: project.id, cellId: providerId }, context),
    );
    await expect(
      actor(() =>
        runCell.run({ projectId: project.id, cellId: downstreamId }, context),
      ),
    ).rejects.toMatchObject({ errorCode: "dataframe_incomplete" });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await readCellOutput(scope, project.id, downstreamId)).toBeNull();
  });
  it("report SAYA-1117-RESULT-SHAPE: preserves numeric types and exact values in saved results", async () => {
    const input = await fixture();
    provider.mockResolvedValueOnce(
      page({
        columns: [
          { name: "count", type: "INT64" },
          { name: "large_id", type: "INT64" },
          { name: "rate", type: "FLOAT64" },
          { name: "amount", type: "NUMERIC" },
          { name: "enabled", type: "BOOL" },
        ],
        rows: [
          ["270", "9007199254740993", "1.5", "123456789.123456789", "true"],
        ],
      }),
    );
    const result = await actor(() => runCell.run(input, context));
    expect(result.output).toMatchObject({
      type: "table",
      columns: [
        { name: "count", type: "number" },
        { name: "large_id", type: "number" },
        { name: "rate", type: "number" },
        { name: "amount", type: "number" },
        { name: "enabled", type: "boolean" },
      ],
      rows: [[270, "9007199254740993", 1.5, "123456789.123456789", true]],
    });
    expect(
      (await readCellOutput(scope, input.projectId, input.cellId))?.output,
    ).toEqual(result.output);
  });
  it("report 1794945614.960449: persists and runs a pre-existing cell on the workspace default", async () => {
    const input = await fixture({ dataConnectionId: null });
    workspaceDefault.mockResolvedValue("qa-connection");
    provider.mockResolvedValueOnce(page());
    const result = await actor(() => runCell.run(input, context));
    expect(result.status).toBe("complete");
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "qa-connection" }),
      expect.anything(),
    );
    const project = await getProjectDocument(scope, input.projectId);
    expect(project?.cells[0]?.contents).toMatchObject({
      dataConnectionId: "qa-connection",
    });
  });
  it("persists and queries the saved warehouse explicitly selected for a new SQL cell", async () => {
    const { projectId } = await fixture({ dataConnectionId: null });
    const dataConnectionId = "qa-connection";
    const source = "SELECT 9007199254740993 AS precise_id";
    const { createdCellId, project } = await actor(() =>
      addCell.run(
        { projectId, kind: "sql", dataConnectionId, source },
        context,
      ),
    );
    expect(
      project.cells.find(({ id }) => id === createdCellId)?.contents,
    ).toMatchObject({
      dataConnectionId,
      source,
    });
    if (!createdCellId) throw new Error("Missing created SQL cell");
    provider.mockResolvedValueOnce(page());
    await expect(
      actor(() => runCell.run({ projectId, cellId: createdCellId }, context)),
    ).resolves.toMatchObject({ status: "complete" });
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: dataConnectionId,
        query: source,
      }),
      expect.anything(),
    );
  });
  it("report 1794945614.960449: refuses a revoked default without writing it", async () => {
    const input = await fixture({ dataConnectionId: null });
    workspaceDefault.mockResolvedValue("revoked");
    assertDefaultGrant.mockRejectedValue(new Error("connection unavailable"));
    await expect(actor(() => runCell.run(input, context))).rejects.toThrow(
      "connection unavailable",
    );
    const project = await getProjectDocument(scope, input.projectId);
    expect(project?.cells[0]?.contents).toMatchObject({
      dataConnectionId: null,
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it("report 1794945614.960449: an explicit Dataframes selection does not use the default", async () => {
    const input = await fixture({
      dataConnectionId: null,
      source: "SELECT * FROM missing_dataframe",
    });
    const project = await getProjectDocument(scope, input.projectId);
    const cell = project?.cells[0];
    if (!project || !cell || cell.contents.kind !== "sql")
      throw new Error("SQL cell missing");
    await updateCell({
      ...scope,
      projectId: input.projectId,
      versionId: project.workingVersionId,
      cellId: input.cellId,
      contents: { ...cell.contents, connectionMode: "dataframes" },
    });
    workspaceDefault.mockResolvedValue("qa-connection");
    await expect(
      actor(() => runCell.run(input, context)),
    ).rejects.toMatchObject({ errorCode: "dataframe_incomplete" });
    expect(provider).not.toHaveBeenCalled();
    expect(workspaceDefault).not.toHaveBeenCalled();
  });
  it("report 1794945614.960449: rejects a contradictory persisted SQL source before execution", async () => {
    const input = await fixture();
    const project = await getProjectDocument(scope, input.projectId);
    const cell = project?.cells[0];
    if (!project || !cell || cell.contents.kind !== "sql")
      throw new Error("SQL cell missing");
    const corrupted = await getDb()
      .update(schema.cells)
      .set({
        contents: encodeJsonColumn({
          ...cell.contents,
          connectionMode: "dataframes",
        }),
      })
      .where(
        and(
          eq(schema.cells.projectId, input.projectId),
          eq(schema.cells.versionId, project.workingVersionId),
          eq(schema.cells.id, input.cellId),
        ),
      )
      .returning({ id: schema.cells.id });
    expect(corrupted).toEqual([{ id: input.cellId }]);
    await expect(
      actor(() => runCell.run(input, context)),
    ).rejects.toMatchObject({ errorCode: "invalid_cell_connection" });
    expect(provider).not.toHaveBeenCalled();
  });
  it("lets a workspace Member run and cancel an owned query, persisting cancellation only after provider confirmation", async () => {
    const input = await fixture({ ownerEmail: member });
    const asMember = <T>(run: () => T) => actor(run, member);
    const memberContext = { ...context, userEmail: member };
    const requestId = randomUUID();
    provider.mockResolvedValueOnce(
      page({
        jobComplete: false,
        status: "running",
        rows: [],
        totalRows: null,
        jobReference: {
          projectId: "qa-warehouse",
          jobId: "qa-job",
          location: "EU",
        },
      }),
    );
    expect(
      await asMember(() => runCell.run({ ...input, requestId }, memberContext)),
    ).toMatchObject({ status: "running" });
    cancelProvider
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("cancelled");
    expect(
      await asMember(() =>
        cancelCell.run({ ...input, requestId }, memberContext),
      ),
    ).toMatchObject({ status: "cancelling" });
    expect(
      await asMember(() => getProjectQueryState(input.projectId, input.cellId)),
    ).toMatchObject({ status: "cancelling" });
    expect(
      await asMember(() =>
        cancelCell.run(
          { ...input, requestId, operation: "status" },
          memberContext,
        ),
      ),
    ).toMatchObject({ status: "cancelled" });
    expect(
      await asMember(() => getProjectQueryState(input.projectId, input.cellId)),
    ).toMatchObject({ status: "cancelled" });
  });
  it("keeps an unknown outcome when the initial provider response is lost after Stop", async () => {
    const input = await fixture();
    const requestId = randomUUID();
    let rejectProvider: (error: Error) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectProvider = reject;
        }),
    );
    const run = actor(() => runCell.run({ ...input, requestId }, context));
    const observed = expect(run).rejects.toThrow("transport lost");
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    expect(
      await actor(() => cancelCell.run({ ...input, requestId }, context)),
    ).toEqual({ status: "cancelling" });
    rejectProvider(new Error("transport lost"));
    await observed;
    expect(
      await actor(() => getProjectQueryState(input.projectId, input.cellId)),
    ).toMatchObject({ status: "cancel_unknown", requestId });
    expect(
      await readCellOutput(scope, input.projectId, input.cellId),
    ).toMatchObject({
      output: {
        code: "cancel_unknown",
        message: "The query cancellation outcome is unknown.",
      },
    });
  });
  it("defers Stop until an in-flight submission supplies its exact job", async () => {
    const input = await fixture();
    const requestId = randomUUID();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const run = actor(() => runCell.run({ ...input, requestId }, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    expect(
      await actor(() => cancelCell.run({ ...input, requestId }, context)),
    ).toEqual({ status: "cancelling" });
    expect(cancelProvider).not.toHaveBeenCalled();
    release(
      page({
        jobComplete: false,
        status: "running",
        rows: [],
        totalRows: null,
        jobReference: {
          projectId: "qa-warehouse",
          jobId: "qa-job",
          location: "EU",
        },
      }),
    );
    expect(await run).toMatchObject({ status: "cancelling" });
    cancelProvider.mockResolvedValueOnce("cancelled");
    expect(
      await actor(() =>
        cancelCell.run({ ...input, requestId, operation: "status" }, context),
      ),
    ).toEqual({ status: "cancelled" });
    expect(cancelProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        job: { projectId: "qa-warehouse", jobId: "qa-job", location: "EU" },
        operation: "request",
      }),
      expect.anything(),
    );
  });
  it("reissues a cancellation request after an unknown transport outcome", async () => {
    const input = await fixture();
    const requestId = randomUUID();
    provider.mockResolvedValueOnce(
      page({
        jobComplete: false,
        status: "running",
        rows: [],
        totalRows: null,
        jobReference: {
          projectId: "qa-warehouse",
          jobId: "qa-job",
          location: "EU",
        },
      }),
    );
    await actor(() => runCell.run({ ...input, requestId }, context));
    cancelProvider
      .mockRejectedValueOnce(new Error("transport lost"))
      .mockResolvedValueOnce("pending");
    await expect(
      actor(() => cancelCell.run({ ...input, requestId }, context)),
    ).rejects.toThrow("transport lost");
    await actor(() =>
      cancelCell.run({ ...input, requestId, operation: "status" }, context),
    );
    expect(cancelProvider.mock.calls.map(([args]) => args.operation)).toEqual([
      "request",
      "request",
    ]);
  });
  it("refuses Stop before this run has been registered", async () => {
    const input = await fixture();
    await expect(
      actor(() =>
        cancelCell.run({ ...input, requestId: randomUUID() }, context),
      ),
    ).rejects.toMatchObject({
      errorCode: "project_query_changed",
      statusCode: 409,
    });
    expect(cancelProvider).not.toHaveBeenCalled();
  });
  it("projects a lost cancellation reservation as unknown without resubmitting", async () => {
    const input = await fixture();
    const requestId = randomUUID();
    provider.mockResolvedValueOnce(
      page({
        jobComplete: false,
        status: "running",
        rows: [],
        totalRows: null,
        jobReference: {
          projectId: "qa-warehouse",
          jobId: "qa-job",
          location: "EU",
        },
      }),
    );
    await actor(() => runCell.run({ ...input, requestId }, context));
    let release: (value: string) => void = () => {
      throw new Error("Cancellation did not start");
    };
    cancelProvider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const cancelling = actor(() =>
      cancelCell.run({ ...input, requestId }, context),
    );
    await vi.waitFor(() => expect(cancelProvider).toHaveBeenCalledTimes(1));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121_000);
    try {
      expect(
        await actor(() => getProjectQueryState(input.projectId, input.cellId)),
      ).toMatchObject({ status: "cancel_unknown", busy: false, requestId });
      await expect(
        actor(() =>
          cancelCell.run({ ...input, requestId, operation: "status" }, context),
        ),
      ).rejects.toMatchObject({ errorCode: "project_query_cancel_unknown" });
      await expect(
        actor(() =>
          runCell.run({ ...input, requestId: randomUUID() }, context),
        ),
      ).rejects.toMatchObject({ errorCode: "project_query_changed" });
      expect(cancelProvider).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
      release("pending");
      await cancelling;
    }
  });
  it("refuses a delayed Stop for an older request", async () => {
    const input = await fixture();
    const oldId = randomUUID();
    const newId = randomUUID();
    provider.mockResolvedValueOnce(page()).mockResolvedValueOnce(
      page({
        jobComplete: false,
        status: "running",
        rows: [],
        totalRows: null,
        jobReference: {
          projectId: "qa-warehouse",
          jobId: "new-job",
          location: "EU",
        },
      }),
    );
    await actor(() => runCell.run({ ...input, requestId: oldId }, context));
    await actor(() => runCell.run({ ...input, requestId: newId }, context));
    await expect(
      actor(() => cancelCell.run({ ...input, requestId: oldId }, context)),
    ).rejects.toMatchObject({ errorCode: "project_query_changed" });
    expect(cancelProvider).not.toHaveBeenCalled();
    await expect(
      actor(() =>
        runCell.run({ ...input, requestId: oldId, operation: "poll" }, context),
      ),
    ).rejects.toMatchObject({ errorCode: "project_query_changed" });
  });
  it("fetches completed results when the job wins the cancellation race", async () => {
    const input = await fixture();
    const requestId = randomUUID();
    provider
      .mockResolvedValueOnce(
        page({
          jobComplete: false,
          status: "running",
          rows: [],
          totalRows: null,
          jobReference: {
            projectId: "qa-warehouse",
            jobId: "qa-job",
            location: "EU",
          },
        }),
      )
      .mockResolvedValueOnce(page());
    await actor(() => runCell.run({ ...input, requestId }, context));
    cancelProvider.mockResolvedValueOnce("complete");
    expect(
      await actor(() => cancelCell.run({ ...input, requestId }, context)),
    ).toEqual({ status: "running" });
    const result = await actor(() =>
      runCell.run({ ...input, requestId, operation: "poll" }, context),
    );
    expect(result).toMatchObject({
      status: "complete",
      output: { type: "table", rows: [["9007199254740993"]] },
    });
    expect(
      await readCellOutput(scope, input.projectId, input.cellId),
    ).toMatchObject({ status: "complete" });
  });
  it("loads saved SQL and connection, preserves precision and persists the result", async () => {
    const input = await fixture();
    provider.mockResolvedValue(page());
    const result = await actor(() => runCell.run(input, context));
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "qa-connection",
        query: "SELECT 9007199254740993 AS precise_id",
      }),
      { userEmail: email, orgId, caller: "frontend" },
    );
    expect(result.output?.type).toBe("table");
    expect(
      (await readCellOutput(scope, input.projectId, input.cellId))?.output,
    ).toEqual(result.output);
    if (result.output?.type === "table")
      expect(result.output.rows[0]?.[0]).toBe("9007199254740993");
  });
  it("Steve demo: a later sample run owns the output when an earlier run finishes late", async () => {
    const input = await fixture({
      source: "select * from orders limit 1",
      dataConnectionId: null,
    });
    const actual = sampleQueryModule.executeSampleQuery;
    let release: () => void = () => {
      throw new Error("Sample query did not start");
    };
    const spy = vi
      .spyOn(sampleQueryModule, "executeSampleQuery")
      .mockImplementationOnce(async (source) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return actual(source);
      });
    try {
      const first = actor(() => runCell.run(input, context));
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      const second = await actor(() => runCell.run(input, context));
      expect(second.status).toBe("complete");
      const saved = await readCellOutput(scope, input.projectId, input.cellId);
      release();
      await expect(first).rejects.toMatchObject({ statusCode: 409 });
      expect(
        await readCellOutput(scope, input.projectId, input.cellId),
      ).toEqual(saved);
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    ["project_sample_query_timeout", 504, "The sample query timed out."],
    [
      "project_sample_query_busy",
      503,
      "The sample query service is busy. Try again.",
    ],
  ])(
    "Steve demo: persists %s after an earlier result",
    async (errorCode, statusCode, message) => {
      const input = await fixture({
        source: "select * from orders limit 1",
        dataConnectionId: null,
      });
      await actor(() => runCell.run(input, context));
      const failure = Object.assign(new Error(message), {
        actionContractError: true,
        errorCode,
        statusCode,
      });
      const spy = vi
        .spyOn(sampleQueryModule, "executeSampleQuery")
        .mockRejectedValueOnce(failure);
      try {
        await expect(actor(() => runCell.run(input, context))).rejects.toBe(
          failure,
        );
        expect(
          await readCellOutput(scope, input.projectId, input.cellId),
        ).toMatchObject({
          status: "error",
          output: { type: "error", message },
        });
      } finally {
        spy.mockRestore();
      }
    },
  );
  it("Steve demo: a delayed worker failure cannot replace a later result", async () => {
    const input = await fixture({
      source: "select * from orders limit 1",
      dataConnectionId: null,
    });
    let rejectFirst: (reason: Error) => void = () => {
      throw new Error("Sample query did not start");
    };
    const spy = vi
      .spyOn(sampleQueryModule, "executeSampleQuery")
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      );
    try {
      const first = actor(() => runCell.run(input, context));
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      await actor(() => runCell.run(input, context));
      const saved = await readCellOutput(scope, input.projectId, input.cellId);
      rejectFirst(
        Object.assign(new Error("The sample query timed out."), {
          actionContractError: true,
          errorCode: "project_sample_query_timeout",
          statusCode: 504,
        }),
      );
      await expect(first).rejects.toMatchObject({ statusCode: 409 });
      expect(
        await readCellOutput(scope, input.projectId, input.cellId),
      ).toEqual(saved);
    } finally {
      spy.mockRestore();
    }
  });
  it("runs sample joins without asking for a connection", async () => {
    const input = await fixture({
      source: "select * from sessions s1, sessions s2 limit 2000",
      dataConnectionId: null,
    });
    const result = await actor(() => runCell.run(input, context));
    expect(result.status).toBe("complete");
    expect(result.output?.rowCount).toBe(2000);
    expect(provider).not.toHaveBeenCalled();
  });
  it("still runs a simple sample-table query with no connection", async () => {
    const input = await fixture({
      source: "select session_date, stage, users from sessions limit 10",
      dataConnectionId: null,
    });
    const result = await actor(() => runCell.run(input, context));
    expect(result.status).toBe("complete");
    expect(result.output?.type).toBe("table");
    expect(provider).not.toHaveBeenCalled();
  });
  it.each(["poll", "next-page"] as const)(
    "rejects a stale %s after a cell switches to sample data",
    async (operation) => {
      const input = await fixture();
      provider.mockResolvedValueOnce(
        operation === "poll"
          ? page({
              jobComplete: false,
              status: "running",
              columns: [],
              rows: [],
              totalRows: null,
            })
          : page({ pageToken: "next", hasNextPage: true }),
      );
      await actor(() => runCell.run(input, context));
      const project = await getProjectDocument(scope, input.projectId);
      const cell = project?.cells.find((item) => item.id === input.cellId);
      if (!project || cell?.contents.kind !== "sql")
        throw new Error("Expected SQL fixture");
      await updateCell({
        ...scope,
        ...input,
        versionId: project.workingVersionId,
        contents: {
          ...cell.contents,
          source: "select session_date, stage, users from sessions limit 10",
          dataConnectionId: null,
        },
      });
      await actor(() => runCell.run(input, context));
      const output = await readCellOutput(scope, input.projectId, input.cellId);
      const history = await listRuns(scope, input.projectId);
      await expect(
        actor(() => runCell.run({ ...input, operation }, context)),
      ).rejects.toThrow("query changed");
      expect(
        await readCellOutput(scope, input.projectId, input.cellId),
      ).toEqual(output);
      expect(await listRuns(scope, input.projectId)).toEqual(history);
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );
  it("checks the execution action contract against real authorized cells", async () => {
    const input = await fixture();
    provider.mockResolvedValue(page());
    await actor(() =>
      checkActionProperties(runCell, {
        context,
        runs: 3,
        seed: 83,
        overrides: {
          "/projectId": arbitraryFromJsonSchema({ const: input.projectId }),
          "/cellId": arbitraryFromJsonSchema({ const: input.cellId }),
          "/operation": arbitraryFromJsonSchema({ const: "run" }),
        },
      }),
    );
  });
  it("refuses another organization or owner before any provider call", async () => {
    const input = await fixture();
    await expect(
      actor(() => runCell.run(input, context), email, otherOrg),
    ).rejects.toThrow();
    await expect(
      actor(() => runCell.run(input, context), peer),
    ).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
  it("report A2-STALE-RUN-PUBLICATION: denies a peer starting the same cell while its owner has a pending run", async () => {
    const input = await fixture();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await expect(
      actor(() => runCell.run(input, context), peer),
    ).rejects.toThrow();
    expect(provider).toHaveBeenCalledTimes(1);
    release(page());
    await expect(first).resolves.toMatchObject({ status: "complete" });
  });
  it("accepts no browser-supplied SQL, provider job or page token", async () => {
    const input = await fixture();
    for (const extra of [
      { query: "SELECT 2" },
      { job: { jobId: "foreign" } },
      { pageToken: "foreign" },
    ]) {
      await expect(
        actor(() => runCell.run({ ...input, ...extra }, context)),
      ).rejects.toThrow();
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it("polls only its durable job and appends every requested page beyond 1000 rows", async () => {
    const input = await fixture();
    provider.mockResolvedValueOnce(
      page({
        jobComplete: false,
        status: "running",
        columns: [],
        rows: [],
        totalRows: null,
      }),
    );
    expect((await actor(() => runCell.run(input, context))).status).toBe(
      "running",
    );
    expect(
      await actor(() => getProjectQueryState(input.projectId, input.cellId)),
    ).toMatchObject({ status: "running", busy: false });
    provider.mockResolvedValueOnce(
      page({
        rows: Array.from({ length: 1000 }, (_, i) => [String(i)]),
        totalRows: "1001",
        pageToken: "next",
        hasNextPage: true,
      }),
    );
    await actor(() => runCell.run({ ...input, operation: "poll" }, context));
    expect(provider.mock.calls[1]?.[0]).toMatchObject({
      job: { projectId: "qa-warehouse", jobId: "qa-job" },
    });
    expect(provider.mock.calls[1]?.[0]).not.toHaveProperty("query");
    provider.mockResolvedValueOnce(
      page({ rows: [["last-visible"]], totalRows: "1001" }),
    );
    const last = await actor(() =>
      runCell.run({ ...input, operation: "next-page" }, context),
    );
    expect(provider.mock.calls[2]?.[0]).toHaveProperty("pageToken", "next");
    expect(last.hasNextPage).toBe(false);
    if (last.output?.type !== "table")
      throw new Error("Expected persisted table");
    expect(last.output.rows).toHaveLength(1001);
    expect(last.output.rows[1000]).toEqual(["last-visible"]);
    expect(
      (await readCellOutput(scope, input.projectId, input.cellId))?.output,
    ).toEqual(last.output);
  });
  it("does not dispatch a second request while the first is suspended", async () => {
    const input = await fixture();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await expect(actor(() => runCell.run(input, context))).rejects.toThrow(
      "another request",
    );
    expect(provider).toHaveBeenCalledTimes(1);
    release(page());
    await first;
  });
  it("does not publish a result as current after its saved SQL changed during execution", async () => {
    const input = await fixture();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const project = await getProjectDocument(scope, input.projectId);
    const cell = project?.cells.find((item) => item.id === input.cellId);
    if (!project || cell?.contents.kind !== "sql")
      throw new Error("Expected SQL fixture");
    await updateCell({
      ...scope,
      ...input,
      versionId: project.workingVersionId,
      contents: { ...cell.contents, source: "SELECT 2 AS changed" },
    });
    release(page());
    await expect(first).rejects.toMatchObject({
      errorCode: "project_query_changed",
      statusCode: 409,
    });
    expect(
      await readCellOutput(scope, input.projectId, input.cellId),
    ).toBeNull();
  });
  it("keeps a newer missing-connection error when an older warehouse result arrives", async () => {
    const input = await fixture();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const older = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const project = await getProjectDocument(scope, input.projectId);
    const cell = project?.cells.find((item) => item.id === input.cellId);
    if (!project || cell?.contents.kind !== "sql")
      throw new Error("Expected SQL fixture");
    await updateCell({
      ...scope,
      ...input,
      versionId: project.workingVersionId,
      contents: {
        ...cell.contents,
        source: "SELECT * FROM unknown_table",
        dataConnectionId: null,
      },
    });
    await expect(
      actor(() => runCell.run(input, context)),
    ).rejects.toMatchObject({ errorCode: "project_connection_required" });
    const saved = await readCellOutput(scope, input.projectId, input.cellId);
    expect(saved).toMatchObject({
      status: "error",
      output: {
        message: "Select a data connection before running this query.",
      },
    });
    release(page());
    await expect(older).rejects.toMatchObject({
      errorCode: "project_query_changed",
    });
    expect(await readCellOutput(scope, input.projectId, input.cellId)).toEqual(
      saved,
    );
  });
  it.each(["success", "failure"] as const)(
    "report A2-STALE-RUN-PUBLICATION: does not overwrite a newer sample result when an older warehouse run ends in %s",
    async (outcome) => {
      const input = await fixture();
      let resolveProvider: (value: ReturnType<typeof page>) => void = () => {
        throw new Error("Provider did not start");
      };
      let rejectProvider: (error: Error) => void = () => {
        throw new Error("Provider did not start");
      };
      provider.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveProvider = resolve;
            rejectProvider = reject;
          }),
      );
      const first = actor(() => runCell.run(input, context));
      await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
      const project = await getProjectDocument(scope, input.projectId);
      const cell = project?.cells.find((item) => item.id === input.cellId);
      if (!project || cell?.contents.kind !== "sql")
        throw new Error("Expected SQL fixture");
      await updateCell({
        ...scope,
        ...input,
        versionId: project.workingVersionId,
        contents: {
          ...cell.contents,
          source: "select session_date, stage, users from sessions limit 10",
          dataConnectionId: null,
        },
      });
      await actor(() => runCell.run(input, context));
      const current = await readCellOutput(
        scope,
        input.projectId,
        input.cellId,
      );
      const history = await listRuns(scope, input.projectId);
      if (outcome === "success") resolveProvider(page());
      else rejectProvider(new Error("Provider unavailable"));
      if (outcome === "success")
        await expect(first).rejects.toMatchObject({
          errorCode: "project_query_changed",
          statusCode: 409,
        });
      else
        await expect(first).rejects.toMatchObject({
          errorCode: "project_query_changed",
          statusCode: 409,
        });
      expect(
        await readCellOutput(scope, input.projectId, input.cellId),
      ).toEqual(current);
      expect(await listRuns(scope, input.projectId)).toEqual(history);
    },
  );
  it("report A2-STALE-RUN-PUBLICATION: a late run cannot replace a newer sample result after SQL changes back", async () => {
    const input = await fixture();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const project = await getProjectDocument(scope, input.projectId);
    const cell = project?.cells.find((item) => item.id === input.cellId);
    if (!project || cell?.contents.kind !== "sql")
      throw new Error("Expected SQL fixture");
    const update = (contents: typeof cell.contents) =>
      updateCell({
        ...scope,
        ...input,
        versionId: project.workingVersionId,
        contents,
      });
    await update({
      ...cell.contents,
      source: "select session_date, stage, users from sessions limit 10",
      dataConnectionId: null,
    });
    await actor(() => runCell.run(input, context));
    const current = await readCellOutput(scope, input.projectId, input.cellId);
    const history = await listRuns(scope, input.projectId);
    await update(cell.contents);
    release(page());
    await expect(first).rejects.toMatchObject({
      errorCode: "project_query_changed",
      statusCode: 409,
    });
    expect(await readCellOutput(scope, input.projectId, input.cellId)).toEqual(
      current,
    );
    expect(await listRuns(scope, input.projectId)).toEqual(history);
    expect(
      await actor(() => getProjectQueryState(input.projectId, input.cellId)),
    ).toBeNull();
  });
  it("report A2-STALE-RUN-PUBLICATION: clearing an output fences a suspended run", async () => {
    const input = await fixture();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await clearCellOutput(scope, input.projectId, input.cellId);
    release(page());
    await expect(first).rejects.toMatchObject({
      errorCode: "project_query_changed",
      statusCode: 409,
    });
    expect(
      await readCellOutput(scope, input.projectId, input.cellId),
    ).toBeNull();
    expect(await listRuns(scope, input.projectId)).toEqual([]);
  });
  it.each(["poll", "next-page"] as const)(
    "report A2-STALE-RUN-PUBLICATION: hides stale %s state and refuses provider dispatch after replacement",
    async (operation) => {
      const input = await fixture();
      provider.mockResolvedValueOnce(
        operation === "poll"
          ? page({
              jobComplete: false,
              status: "running",
              columns: [],
              rows: [],
              totalRows: null,
            })
          : page({ pageToken: "next", hasNextPage: true, totalRows: "4000" }),
      );
      await actor(() => runCell.run(input, context));
      const project = await getProjectDocument(scope, input.projectId);
      const cell = project?.cells.find((item) => item.id === input.cellId);
      if (!project || cell?.contents.kind !== "sql")
        throw new Error("Expected SQL fixture");
      const update = (contents: typeof cell.contents) =>
        updateCell({
          ...scope,
          ...input,
          versionId: project.workingVersionId,
          contents,
        });
      await update({
        ...cell.contents,
        source: "select session_date, stage, users from sessions limit 10",
        dataConnectionId: null,
      });
      await actor(() => runCell.run(input, context));
      const output = await readCellOutput(scope, input.projectId, input.cellId);
      await update(cell.contents);
      const snapshot = await actor(() =>
        getProject.run({ projectId: input.projectId }, context),
      );
      expect(snapshot.outputs[input.cellId]?.output).toEqual(output?.output);
      expect(snapshot.queryStates[input.cellId]).toBeUndefined();
      expect(
        await actor(() => getProjectQueryState(input.projectId, input.cellId)),
      ).toBeNull();
      await expect(
        actor(() => runCell.run({ ...input, operation }, context)),
      ).rejects.toMatchObject({
        errorCode: "project_query_changed",
        statusCode: 409,
      });
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );
  it("report A2-STALE-RUN-PUBLICATION: an explicit run after clear supersedes a pending run without letting its late result change the new result", async () => {
    const input = await fixture();
    let release: (value: ReturnType<typeof page>) => void = () => {
      throw new Error("Provider did not start");
    };
    provider
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(page({ rows: [["new-result"]] }));
    const first = actor(() => runCell.run(input, context));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await clearCellOutput(scope, input.projectId, input.cellId);
    const second = await actor(() => runCell.run(input, context));
    expect(second.output?.type).toBe("table");
    const output = await readCellOutput(scope, input.projectId, input.cellId);
    const history = await listRuns(scope, input.projectId);
    release(page());
    await expect(first).rejects.toMatchObject({
      errorCode: "project_query_changed",
      statusCode: 409,
    });
    expect(await readCellOutput(scope, input.projectId, input.cellId)).toEqual(
      output,
    );
    expect(await listRuns(scope, input.projectId)).toEqual(history);
    expect(
      await actor(() => getProjectQueryState(input.projectId, input.cellId)),
    ).toMatchObject({ status: "complete", busy: false });
  });
  it("report A2-STALE-RUN-PUBLICATION: legacy query state requires recovery and can be rerun", async () => {
    const input = await fixture();
    await putUserSetting(
      email,
      `analytics-2:query:${orgId}:${input.projectId}:${input.cellId}`,
      {
        requestId: randomUUID(),
        operation: randomUUID(),
        busy: true,
        connectionId: "qa-connection",
        sourceHash: createHash("sha256")
          .update("SELECT 9007199254740993 AS precise_id")
          .digest("hex"),
        startedAt: new Date().toISOString(),
        status: "running",
        job: { projectId: "qa-warehouse", jobId: "qa-job" },
        pageToken: null,
        totalRows: null,
      },
    );
    const snapshot = await actor(() =>
      getProject.run({ projectId: input.projectId }, context),
    );
    expect(snapshot.queryStates[input.cellId]).toEqual({
      status: "unavailable",
      busy: false,
      hasNextPage: false,
      totalRows: null,
      requestId: expect.any(String),
    });
    await expect(
      actor(() => runCell.run({ ...input, operation: "poll" }, context)),
    ).rejects.toMatchObject({
      code: "project_query_recovery_required",
      statusCode: 409,
    });
    expect(provider).not.toHaveBeenCalled();
    provider.mockResolvedValueOnce(page());
    await expect(
      actor(() => runCell.run(input, context)),
    ).resolves.toMatchObject({ status: "complete" });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  // oracle-change: a legacy SQL run no longer materializes its result as a private dataframe blob, so it records no materializationUnavailable marker when storage fails
  it("keeps ordinary results when a configured storage provider fails", async () => {
    let failReadiness = false;
    const put = vi.fn(async () => {
      throw new Error("storage transport failure");
    });
    registerPrivateBlobProvider({
      id: "failed-query-test",
      name: "Query test",
      isConfigured: () => {
        if (failReadiness) throw new Error("storage readiness failed");
        return true;
      },
      put,
      read: async () => {
        throw new Error("unexpected read");
      },
      delete: async () => ({ deleted: true, provider: "failed-query-test" }),
    });
    try {
      const input = await fixture();
      provider.mockResolvedValue(page({ rows: [["1"]] }));
      const result = await actor(() => runCell.run(input, context));
      expect(result.output).toMatchObject({ type: "table", rows: [[1]] });
      expect(result.output).not.toHaveProperty("materializationUnavailable");
      const stored = await readProjectOutputs(
        scope,
        input.projectId,
        undefined,
        {
          includeDataframeReferences: true,
          cellIds: [input.cellId],
        },
      );
      expect(stored[input.cellId]?.output).toEqual(result.output);
      failReadiness = true;
      const readinessResult = await actor(() => runCell.run(input, context));
      expect(readinessResult.output).toMatchObject({
        type: "table",
        rows: [[1]],
      });
      expect(put).not.toHaveBeenCalled();
    } finally {
      unregisterPrivateBlobProvider("failed-query-test");
    }
  });
  it("keeps the unconsumed first organization cursor when storage is unavailable", async () => {
    const providerId = "unconfigured-org-query-test";
    registerPrivateBlobProvider({
      id: providerId,
      name: "Query test",
      isConfigured: () => false,
      put: async () => {
        throw new Error("unexpected blob write");
      },
      read: async () => {
        throw new Error("unexpected blob read");
      },
      delete: async () => ({ deleted: true, provider: providerId }),
    });
    try {
      const input = await fixture({
        dataConnectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
      });
      provider
        .mockResolvedValueOnce(
          page({
            columns: [{ name: "amount", type: "INT64" }],
            rows: Array.from({ length: 1000 }, (_, i) => [String(i)]),
            totalRows: "1001",
            jobReference: { projectId: "qa-warehouse", jobId: "org.one" },
            pageToken: "org.one",
            hasNextPage: true,
          }),
        )
        .mockResolvedValueOnce(
          page({
            columns: [{ name: "amount", type: "INT64" }],
            rows: [["1000"]],
            totalRows: "1001",
          }),
        );
      const first = await actor(() => runCell.run(input, context));
      expect(first.hasNextPage).toBe(true);
      expect(provider).toHaveBeenCalledTimes(1);
      const next = await actor(() =>
        runCell.run({ ...input, operation: "next-page" }, context),
      );
      expect(provider.mock.calls[1]?.[0]).toMatchObject({
        job: { jobId: "org.one" },
        pageToken: "org.one",
      });
      expect(next.hasNextPage).toBe(false);
      expect(next.output).toMatchObject({ rowCount: 1001, truncated: false });
      expect(provider).toHaveBeenCalledTimes(2);
    } finally {
      unregisterPrivateBlobProvider(providerId);
    }
  });
  it("persists a failed run without pretending it produced an empty table", async () => {
    const input = await fixture();
    provider.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(actor(() => runCell.run(input, context))).rejects.toThrow(
      "Provider unavailable",
    );
    expect(
      await actor(() => getProjectQueryState(input.projectId, input.cellId)),
    ).toMatchObject({ status: "error", busy: false });
    expect(
      (await readCellOutput(scope, input.projectId, input.cellId))?.output
        ?.type,
    ).toBe("error");
  });
});
