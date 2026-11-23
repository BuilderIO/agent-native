import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import { and, eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  PrivateBlobError,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import {
  deleteWorkspaceConnection,
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { CellDraft, CellOutput } from "../app/lib/model/contracts.js";
import { getDb, schema } from "../server/db/index.js";
import {
  createComponent,
  listComponents,
  readComponent,
} from "../server/model/components-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { countDataframeBlobs } from "../server/model/dataframe-lifecycle.js";
import { storeDataframe } from "../server/model/dataframe-materialization.js";
import { encodeJsonColumn } from "../server/model/json-column.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { purgeDeletedProjectDataframes } from "../server/model/project-file-cleanup.js";
import {
  getProjectQueryStates,
  runProjectQuery,
} from "../server/model/project-query.js";
import {
  createProject,
  deleteProjectPermanently,
  updateProject,
} from "../server/model/projects-store.js";
import {
  clearCellOutput,
  clearProjectOutputs,
  listRuns,
  readCellOutput,
  readProjectOutputs,
  recordRun,
  writeCellOutput,
} from "../server/model/runs-store.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import getProject from "./get-project.js";
import listComponentsAction from "./list-components.js";
import saveProjectCell from "./save-project-cell.js";

/*
 * These cases pin read-time invariants for saved results and query states.
 * Orphan and malformed rows are seeded directly so the read boundary is
 * exercised independently of the writers; they are not a claim of a live
 * write exploit, nor a concurrency proof.
 */

const boundary = vi.hoisted(() => ({
  providerCalls: 0,
  credentialCalls: 0,
  workspaceCredentialCalls: 0,
}));

vi.mock(
  "../server/model/data-connection-provider.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../server/model/data-connection-provider.js")
      >();
    const fail = (name: string) => (): never => {
      boundary.providerCalls += 1;
      throw new Error(`Synthetic provider boundary was used: ${name}`);
    };
    return {
      ...actual,
      executeQueryPage: fail("executeQueryPage"),
      requestMetadata: fail("requestMetadata"),
      runtimeForConnection: fail("runtimeForConnection"),
      validateSubmittedServiceAccount: fail("validateSubmittedServiceAccount"),
    };
  },
);

/*
 * These four names are the audited runtime credential imports: the app imports
 * resolveCredentialForScope/saveCredential/deleteCredential, and the loaded
 * Core server graph also imports resolveCredential. A full factory avoids
 * evaluating the real secret store; there is no importOriginal here merely to
 * recover symbols or force an eval.
 */
vi.mock("@agent-native/core/credentials", () => {
  const fail = (name: string) => (): never => {
    boundary.credentialCalls += 1;
    throw new Error(`Synthetic credential boundary was used: ${name}`);
  };
  return {
    resolveCredential: fail("resolveCredential"),
    resolveCredentialForScope: fail("resolveCredentialForScope"),
    saveCredential: fail("saveCredential"),
    deleteCredential: fail("deleteCredential"),
  };
});

/*
 * Keep the real connection table, upsert, group and store behavior for this
 * DB fixture. Only the credential resolver is a throwing boundary, including
 * the path runtimeForConnection would otherwise take before provider work.
 */
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/workspace-connections")
    >();
  const failResolver = async (): Promise<never> => {
    boundary.workspaceCredentialCalls += 1;
    throw new Error("Synthetic workspace credential resolver was used");
  };
  return {
    ...actual,
    resolveWorkspaceConnectionCredentialForApp: failResolver,
  };
});

const round = mkdtempSync(join(tmpdir(), "result-provenance-"));
let previousDatabase: string | undefined;
const orgA = `qa-result-${randomUUID()}`;
const orgB = `qa-result-${randomUUID()}`;
const owner = "result-owner@example.test";
const member = "result-member@example.test";
const appId = "analytics-2";
const ownerScope = { ownerEmail: owner, orgId: orgA };
const memberScope = { ownerEmail: member, orgId: orgA };

let allowedConnectionId = "";
let deniedConnectionId = "";
let foreignConnectionId = "";

function asActor<T>(
  email: string,
  orgId: string,
  call: () => T,
): T | Promise<T> {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "Synthetic result fixture",
      isSyntheticTraffic: true,
    },
    call,
  );
}

const actionContext = (email = owner, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId,
});

const newCellId = (label: string) => `cell-${label}-${randomUUID()}`;

const baseCell = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;

function sqlCell(
  id: string,
  dataConnectionId: string | null = null,
): CellDraft {
  return {
    ...baseCell,
    id,
    kind: "sql",
    source: "select 1 as value",
    dataConnectionId,
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
  };
}

function codeCell(id: string): CellDraft {
  return {
    ...baseCell,
    id,
    kind: "code",
    language: "python",
    source: "value = 1",
    resultVariable: null,
    outputResult: true,
  };
}

function table(
  rows: Array<Array<string | number | boolean | null>>,
): CellOutput {
  return {
    type: "table",
    columns: [{ name: "value", type: "string" }],
    rows,
    rowCount: rows.length,
    truncated: false,
  };
}

function queryState(
  connectionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestId: randomUUID(),
    operation: randomUUID(),
    busy: false,
    connectionId,
    sourceHash: randomUUID(),
    startedAt: new Date().toISOString(),
    status: "complete",
    job: null,
    pageToken: null,
    totalRows: null,
    ...overrides,
  };
}

async function projectWith(
  cells: CellDraft[],
  ownerEmail = owner,
  orgId = orgA,
) {
  return createProject({
    ownerEmail,
    orgId,
    title: "Result provenance fixture",
    cells,
  });
}

