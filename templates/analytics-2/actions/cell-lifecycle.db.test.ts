import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CellOutput } from "../app/lib/model/contracts.js";
import { getDb, schema } from "../server/db/index.js";
import {
  readCells,
  replaceSqlConnection,
  updateCellsAtomic,
} from "../server/model/cells-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  countDataframeBlobs,
  sweepDataframeBlobs,
} from "../server/model/dataframe-lifecycle.js";
import { storeDataframe } from "../server/model/dataframe-materialization.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { createProject } from "../server/model/projects-store.js";
import { recordRun, writeCellOutput } from "../server/model/runs-store.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import deleteProjectCell from "./delete-project-cell.js";

const dir = mkdtempSync(join(tmpdir(), "cell-lifecycle-"));
const ownerEmail = "cell-lifecycle@example.test";
const orgId = `cell-lifecycle-${randomUUID()}`;
const scope = { ownerEmail, orgId };
const blobs = new Map<string, Uint8Array>();
let previousDatabase: string | undefined;
let failDelete = false;
const actor = <T>(fn: () => T) =>
  runWithRequestContext(
    {
      userEmail: ownerEmail,
      orgId,
      authUserId: ownerEmail,
      userName: "Test",
      isSyntheticTraffic: true,
    },
    fn,
  );
const context = {
  caller: "frontend" as const,
  userEmail: ownerEmail,
  orgId,
  appId: "analytics-2",
};
beforeAll(async () => {
  previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `pglite:${join(dir, "database")}`;
  await runMigrations(
    ORG_MIGRATIONS.map(({ version, sql }) => ({ version, sql })),
    { table: "cell_lifecycle_org_migrations" },
  )(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "Cell lifecycle",
    createdBy: ownerEmail,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: ownerEmail,
    role: "owner",
    joinedAt: Date.now(),
  });
  registerPrivateBlobProvider({
    id: "cell-lifecycle-memory",
    name: "Cell lifecycle test",
    isConfigured: () => true,
    put: async ({ data }) => {
      const id = randomUUID();
      blobs.set(id, new Uint8Array(data));
      return {
        id,
        provider: "cell-lifecycle-memory",
        opaque: true,
        encrypted: true,
      };
    },
    read: async (handle) => {
      const data = blobs.get(handle.id);
      if (!data) throw new PrivateBlobError("Missing", "gone");
      return { data, handle };
    },
    delete: async (handle) => {
      if (failDelete) throw new PrivateBlobError("Offline", "unavailable");
      return {
        deleted: blobs.delete(handle.id),
        provider: "cell-lifecycle-memory",
      };
    },
  });
});
afterAll(async () => {
  unregisterPrivateBlobProvider("cell-lifecycle-memory");
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  rmSync(dir, { recursive: true, force: true });
});
async function fixture(connectionId: string | null = null) {
  const cellId = `cell-${randomUUID()}`;
  const project = await createProject({
    ...scope,
    title: "Cell lifecycle",
    cells: [
      {
        id: cellId,
        kind: "sql",
        source: "select 1",
        dataConnectionId: connectionId,
        databaseSchema: null,
        resultVariable: null,
        outputResult: true,
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
    ],
  });
  const data = {
    type: "table" as const,
    columns: [{ name: "value", type: "string" as const }],
    rows: [["value"]],
    rowCount: 1,
    truncated: false,
  };
  const stored = await actor(() => storeDataframe(data, ownerEmail));
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
          connectionId: null,
          snapshot: "c".repeat(64),
        },
      ],
    },
  };
  return { project, cellId, output, blobId: stored.handle.id };
}
async function outputGeneration(projectId: string, cellId: string) {
  const [row] = await getDb()
    .select({ generation: schema.cellOutputGenerations.generation })
    .from(schema.cellOutputGenerations)
    .where(
      and(
        eq(schema.cellOutputGenerations.projectId, projectId),
        eq(schema.cellOutputGenerations.cellId, cellId),
      ),
    );
  if (!row) throw new Error("Missing output generation");
  return row.generation;
}
const nextOutput: CellOutput = {
  type: "table",
  columns: [{ name: "value", type: "string" }],
  rows: [["next"]],
  rowCount: 1,
  truncated: false,
};
async function expectStaleUntilReplaced(
  f: Awaited<ReturnType<typeof fixture>>,
  before: string,
) {
  const after = await outputGeneration(f.project.id, f.cellId);
  expect(after).not.toBe(before);
  expect(blobs.has(f.blobId)).toBe(true);
  expect(await countDataframeBlobs(scope, f.project.id)).toBe(1);
  await expect(
    writeCellOutput({
      ...scope,
      projectId: f.project.id,
      cellId: f.cellId,
      generation: before,
      runId: null,
      status: "complete",
      output: f.output,
    }),
  ).rejects.toThrow("A newer run or cleared output owns this cell.");
  await writeCellOutput({
    ...scope,
    projectId: f.project.id,
    cellId: f.cellId,
    generation: after,
    runId: null,
    status: "complete",
    output: nextOutput,
  });
  expect(blobs.has(f.blobId)).toBe(false);
  expect(await countDataframeBlobs(scope, f.project.id)).toBe(0);
}
const remove = (projectId: string, cellId: string) =>
  actor(() => deleteProjectCell.run({ projectId, cellId }, context));