async function seedState(
  email: string,
  orgId: string,
  projectId: string,
  cellId: string,
  value: Record<string, unknown>,
): Promise<void> {
  const cells = await getDb()
    .select({ contents: schema.cells.contents })
    .from(schema.cells)
    .innerJoin(
      schema.projects,
      and(
        eq(schema.projects.id, schema.cells.projectId),
        eq(schema.projects.workingVersionId, schema.cells.versionId),
      ),
    )
    .where(
      and(eq(schema.cells.projectId, projectId), eq(schema.cells.id, cellId)),
    )
    .limit(1);
  const cell = cells.at(0);
  if (cell) {
    const contents = JSON.parse(cell.contents);
    if (contents.kind === "sql")
      value.sourceHash = createHash("sha256")
        .update(contents.source)
        .digest("hex");
    if (typeof value.requestId !== "string")
      throw new Error("Missing fixture run identity");
    await getDb()
      .insert(schema.cellOutputGenerations)
      .values({ projectId, cellId, generation: value.requestId })
      .onConflictDoUpdate({
        target: schema.cellOutputGenerations.cellId,
        set: { generation: value.requestId },
      });
  }
  await asActor(email, orgId, () =>
    putUserSetting(
      email,
      `analytics-2:query:${orgId}:${projectId}:${cellId}`,
      value,
    ),
  );
}

async function seedOutput(input: {
  projectId: string;
  cellId: string;
  sourceConnectionId: string | null;
  output: CellOutput;
}): Promise<void> {
  await getDb()
    .insert(schema.cellOutputs)
    .values({
      cellId: input.cellId,
      projectId: input.projectId,
      runId: null,
      sourceConnectionId: input.sourceConnectionId,
      connectionProvenanceRecorded: true,
      status: "complete",
      output: encodeJsonColumn(input.output),
      ranAt: new Date().toISOString(),
    });
}

async function readProject(
  projectId: string,
  email = member,
  orgId = orgA,
  version?: string,
) {
  return asActor(email, orgId, () =>
    getProject.run(
      { projectId, ...(version === undefined ? {} : { version }) },
      actionContext(email, orgId),
    ),
  );
}

const orgMigrations: Array<{
  version: number;
  sql: string;
  name?: string;
}> = ORG_MIGRATIONS.map((migration) => {
  const normalized: { version: number; sql: string; name?: string } = {
    version: migration.version,
    sql: migration.sql,
  };
  if ("name" in migration && typeof migration.name === "string") {
    normalized.name = migration.name;
  }
  return normalized;
});

beforeAll(async () => {
  previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations(orgMigrations, {
    table: "qa_result_provenance_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();

  await getDb()
    .insert(organizations)
    .values([
      {
        id: orgA,
        name: "Synthetic result workspace",
        createdBy: owner,
        createdAt: Date.now(),
      },
      {
        id: orgB,
        name: "Synthetic result workspace",
        createdBy: owner,
        createdAt: Date.now(),
      },
    ]);
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: member,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgB,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
    ]);

  allowedConnectionId = (
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Synthetic readable results",
        allowedUsers: [],
        config: { viewAccessGroupIds: [] },
      }),
    )
  ).id;
  deniedConnectionId = (
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Synthetic restricted results",
        allowedUsers: [owner],
        config: { viewAccessGroupIds: [] },
      }),
    )
  ).id;
  foreignConnectionId = (
    await asActor(owner, orgB, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Synthetic other-workspace results",
        allowedUsers: [],
      }),
    )
  ).id;
});

afterEach(() => {
  expect(boundary.providerCalls).toBe(0);
  expect(boundary.credentialCalls).toBe(0);
  expect(boundary.workspaceCredentialCalls).toBe(0);
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (
    owned !== resolve(tmpdir()) &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(resolve(tmpdir()) + "/result-provenance-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else {
    throw new Error(
      "Refused cleanup outside the owned result-provenance round",
    );
  }
});

describe("project result provenance read boundary", () => {
  it("omits orphan output and state keys while keeping outputs of current working cells", async () => {
    const sqlId = newCellId("visible-sql");
    const codeId = newCellId("visible-code");
    const orphanId = newCellId("orphan");
    const project = await projectWith([sqlCell(sqlId), codeCell(codeId)]);
    const sqlOutput = table([["KEPT-SQL-OUTPUT"]]);
    const codeOutput: CellOutput = { type: "text", text: "KEPT-CODE-OUTPUT" };
    await recordRun({
      ...ownerScope,
      projectId: project.id,
      cellId: sqlId,
      status: "complete",
      output: sqlOutput,
    });
    await recordRun({
      ...ownerScope,
      projectId: project.id,
      cellId: codeId,
      status: "complete",
      output: codeOutput,
    });
    await seedOutput({
      projectId: project.id,
      cellId: orphanId,
      sourceConnectionId: allowedConnectionId,
      output: table([["ORPHAN-OUTPUT-SENTINEL"]]),
    });
    await seedState(
      owner,
      orgA,
      project.id,
      orphanId,
      queryState(allowedConnectionId, { totalRows: "ORPHAN-STATE-SENTINEL" }),
    );

    const result = await readProject(project.id, owner);
    expect(Object.keys(result.outputs).sort()).toEqual([codeId, sqlId].sort());
    expect(result.outputs[sqlId]?.output).toEqual(sqlOutput);
    expect(result.outputs[codeId]?.output).toEqual(codeOutput);
    expect(result.outputs[orphanId]).toBeUndefined();
    expect(result.queryStates[orphanId]).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("ORPHAN-OUTPUT-SENTINEL");
    expect(JSON.stringify(result)).not.toContain("ORPHAN-STATE-SENTINEL");
  });

  it.each(["never-written", "cleared", "null-selection"] as const)(
    "withholds a denied query state with a %s output even when the current cell selects allowed B or null",
    async (mode) => {
      const cellId = newCellId(`denied-state-${mode}`);
      const currentConnectionId =
        mode === "null-selection" ? null : allowedConnectionId;
      const project = await projectWith(
        [sqlCell(cellId, currentConnectionId)],
        member,
        orgA,
      );
      if (mode === "cleared") {
        await recordRun({
          ...memberScope,
          projectId: project.id,
          cellId,
          status: "complete",
          output: table([["B-ROW-SENTINEL"]]),
          sourceConnectionId: allowedConnectionId,
        });
        await clearCellOutput(memberScope, project.id, cellId);
      }
      await seedState(
        member,
        orgA,
        project.id,
        cellId,
        queryState(deniedConnectionId, {
          totalRows: "424242",
          pageToken: "shared-page-token",
        }),
      );

      const result = await readProject(project.id);
      expect(result.outputs[cellId]).toBeUndefined();
      expect(result.queryStates[cellId]).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("424242");
      expect(JSON.stringify(result)).not.toContain("shared-page-token");
      expect(JSON.stringify(result)).not.toContain("B-ROW-SENTINEL");

      const internal = await asActor(member, orgA, () =>
        getProjectQueryStates(project.id),
      );
      expect(internal[cellId]).toBeUndefined();
    },
  );

  // oracle-change: only the current SQL source, connection, and generation can expose query state; output provenance remains independent.
  it("preserves an authorized pending state with no output for the selected connection", async () => {
    const cellId = newCellId("pending-state");
    const project = await projectWith(
      [sqlCell(cellId, allowedConnectionId)],
      member,
      orgA,
    );
    const pending = {
      requestId: "00000000-0000-4000-8000-000000000001",
      status: "running",
      busy: true,
      hasNextPage: false,
      totalRows: null,
    };
    await seedState(
      member,
      orgA,
      project.id,
      cellId,
      queryState(allowedConnectionId, {
        requestId: pending.requestId,
        status: "running",
        busy: true,
        job: { projectId: "fixture-job-space", jobId: "fixture-job" },
      }),
    );

    const result = await readProject(project.id);
    expect(result.outputs[cellId]).toBeUndefined();
    expect(result.queryStates[cellId]).toEqual(pending);

    const internal = await asActor(member, orgA, () =>
      getProjectQueryStates(project.id),
    );
    expect(internal[cellId]).toEqual(pending);
  });

  it("redacts a dataframe derived from a connection the viewer cannot read", async () => {
    const cellId = newCellId("derived-restricted");
    const project = await projectWith([sqlCell(cellId)], member, orgA);
    await seedOutput({
      projectId: project.id,
      cellId,
      sourceConnectionId: null,
      output: {
        type: "table",
        columns: [{ name: "value", type: "string" }],
        rows: [["restricted-derived-row"]],
        rowCount: 1,
        truncated: false,
        materialization: {
          version: 1,
          handle: {
            id: "fixture-blob",
            provider: "fixture-provider",
            opaque: true,
            encrypted: true,
          },
          snapshot: "a".repeat(64),
          digest: "b".repeat(64),
          dependencies: [
            {
              cellId: "source",
              generation: "generation",
              connectionId: deniedConnectionId,
              snapshot: "c".repeat(64),
            },
          ],
        },
      },
    });
    const result = await readProject(project.id);
    expect(result.outputs[cellId]?.output).toMatchObject({ type: "error" });
    expect(JSON.stringify(result)).not.toContain("restricted-derived-row");
    await expect(
      asActor(member, orgA, () => readProjectOutputs(memberScope, project.id)),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_capture_unavailable",
    });
  });

  it("keeps an authorized state from its own producer when the output came from a denied connection", async () => {
    const cellId = newCellId("mixed-producer");
    const project = await projectWith(
      [sqlCell(cellId, allowedConnectionId)],
      member,
      orgA,
    );
    await recordRun({
      ...memberScope,
      projectId: project.id,
      cellId,
      status: "complete",
      output: table([["DENIED-B-ROW"]]),
      sourceConnectionId: deniedConnectionId,
    });
    await seedState(
      member,
      orgA,
      project.id,
      cellId,
      queryState(allowedConnectionId, {
        totalRows: "41",
        requestId: "00000000-0000-4000-8000-000000000002",
      }),
    );

    const result = await readProject(project.id);
    expect(result.outputs[cellId]?.output).toEqual({
      type: "error",
      message:
        "You do not have access to view results from this data connection.",
      detail: null,
    });
    expect(result.queryStates[cellId]).toEqual({
      status: "complete",
      busy: false,
      hasNextPage: false,
      totalRows: "41",
      requestId: "00000000-0000-4000-8000-000000000002",
    });
    expect(JSON.stringify(result)).not.toContain("DENIED-B-ROW");
  });

  it("withholds a denied state from its own producer when the output came from an allowed connection", async () => {
    const cellId = newCellId("opposite-producer");
    const project = await projectWith(
      [sqlCell(cellId, allowedConnectionId)],
      member,
      orgA,
    );
    const visible = table([["ALLOWED-A-ROW"]]);
    await recordRun({
      ...memberScope,
      projectId: project.id,
      cellId,
      status: "complete",
      output: visible,
      sourceConnectionId: allowedConnectionId,
    });
    await seedState(
      member,
      orgA,
      project.id,
      cellId,
      queryState(deniedConnectionId, {
        totalRows: "525252",
        pageToken: "shared-page-token",
      }),
    );

    const result = await readProject(project.id);
    expect(result.outputs[cellId]?.output).toEqual(visible);
    expect(result.queryStates[cellId]).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("525252");
    expect(JSON.stringify(result)).not.toContain("shared-page-token");
  });

  it("treats a recorded-false output as unknown even when it carries a readable connection id", async () => {
    const cellId = newCellId("recorded-false");
    const project = await projectWith(
      [sqlCell(cellId, allowedConnectionId)],
      member,
      orgA,
    );
    await recordRun({
      ...memberScope,
      projectId: project.id,
      cellId,
      status: "complete",
      output: table([["UNVERIFIED-ROW"]]),
      sourceConnectionId: allowedConnectionId,
    });
    await getDb()
      .update(schema.cellOutputs)
      .set({ connectionProvenanceRecorded: false })
      .where(eq(schema.cellOutputs.cellId, cellId));
    await seedState(
      member,
      orgA,
      project.id,
      cellId,
      queryState(allowedConnectionId, {
        totalRows: "61",
        requestId: "00000000-0000-4000-8000-000000000003",
      }),
    );

    const result = await readProject(project.id);
    expect(result.outputs[cellId]?.output).toEqual({
      type: "error",
      message: "Run this cell again to verify access to its results.",
      detail: null,
    });
    expect(result.queryStates[cellId]).toEqual({
      status: "complete",
      busy: false,
      hasNextPage: false,
      totalRows: "61",
      requestId: "00000000-0000-4000-8000-000000000003",
    });
    expect(JSON.stringify(result)).not.toContain("UNVERIFIED-ROW");
  });

  it("withholds query-state counts for deleted, unknown and foreign connections", async () => {
    const deletedCellId = newCellId("deleted-connection");
    const unknownCellId = newCellId("unknown-connection");
    const foreignCellId = newCellId("foreign-connection");
    const deletedConnectionId = (
      await asActor(owner, orgA, () =>
        upsertWorkspaceConnection({
          provider: "bigquery",
          label: "Synthetic connection deleted before read",
          allowedUsers: [],
          config: { viewAccessGroupIds: [] },
        }),
      )
    ).id;
    expect(
      await asActor(owner, orgA, () =>
        deleteWorkspaceConnection(deletedConnectionId),
      ),
    ).toBe(true);
    expect(
      await asActor(owner, orgA, () =>
        getWorkspaceConnection(deletedConnectionId),
      ),
    ).toBeNull();

    const project = await projectWith(
      [
        sqlCell(deletedCellId, allowedConnectionId),
        sqlCell(unknownCellId, allowedConnectionId),
        sqlCell(foreignCellId, allowedConnectionId),
      ],
      member,
      orgA,
    );
    await seedState(
      member,
      orgA,
      project.id,
      deletedCellId,
      queryState(deletedConnectionId, {
        totalRows: "61616",
        pageToken: "shared-page-token",
      }),
    );
    await seedState(
      member,
      orgA,
      project.id,
      unknownCellId,
      queryState(randomUUID(), {
        totalRows: "71717",
        pageToken: "shared-page-token",
      }),
    );
    await seedState(
      member,
      orgA,
      project.id,
      foreignCellId,
      queryState(foreignConnectionId, {
        totalRows: "81818",
        pageToken: "shared-page-token",
      }),
    );

    const result = await readProject(project.id);
    expect(result.queryStates[deletedCellId]).toBeUndefined();
    expect(result.queryStates[unknownCellId]).toBeUndefined();
    expect(result.queryStates[foreignCellId]).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("61616");
    expect(JSON.stringify(result)).not.toContain("71717");
    expect(JSON.stringify(result)).not.toContain("81818");
  });

  it("keeps published builtin SQL results after a working rerun changes the row count", async () => {
    const cellId = newCellId("published-output");
    const draft = sqlCell(cellId, SAMPLE_DATA_SOURCE_ID);
    if (draft.kind !== "sql") throw new Error("SQL fixture required");
    draft.source = "select product_id from products limit 2";
    const project = await projectWith([draft]);
    const run = () =>
      asActor(owner, orgA, () =>
        runProjectQuery({ projectId: project.id, cellId }, "frontend"),
      );
    const first = await run();
    expect(first.output).toMatchObject({
      type: "table",
      rowCount: 2,
      rows: [["prd_001"], ["prd_002"]],
    });
    const published = await asActor(owner, orgA, () =>
      seedLegacyPublishedProject(ownerScope, project.id),
    );
    const publishedVersionId = published.publishedVersionId;
    const cell = published.cells.find((item) => item.id === cellId);
    if (!publishedVersionId || !cell || cell.contents.kind !== "sql")
      throw new Error("Published SQL cell missing");
    await asActor(owner, orgA, () =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId,
          expectedUpdatedAt: cell.updatedAt,
          contents: {
            ...cell.contents,
            source: "select product_id from products limit 3",
          },
        },
        actionContext(),
      ),
    );
    const second = await run();
    expect(second.output).toMatchObject({
      type: "table",
      rowCount: 3,
      rows: [["prd_001"], ["prd_002"], ["prd_003"]],
    });
    const historical = await asActor(owner, orgA, () =>
      getProject.run(
        {
          projectId: project.id,
          version: publishedVersionId,
        },
        actionContext(),
      ),
    );
    expect(
      historical.project.cells.find((item) => item.id === cellId)?.contents,
    ).toMatchObject({ source: draft.source });
    expect(historical.outputs[cellId]?.output).toEqual(first.output);
    await seedState(
      owner,
      orgA,
      project.id,
      cellId,
      queryState(SAMPLE_DATA_SOURCE_ID, { totalRows: "313131" }),
    );
    expect(
      (await readProject(project.id, owner)).queryStates[cellId]?.totalRows,
    ).toBe("313131");
    expect(
      (await readProject(project.id, owner, orgA, publishedVersionId))
        .queryStates,
    ).toEqual({});
    const republished = await asActor(owner, orgA, () =>
      seedLegacyPublishedProject(ownerScope, project.id),
    );
    expect(republished.publishedVersionId).not.toBe(publishedVersionId);
    expect(
      (await readProject(project.id, owner, orgA, publishedVersionId)).outputs[
        cellId
      ]?.output,
    ).toEqual(first.output);
    expect(
      (await readProject(project.id, owner, orgA, "latest")).outputs[cellId]
        ?.output,
    ).toEqual(second.output);
    await clearCellOutput(ownerScope, project.id, cellId);
    expect(
      (await readProject(project.id, owner)).outputs[cellId],
    ).toBeUndefined();
    expect(
      (await readProject(project.id, owner, orgA, publishedVersionId)).outputs[
        cellId
      ]?.output,
    ).toEqual(first.output);
    expect(
      (await readProject(project.id, owner, orgA, "latest")).outputs[cellId]
        ?.output,
    ).toEqual(second.output);
  });

  it("distinguishes a known empty snapshot from an unavailable legacy snapshot", async () => {
    const cellId = newCellId("empty-published-output");
    const draft = sqlCell(cellId, SAMPLE_DATA_SOURCE_ID);
    if (draft.kind !== "sql") throw new Error("SQL fixture required");
    draft.source = "select product_id from products limit 2";
    const project = await projectWith([draft]);
    const published = await asActor(owner, orgA, () =>
      seedLegacyPublishedProject(ownerScope, project.id),
    );
    const versionId = published.publishedVersionId;
    if (!versionId) throw new Error("Published version missing");
    await asActor(owner, orgA, () =>
      runProjectQuery({ projectId: project.id, cellId }, "frontend"),
    );
    expect(
      (await readProject(project.id, owner)).outputs[cellId]?.output,
    ).toMatchObject({ type: "table", rowCount: 2 });
    expect(
      (await readProject(project.id, owner, orgA, versionId)).outputs,
    ).toEqual({});
    await getDb()
      .update(schema.projectVersions)
      .set({ capturedOutputCount: null })
      .where(eq(schema.projectVersions.id, versionId));
    await expect(
      readProject(project.id, owner, orgA, versionId),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "published_snapshot_unavailable",
    });
  });

  it.each(["payload", "cardinality"] as const)(
    "fails loudly on an unreadable published snapshot %s",
    async (mode) => {
      const cellId = newCellId(`corrupt-snapshot-${mode}`);
      const project = await projectWith([
        sqlCell(cellId, SAMPLE_DATA_SOURCE_ID),
      ]);
      await recordRun({
        ...ownerScope,
        projectId: project.id,
        cellId,
        status: "complete",
        output: table([["SNAPSHOT-ROW"]]),
        sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
      });
      const published = await asActor(owner, orgA, () =>
        seedLegacyPublishedProject(ownerScope, project.id),
      );
      const versionId = published.publishedVersionId;
      if (!versionId) throw new Error("Published version missing");
      if (mode === "payload")
        await getDb()
          .update(schema.publishedCellOutputs)
          .set({ output: "{" })
          .where(eq(schema.publishedCellOutputs.versionId, versionId));
      else
        await getDb()
          .update(schema.projectVersions)
          .set({ capturedOutputCount: 2 })
          .where(eq(schema.projectVersions.id, versionId));
      await expect(
        readProject(project.id, owner, orgA, versionId),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "analytics_unreadable_stored_data",
      });
    },
  );

  it("redacts published snapshot rows after the app's connection grant is revoked", async () => {
    const connection = await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Snapshot grant fixture",
        allowedApps: [appId],
      }),
    );
    const cellId = newCellId("revoked-published-output");
    const project = await projectWith([sqlCell(cellId, connection.id)]);
    const output = table([["PRIVATE-PUBLISHED-ROW"]]);
    await recordRun({
      ...ownerScope,
      projectId: project.id,
      cellId,
      status: "complete",
      output,
      sourceConnectionId: connection.id,
    });
    const published = await asActor(owner, orgA, () =>
      seedLegacyPublishedProject(ownerScope, project.id),
    );
    const versionId = published.publishedVersionId;
    if (!versionId) throw new Error("Published version missing");
    expect(
      (await readProject(project.id, owner, orgA, versionId)).outputs[cellId]
        ?.output,
    ).toEqual(output);
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        id: connection.id,
        provider: "bigquery",
        label: "Snapshot grant fixture",
        allowedApps: ["another-app"],
      }),
    );
    const denied = await readProject(project.id, owner, orgA, versionId);
    expect(denied.outputs[cellId]?.output).toMatchObject({
      type: "error",
      message:
        "You do not have access to view results from this data connection.",
    });
    expect(JSON.stringify(denied)).not.toContain("PRIVATE-PUBLISHED-ROW");
  });

  it("keeps bundled sample SQL results when the project is read after running", async () => {
    const cellId = newCellId("builtin-sample");
    const draft = sqlCell(cellId, SAMPLE_DATA_SOURCE_ID);
    if (draft.kind !== "sql") throw new Error("SQL fixture required");
    draft.source = "select product_id from products limit 2";
    const project = await projectWith([draft]);
    const expected: CellOutput = {
      type: "table",
      columns: [{ name: "product_id", type: "string" }],
      rows: [["prd_001"], ["prd_002"]],
      rowCount: 2,
      truncated: false,
    };

    const run = await asActor(owner, orgA, () =>
      runProjectQuery({ projectId: project.id, cellId }, "frontend"),
    );
    expect(run.status).toBe("complete");
    expect(run.output).toEqual(expected);

    const reread = await readProject(project.id, owner);
    expect(reread.outputs[cellId]?.output).toEqual(expected);
    expect(reread.outputs[cellId]?.sourceConnectionId).toBe(
      SAMPLE_DATA_SOURCE_ID,
    );
    expect(reread.outputs[cellId]?.connectionProvenanceRecorded).toBe(true);
  });

  it("keeps recorded local code and omitted-source SQL null outputs without a credential or provider lookup", async () => {
    const codeId = newCellId("local-code");
    const sqlId = newCellId("local-sql-null");
    const project = await projectWith([codeCell(codeId), sqlCell(sqlId, null)]);
    const codeOutput: CellOutput = {
      type: "text",
      text: "LOCAL-CODE-OUTPUT",
    };
    const sqlOutput = table([["LOCAL-SQL-NULL-OUTPUT"]]);
    await recordRun({
      ...ownerScope,
      projectId: project.id,
      cellId: codeId,
      status: "complete",
      output: codeOutput,
    });
    await recordRun({
      ...ownerScope,
      projectId: project.id,
      cellId: sqlId,
      status: "complete",
      output: sqlOutput,
    });

    const result = await readProject(project.id, owner);
    expect(result.outputs[codeId]?.output).toEqual(codeOutput);
    expect(result.outputs[sqlId]?.output).toEqual(sqlOutput);
    expect(boundary.providerCalls).toBe(0);
    expect(boundary.credentialCalls).toBe(0);
    expect(boundary.workspaceCredentialCalls).toBe(0);
  });

  it("rejects an explicit null SQL producer without history or output, while omission stays allowed", async () => {
    const omittedId = newCellId("omitted-null");
    const explicitId = newCellId("explicit-null");
    const project = await projectWith([
      sqlCell(omittedId, null),
      sqlCell(explicitId, null),
    ]);
    const omittedOutput = table([["OMITTED-NULL-OUTPUT"]]);
    await recordRun({
      ...ownerScope,
      projectId: project.id,
      cellId: omittedId,
      status: "complete",
      output: omittedOutput,
    });

    await expect(
      recordRun({
        ...ownerScope,
        projectId: project.id,
        cellId: explicitId,
        status: "complete",
        output: table([["EXPLICIT-NULL-OUTPUT"]]),
        sourceConnectionId: null,
      }),
    ).rejects.toThrow();
    const explicitRuns = (await listRuns(ownerScope, project.id)).filter(
      (run) => run.cellId === explicitId,
    );
    expect(explicitRuns).toHaveLength(0);
    expect(await readCellOutput(ownerScope, project.id, explicitId)).toBeNull();

    await expect(
      writeCellOutput({
        ...ownerScope,
        projectId: project.id,
        cellId: explicitId,
        runId: null,
        status: "complete",
        output: table([["EXPLICIT-NULL-WRITE"]]),
        sourceConnectionId: null,
      }),
    ).rejects.toThrow();
    expect(await readCellOutput(ownerScope, project.id, explicitId)).toBeNull();

    const result = await readProject(project.id, owner);
    expect(result.outputs[omittedId]?.output).toEqual(omittedOutput);
    expect(result.outputs[explicitId]).toBeUndefined();
  });
});