describe("cell output cleanup", () => {
  it("removes a working-only dataframe after deleting the cell", async () => {
    const f = await fixture();
    await writeCellOutput({
      ...scope,
      projectId: f.project.id,
      cellId: f.cellId,
      runId: null,
      status: "complete",
      output: f.output,
    });
    await remove(f.project.id, f.cellId);
    expect(blobs.has(f.blobId)).toBe(false);
    expect(await countDataframeBlobs(scope, f.project.id)).toBe(0);
  });
  it("reports a committed deletion with cleanup pending and retries it", async () => {
    const f = await fixture();
    await writeCellOutput({
      ...scope,
      projectId: f.project.id,
      cellId: f.cellId,
      runId: null,
      status: "complete",
      output: f.output,
    });
    failDelete = true;
    try {
      await expect(remove(f.project.id, f.cellId)).rejects.toMatchObject({
        message: expect.stringContaining("committed"),
        errorCode: "project_dataframe_cleanup_pending",
        details: { committed: true },
      });
      expect(
        await readCells(scope, f.project.id, f.project.workingVersionId),
      ).toHaveLength(0);
      expect(blobs.has(f.blobId)).toBe(true);
      expect(await countDataframeBlobs(scope, f.project.id)).toBe(1);
    } finally {
      failDelete = false;
    }
    await sweepDataframeBlobs(scope, f.project.id);
    expect(blobs.has(f.blobId)).toBe(false);
    expect(await countDataframeBlobs(scope, f.project.id)).toBe(0);
  });
  it("keeps a working-only dataframe while an edited SQL cell shows it as stale, then cleans it when a newer run replaces it", async () => {
    const f = await fixture();
    await writeCellOutput({
      ...scope,
      projectId: f.project.id,
      cellId: f.cellId,
      runId: null,
      status: "complete",
      output: f.output,
    });
    const cell = (
      await readCells(scope, f.project.id, f.project.workingVersionId)
    ).at(0);
    if (!cell || cell.contents.kind !== "sql")
      throw new Error("Missing SQL cell");
    const before = await outputGeneration(f.project.id, f.cellId);
    await actor(() =>
      updateCellsAtomic({
        ...scope,
        projectId: f.project.id,
        versionId: f.project.workingVersionId,
        cells: [
          {
            cellId: f.cellId,
            expectedUpdatedAt: cell.updatedAt,
            contents: { ...cell.contents, source: "select 2" },
          },
        ],
      }),
    );
    await expectStaleUntilReplaced(f, before);
  });
  it("keeps a working-only dataframe while a cell with a replaced connection shows it as stale, then cleans it when a newer run replaces it", async () => {
    const f = await fixture("connection-before");
    await writeCellOutput({
      ...scope,
      projectId: f.project.id,
      cellId: f.cellId,
      runId: null,
      status: "complete",
      output: f.output,
    });
    const cell = (
      await readCells(scope, f.project.id, f.project.workingVersionId)
    ).at(0);
    if (!cell) throw new Error("Missing SQL cell");
    const before = await outputGeneration(f.project.id, f.cellId);
    await actor(() =>
      replaceSqlConnection({
        ...scope,
        projectId: f.project.id,
        versionId: f.project.workingVersionId,
        fromConnectionId: "connection-before",
        toConnectionId: SAMPLE_DATA_SOURCE_ID,
        expectedCells: [{ cellId: f.cellId, updatedAt: cell.updatedAt }],
      }),
    );
    await expectStaleUntilReplaced(f, before);
  });
  it("retains a dataframe referenced by a run or published version after cell deletion", async () => {
    const run = await fixture();
    await recordRun({
      ...scope,
      projectId: run.project.id,
      cellId: run.cellId,
      status: "complete",
      output: run.output,
    });
    await remove(run.project.id, run.cellId);
    expect(blobs.has(run.blobId)).toBe(true);
    const published = await fixture();
    await writeCellOutput({
      ...scope,
      projectId: published.project.id,
      cellId: published.cellId,
      runId: null,
      status: "complete",
      output: published.output,
    });
    await seedLegacyPublishedProject(scope, published.project.id);
    await remove(published.project.id, published.cellId);
    expect(blobs.has(published.blobId)).toBe(true);
  });
});