describe("dataframe result lifecycle", () => {
  const blobs = new Map<string, Uint8Array>();
  const control = {
    failDelete: false,
    onDelete: null as null | (() => Promise<void>),
  };

  beforeAll(() => {
    registerPrivateBlobProvider({
      id: "lifecycle-memory",
      name: "Lifecycle test",
      isConfigured: () => true,
      put: async ({ data }) => {
        const id = randomUUID();
        blobs.set(id, new Uint8Array(data));
        return {
          id,
          provider: "lifecycle-memory",
          opaque: true,
          encrypted: true,
        };
      },
      read: async (handle) => {
        const data = blobs.get(handle.id);
        if (!data) throw new PrivateBlobError("Missing blob", "gone");
        return { data, handle };
      },
      delete: async (handle) => {
        if (control.failDelete)
          throw new PrivateBlobError("Storage offline", "unavailable");
        await control.onDelete?.();
        return {
          deleted: blobs.delete(handle.id),
          provider: "lifecycle-memory",
        };
      },
    });
  });
  afterAll(() => unregisterPrivateBlobProvider("lifecycle-memory"));

  async function derived(connectionId: string | null, label: string) {
    const data = {
      type: "table" as const,
      columns: [{ name: "value", type: "string" as const }],
      rows: [[label]],
      rowCount: 1,
      truncated: false,
    };
    const stored = await asActor(owner, orgA, () =>
      storeDataframe(data, owner),
    );
    const output: CellOutput = {
      ...data,
      materialization: {
        version: 1,
        ...stored,
        snapshot: "a".repeat(64),
        dependencies: [
          {
            cellId: "source",
            generation: "generation",
            connectionId,
            snapshot: "c".repeat(64),
          },
        ],
      },
    };
    return { output, blobId: stored.handle.id };
  }

  async function writeDerived(
    scope: typeof ownerScope,
    projectId: string,
    cellId: string,
    output: CellOutput,
    mode: "run" | "output" = "output",
  ) {
    if (mode === "run")
      await recordRun({
        ...scope,
        projectId,
        cellId,
        status: "complete",
        output,
      });
    else
      await writeCellOutput({
        ...scope,
        projectId,
        cellId,
        runId: null,
        status: "complete",
        output,
      });
  }

  it("captures only the selected cells and authorizes each derived result's lineage", async () => {
    const plainId = newCellId("plain");
    const readableId = newCellId("readable");
    const restrictedId = newCellId("restricted");
    const project = await projectWith(
      [
        sqlCell(plainId, allowedConnectionId),
        sqlCell(readableId, null),
        sqlCell(restrictedId, null),
      ],
      member,
      orgA,
    );
    await recordRun({
      ...memberScope,
      projectId: project.id,
      cellId: plainId,
      status: "complete",
      output: table([["PLAIN-ROW"]]),
      sourceConnectionId: allowedConnectionId,
    });
    const readable = await derived(allowedConnectionId, "READABLE-DERIVED");
    const restricted = await derived(deniedConnectionId, "RESTRICTED-DERIVED");
    await writeDerived(memberScope, project.id, readableId, readable.output);
    await writeDerived(
      memberScope,
      project.id,
      restrictedId,
      restricted.output,
    );
    const capture = (name: string, cellIds: string[]) =>
      asActor(member, orgA, () =>
        createComponent(memberScope, {
          projectId: project.id,
          name,
          cellIds,
          caller: "frontend",
        }),
      );

    // An unrelated warehouse-derived output elsewhere in the project must not
    // block capturing a cell that has an ordinary result.
    const plain = await capture(`plain-${randomUUID()}`, [plainId]);
    expect(
      (
        await asActor(member, orgA, () =>
          readComponent(memberScope, plain.id, "frontend"),
        )
      )?.cells[0]?.output,
    ).toEqual(table([["PLAIN-ROW"]]));

    const authorized = await capture(`readable-${randomUUID()}`, [readableId]);
    const stored = await asActor(member, orgA, () =>
      readComponent(memberScope, authorized.id, "frontend"),
    );
    expect(stored?.cells[0]?.output).toMatchObject({
      type: "table",
      rows: [["READABLE-DERIVED"]],
    });
    expect(JSON.stringify(stored)).not.toContain(readable.blobId);
    expect(JSON.stringify(stored)).not.toContain("materialization");

    const before = (
      await asActor(member, orgA, () => listComponents(memberScope))
    ).length;
    await expect(
      capture(`restricted-${randomUUID()}`, [restrictedId]),
    ).rejects.toMatchObject({
      errorCode: "data_connection_result_access_denied",
      statusCode: 403,
    });
    expect(
      (await asActor(member, orgA, () => listComponents(memberScope))).length,
    ).toBe(before);

    const read = await readProject(project.id);
    expect(read.outputs[readableId]?.output).toMatchObject({
      type: "table",
      rows: [["READABLE-DERIVED"]],
    });
    expect(read.outputs[restrictedId]?.output).toMatchObject({ type: "error" });
    expect(JSON.stringify(read)).not.toContain(readable.blobId);
    expect(JSON.stringify(read)).not.toContain(restricted.blobId);
    expect(JSON.stringify(read)).not.toContain("RESTRICTED-DERIVED");

    // Revoking the source after capture denies a fresh capture and read.
    const revocable = await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Revocable lineage",
        allowedUsers: [],
        config: { viewAccessGroupIds: [] },
      }),
    );
    const revocableId = newCellId("revocable");
    const second = await projectWith(
      [sqlCell(revocableId, null)],
      member,
      orgA,
    );
    await writeDerived(
      memberScope,
      second.id,
      revocableId,
      (await derived(revocable.id, "REVOKED-DERIVED")).output,
    );
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        id: revocable.id,
        provider: "bigquery",
        label: "Revocable lineage",
        allowedUsers: [owner],
        config: { viewAccessGroupIds: [] },
      }),
    );
    await expect(
      asActor(member, orgA, () =>
        createComponent(memberScope, {
          projectId: second.id,
          name: `revoked-${randomUUID()}`,
          cellIds: [revocableId],
          caller: "frontend",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const redacted = await readProject(second.id);
    expect(redacted.outputs[revocableId]?.output).toMatchObject({
      type: "error",
    });
    expect(JSON.stringify(redacted)).not.toContain("REVOKED-DERIVED");
  });

  it("reauthorizes captured derived and direct results when a component is read or imported", async () => {
    const connection = await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Component revocation",
        allowedUsers: [],
      }),
    );
    const derivedId = newCellId("component-derived");
    const directId = newCellId("component-direct");
    const plainId = newCellId("component-unrelated");
    const project = await projectWith(
      [sqlCell(derivedId), sqlCell(directId), codeCell(plainId)],
      member,
      orgA,
    );
    const data = await derived(connection.id, "COMPONENT-DERIVED-SECRET");
    await writeDerived(memberScope, project.id, derivedId, data.output);
    await recordRun({
      ...memberScope,
      projectId: project.id,
      cellId: directId,
      status: "complete",
      output: table([["COMPONENT-DIRECT-SECRET"]]),
      sourceConnectionId: connection.id,
    });
    await recordRun({
      ...memberScope,
      projectId: project.id,
      cellId: plainId,
      status: "complete",
      output: { type: "text", text: "UNRELATED" },
    });
    const capture = (cellIds: string[]) =>
      asActor(member, orgA, () =>
        createComponent(memberScope, {
          projectId: project.id,
          name: randomUUID(),
          cellIds,
          caller: "frontend",
        }),
      );
    const derivedComponent = await capture([derivedId]);
    const directComponent = await capture([directId]);
    const setAccess = (allowedUsers: string[]) =>
      asActor(owner, orgA, () =>
        upsertWorkspaceConnection({
          id: connection.id,
          provider: "bigquery",
          label: "Component revocation",
          allowedUsers,
        }),
      );
    await setAccess([owner]);
    const denied = {
      statusCode: 403,
      errorCode: "data_connection_result_access_denied",
    };
    for (const component of [derivedComponent, directComponent]) {
      await expect(
        asActor(member, orgA, () =>
          readComponent(memberScope, component.id, "frontend"),
        ),
      ).rejects.toMatchObject(denied);
      await expect(
        asActor(member, orgA, () =>
          listComponentsAction.run(
            { componentId: component.id },
            actionContext(member),
          ),
        ),
      ).rejects.toMatchObject(denied);
    }
    const unrelated = await capture([plainId]);
    expect(
      (
        await asActor(member, orgA, () =>
          readComponent(memberScope, unrelated.id, "frontend"),
        )
      )?.cells[0]?.output,
    ).toEqual({ type: "text", text: "UNRELATED" });
    await setAccess([]);
    const restored = await asActor(member, orgA, () =>
      listComponentsAction.run(
        { componentId: derivedComponent.id },
        actionContext(member),
      ),
    );
    expect(restored).toMatchObject({
      cells: [{ output: { rows: [["COMPONENT-DERIVED-SECRET"]] } }],
    });
    expect(JSON.stringify(restored)).not.toContain(data.blobId);
    const direct = await asActor(member, orgA, () =>
      readComponent(memberScope, directComponent.id, "frontend"),
    );
    expect(direct?.cells[0]?.output).toEqual(
      table([["COMPONENT-DIRECT-SECRET"]]),
    );
  });

  it("rejects unreadable component snapshots and hides legacy private result fields", async () => {
    const cellId = newCellId("component-corrupt");
    const project = await projectWith([sqlCell(cellId, null)], owner, orgA);
    const component = await asActor(owner, orgA, () =>
      createComponent(ownerScope, {
        projectId: project.id,
        name: randomUUID(),
        cellIds: [cellId],
        caller: "frontend",
      }),
    );
    const original = (await readComponent(ownerScope, component.id, "frontend"))
      ?.cells[0];
    if (!original) throw new Error("Captured component cell is missing.");
    const setSnapshot = async (value: string) => {
      await getDbExec().execute({
        sql: 'UPDATE "analytics2_components" SET "cells_json" = ? WHERE "id" = ?',
        args: [value, component.id],
      });
    };
    for (const value of [
      "{",
      "{}",
      "[null]",
      JSON.stringify([
        { ...original, output: { type: "table" }, sourceConnectionIds: [] },
      ]),
    ]) {
      await setSnapshot(value);
      for (const read of [
        () => readComponent(ownerScope, component.id, "frontend"),
        () => listComponentsAction.run({}, actionContext()),
        () =>
          listComponentsAction.run(
            { componentId: component.id },
            actionContext(),
          ),
      ]) {
        await expect(asActor(owner, orgA, read)).rejects.toMatchObject({
          code: "analytics_unreadable_stored_data",
          statusCode: 500,
        });
      }
    }
    const data = await derived(null, "LEGACY-PRIVATE");
    await setSnapshot(JSON.stringify([{ ...original, output: data.output }]));
    await expect(
      asActor(owner, orgA, () =>
        listComponentsAction.run(
          { componentId: component.id },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "component_provenance_unavailable",
      statusCode: 409,
    });
    await setSnapshot(
      JSON.stringify([
        {
          ...original,
          output: {
            ...data.output,
            materializationUnavailable: {
              errorCode: "project_dataframe_storage_unavailable",
              reason: "private detail",
              snapshot: "a".repeat(64),
            },
          },
          sourceConnectionIds: [],
        },
      ]),
    );
    const result = await asActor(owner, orgA, () =>
      listComponentsAction.run({ componentId: component.id }, actionContext()),
    );
    expect(result).toMatchObject({
      cells: [{ output: { rows: [["LEGACY-PRIVATE"]] } }],
    });
    expect(JSON.stringify(result)).not.toContain("materialization");
    expect(JSON.stringify(result)).not.toContain("private detail");
    expect(JSON.stringify(result)).not.toContain(data.blobId);
  });

  it("keeps blobs that runs and published snapshots still refer to, and retries a failed project delete", async () => {
    const cellId = newCellId("lifecycle");
    const project = await projectWith([sqlCell(cellId, null)], owner, orgA);
    const base = {
      scope: ownerScope,
      projectId: project.id,
      cellId,
    };
    const first = await derived(null, "RUN-RETAINED");
    await writeDerived(base.scope, project.id, cellId, first.output, "run");
    const second = await derived(null, "PUBLISHED-RETAINED");
    await writeDerived(base.scope, project.id, cellId, second.output);
    await asActor(owner, orgA, () =>
      seedLegacyPublishedProject(ownerScope, project.id),
    );
    const third = await derived(null, "REPLACED-UNREFERENCED");
    await writeDerived(base.scope, project.id, cellId, third.output);
    expect(await countDataframeBlobs(ownerScope, project.id)).toBe(3);

    // Clearing the working output drops one reference; the run and the
    // published version still hold the other two, and nothing is deleted
    // while a retained reference exists.
    await asActor(owner, orgA, () =>
      clearProjectOutputs(ownerScope, project.id),
    );
    expect(blobs.has(first.blobId)).toBe(true);
    expect(blobs.has(second.blobId)).toBe(true);
    expect(blobs.has(third.blobId)).toBe(false);
    expect(await countDataframeBlobs(ownerScope, project.id)).toBe(2);

    await asActor(owner, orgA, () =>
      updateProject({ ...ownerScope, projectId: project.id, trashed: true }),
    );
    const projectRowsAtDelete: number[] = [];
    control.failDelete = true;
    await expect(
      asActor(owner, orgA, () =>
        deleteProjectPermanently(ownerScope, project.id),
      ),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_cleanup_failed",
      statusCode: 503,
    });
    expect(
      await getDb()
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, project.id)),
    ).toHaveLength(0);
    expect(blobs.has(first.blobId)).toBe(true);
    expect(blobs.has(second.blobId)).toBe(true);
    const pending = await getDb()
      .select()
      .from(schema.dataframeBlobs)
      .where(eq(schema.dataframeBlobs.projectId, project.id));
    const retrying = pending.filter((row) => row.lastError !== "deleted");
    const tombstones = pending.filter((row) => row.lastError === "deleted");
    expect(retrying).toHaveLength(2);
    expect(retrying.every((row) => row.state === "deleting")).toBe(true);
    expect(retrying.every((row) => row.attempts === 1)).toBe(true);
    // Successful removal retains a tombstone to prevent stale publishers resurrecting the handle.
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({
      handleId: third.blobId,
      state: "deleting",
    });

    // A blob already gone from storage counts as removed; the other is deleted
    // only after the project's own delete has committed.
    blobs.delete(first.blobId);
    control.failDelete = false;
    control.onDelete = async () => {
      projectRowsAtDelete.push(
        (
          await getDb()
            .select({ id: schema.projects.id })
            .from(schema.projects)
            .where(eq(schema.projects.id, project.id))
        ).length,
      );
    };
    try {
      expect(
        await asActor(owner, orgA, () =>
          purgeDeletedProjectDataframes(ownerScope, project.id),
        ),
      ).toEqual({ removed: 2 });
    } finally {
      control.onDelete = null;
    }
    expect(projectRowsAtDelete.every((count) => count === 0)).toBe(true);
    expect(blobs.has(second.blobId)).toBe(false);
    expect(await countDataframeBlobs(ownerScope, project.id)).toBe(0);
    expect(
      await asActor(owner, orgA, () =>
        purgeDeletedProjectDataframes(ownerScope, project.id),
      ),
    ).toEqual({ removed: 0 });
  });
});
