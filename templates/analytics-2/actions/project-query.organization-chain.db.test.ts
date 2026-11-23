import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import {
  organizations,
  orgMembers,
  ORG_MIGRATIONS,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { readAppSecret } from "@agent-native/core/secrets";
import { runWithRequestContext } from "@agent-native/core/server";
import { deleteOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type ProviderJob = { projectId: string; jobId: string; location: string };
type ProviderRequest = {
  method: string;
  path: string;
  body?: { jobReference: ProviderJob };
  query?: { pageToken?: string };
};

const fixture = vi.hoisted(() => ({
  projectId: "query-fixture-project",
  executeRequest: vi.fn<(request: ProviderRequest) => Promise<unknown>>(),
}));

vi.mock("../server/lib/org-bigquery-credentials.js", () => ({
  getOrganizationBigQueryCredentialReadiness: async () => "configured",
  requireOrganizationBigQueryAuthority: async () => ({
    projectId: fixture.projectId,
    revision: "1",
  }),
  withOrganizationBigQueryRequestContext: async (
    _context: unknown,
    run: () => unknown,
  ) => run(),
}));
vi.mock("../server/execution/notebook-kernel.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/execution/notebook-kernel.js")
  >()),
  createHostedKernelPort: () => localDuckDb(),
}));
vi.mock("../server/lib/provider-api.js", () => ({
  getAnalytics2OrganizationQueryProviderApiRuntime: () => ({
    requestCapabilities: { singleAttemptUnsafeRequests: true },
    executeRequest: fixture.executeRequest,
  }),
}));
import { getDb, schema } from "../server/db/index.js";
import { localDuckDb } from "../server/execution/local-duckdb.test-support.js";
import { addCell } from "../server/model/cells-store.js";
import { writeDataResourceMetadata } from "../server/model/data-resource-metadata.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { drainNotebookRun } from "../server/model/notebook-execution/service.js";
import {
  createProject,
  getProjectDocument,
} from "../server/model/projects-store.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";
import { runRequestSchema } from "../shared/notebook-execution.js";
import {
  notebookCellIdSchema,
  notebookProjectIdSchema,
} from "../shared/notebook-snapshot-contract.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import getCellExecution from "./get-notebook-cell-execution.js";
import getExecution from "./get-notebook-execution.js";
import getResultPage from "./get-notebook-result-page.js";
import getProject from "./get-project.js";
import runCell from "./run-project-cell.js";
import startRun from "./start-notebook-run.js";

const round = mkdtempSync(join(tmpdir(), "project-org-chain-"));
const email = "query-owner@example.test";
const orgId = `qa-org-chain-${randomUUID()}`;
const scope = { ownerEmail: email, orgId };
const context = {
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
};
const actor = <T>(call: () => T) =>
  runWithRequestContext(
    { userEmail: email, orgId, isSyntheticTraffic: true },
    call,
  );

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(round, "database")}`);
  vi.stubEnv("WORKSPACE_SECRETS_ENCRYPTION_KEY", "org chain fixture material");
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "org chain legacy fixture material");
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_org_chain_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA test workspace",
    createdBy: email,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDbExec().execute(sql`CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
  )`);
  await readAppSecret({ key: "fixture-init", scope: "org", scopeId: orgId });
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (!resolve(round).startsWith(resolve(tmpdir()) + "/project-org-chain-")) {
    throw new Error("Refused cleanup outside the owned round");
  }
  rmSync(round, { recursive: true });
});

describe("organization query chained through dataframes SQL cells", () => {
  it("enforces virtual source resource exclusions on saved results for agent callers", async () => {
    const project = await createProject({
      ...scope,
      title: "Virtual source results",
      cells: [ORGANIZATION_BIGQUERY_SOURCE_ID, SAMPLE_DATA_SOURCE_ID].map(
        (dataConnectionId, index) => ({
          kind: "sql" as const,
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          databaseSchema: null,
          outputResult: true,
          source: "SELECT 42",
          dataConnectionId,
          resultVariable: `result_${index}`,
        }),
      ),
    });
    const [cell, derived] = project.cells;
    if (!cell || !derived) throw new Error("The result fixture is absent");
    await getDb()
      .insert(schema.cellOutputs)
      .values({
        projectId: project.id,
        cellId: cell.id,
        sourceConnectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
        connectionProvenanceRecorded: true,
        status: "complete",
        ranAt: "2026-01-01T00:00:00.000Z",
        output: JSON.stringify({
          type: "table",
          columns: [{ name: "value", type: "number" }],
          rows: [[42]],
          rowCount: 1,
          truncated: false,
        }),
      });
    await getDb()
      .insert(schema.cellOutputs)
      .values({
        projectId: project.id,
        cellId: derived.id,
        sourceConnectionId: SAMPLE_DATA_SOURCE_ID,
        connectionProvenanceRecorded: true,
        status: "complete",
        ranAt: "2026-01-01T00:00:00.000Z",
        output: JSON.stringify({
          type: "table",
          columns: [{ name: "value", type: "number" }],
          rows: [[84]],
          rowCount: 1,
          truncated: false,
          materialization: {
            version: 1,
            handle: {
              id: "private-derived",
              provider: "fixture",
              opaque: true,
              encrypted: false,
            },
            snapshot: "a".repeat(64),
            digest: "b".repeat(64),
            dependencies: [
              {
                cellId: cell.id,
                connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
                generation: "1",
                snapshot: "c".repeat(64),
              },
            ],
          },
        }),
      });
    const read = (caller: "frontend" | "tool") =>
      actor(() =>
        getProject.run({ projectId: project.id }, { ...context, caller }),
      );
    const ready = await read("tool");
    expect(ready.outputs[cell.id]?.output).toMatchObject({
      type: "table",
      rows: [[42]],
    });
    expect(ready.outputs[derived.id]?.output).toMatchObject({
      type: "table",
      rows: [[84]],
    });
    expect(JSON.stringify(ready)).not.toContain("private-derived");
    await actor(() =>
      writeDataResourceMetadata(
        scope,
        ORGANIZATION_BIGQUERY_SOURCE_ID,
        { kind: "schema", id: "schema:fixture:restricted" },
        { aiUsage: "excluded" },
      ),
    );
    const denied = await read("tool");
    expect(denied.outputs[cell.id]?.output).toMatchObject({ type: "error" });
    expect(denied.outputs[derived.id]?.output).toMatchObject({ type: "error" });
    expect(JSON.stringify(denied.outputs)).not.toContain("[[42]]");
    expect(JSON.stringify(denied.outputs)).not.toContain("[[84]]");
    expect(JSON.stringify(denied)).not.toContain("private-derived");
    expect((await read("frontend")).outputs[cell.id]?.output).toMatchObject({
      type: "table",
      rows: [[42]],
    });
    const personal = await runWithRequestContext(
      {
        userEmail: email,
        orgId,
        orgScope: "personal",
        isSyntheticTraffic: true,
      },
      () =>
        getProject.run(
          { projectId: project.id },
          { ...context, caller: "tool" },
        ),
    );
    expect(personal.outputs[cell.id]?.output).toMatchObject({ type: "error" });
    await actor(() =>
      writeDataResourceMetadata(
        scope,
        ORGANIZATION_BIGQUERY_SOURCE_ID,
        { kind: "schema", id: "schema:fixture:restricted" },
        { aiUsage: null },
      ),
    );
    expect((await read("tool")).outputs[cell.id]?.output).toMatchObject({
      type: "table",
      rows: [[42]],
    });
    await actor(() =>
      writeDataResourceMetadata(
        scope,
        ORGANIZATION_BIGQUERY_SOURCE_ID,
        { kind: "connection", id: ORGANIZATION_BIGQUERY_SOURCE_ID },
        { aiUsage: "excluded" },
      ),
    );
    expect((await read("tool")).outputs[cell.id]?.output).toMatchObject({
      type: "error",
    });
    expect((await read("frontend")).outputs[cell.id]?.output).toMatchObject({
      type: "table",
      rows: [[42]],
    });
    await actor(() =>
      writeDataResourceMetadata(
        scope,
        ORGANIZATION_BIGQUERY_SOURCE_ID,
        { kind: "connection", id: ORGANIZATION_BIGQUERY_SOURCE_ID },
        { aiUsage: "included" },
      ),
    );
    const corruptKey = `analytics.data.resource-metadata:v1:${encodeURIComponent(ORGANIZATION_BIGQUERY_SOURCE_ID)}:schema:${encodeURIComponent("schema:fixture:corrupt")}`;
    await putOrgSetting(orgId, corruptKey, { aiUsage: "invalid" });
    await expect(read("tool")).rejects.toMatchObject({
      errorCode: "data_resource_metadata_corrupt",
      statusCode: 500,
    });
    await deleteOrgSetting(orgId, corruptKey);
  });
  it("report FLOW-chained-sql-cell: keeps FLOAT64 as double precision and NUMERIC exact across two chained cells", async () => {
    const blobs = new Map<string, Uint8Array>();
    registerPrivateBlobProvider({
      id: "org-chain-test",
      name: "Org chain test",
      isConfigured: () => true,
      put: async ({ data }) => {
        const id = randomUUID();
        blobs.set(id, new Uint8Array(data));
        return {
          id,
          provider: "org-chain-test",
          opaque: true,
          encrypted: true,
        };
      },
      read: async (handle) => {
        const data = blobs.get(handle.id);
        if (!data) throw new Error("Missing test blob");
        return { data, handle };
      },
      delete: async (handle) => ({
        deleted: blobs.delete(handle.id),
        provider: "org-chain-test",
      }),
    });
    try {
      const schema = {
        fields: [
          { name: "id", type: "INT64" },
          { name: "rate", type: "FLOAT64" },
          { name: "amount", type: "NUMERIC" },
        ],
      };
      const pageTwoToken = "provider-page-two";
      const providerPage = (from: number, count: number, next?: string) => ({
        response: {
          ok: true,
          status: 200,
          truncated: false,
          json: {
            jobComplete: true,
            jobReference,
            schema,
            totalRows: "1500",
            rows: Array.from({ length: count }, (_, i) => ({
              f: [
                { v: String(from + i) },
                { v: "1.25" },
                { v: "123456789.123456789" },
              ],
            })),
            ...(next ? { pageToken: next } : {}),
          },
        },
      });
      let jobReference: ProviderJob | undefined;
      const projectPath = `/projects/${fixture.projectId}`;
      fixture.executeRequest.mockImplementation(
        async ({ method, path, body, query }) => {
          if (
            method === "POST" &&
            path === `${projectPath}/jobs` &&
            body?.configuration?.dryRun
          ) {
            return {
              response: {
                ok: true,
                status: 200,
                truncated: false,
                json: {
                  jobReference: {
                    projectId: fixture.projectId,
                    location: "US",
                  },
                  statistics: { query: { statementType: "SELECT" } },
                },
              },
            };
          }
          if (method === "POST" && path === `${projectPath}/jobs` && body) {
            jobReference = body.jobReference;
            return {
              response: {
                ok: true,
                status: 200,
                truncated: false,
                json: { jobReference, status: { state: "DONE" } },
              },
            };
          }
          if (
            method === "GET" &&
            jobReference &&
            path === `${projectPath}/queries/${jobReference.jobId}`
          ) {
            if (query?.pageToken === undefined)
              return providerPage(0, 1000, pageTwoToken);
            if (query.pageToken === pageTwoToken)
              return providerPage(1000, 500);
          }
          throw new Error(`Unexpected provider request ${method} ${path}`);
        },
      );
      const base = {
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        databaseSchema: null,
        outputResult: true,
      };
      const firstId = `cell-${randomUUID()}`;
      const secondId = `cell-${randomUUID()}`;
      const thirdId = `cell-${randomUUID()}`;
      const project = await createProject({
        ...scope,
        title: "Org chain",
        cells: [
          {
            ...base,
            id: firstId,
            kind: "sql",
            source: "SELECT id, rate, amount FROM paged_fixture",
            dataConnectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
            resultVariable: "dataframe",
          },
        ],
      });
      const document = await getProjectDocument(scope, project.id);
      if (!document) throw new Error("Project missing");
      const chained = (id: string, source: string, resultVariable: string) =>
        addCell({
          ...scope,
          projectId: project.id,
          versionId: document.workingVersionId,
          contents: {
            kind: "sql",
            ...base,
            id,
            source,
            dataConnectionId: null,
            resultVariable,
            connectionMode: "dataframes",
          },
        });
      await chained(
        secondId,
        `SELECT replace(pg_typeof(rate), 'double', 'double precision') AS rate_kind,
          rate * 2 AS doubled,
          replace(pg_typeof(amount), 'decimal(38,9)', 'numeric') AS amount_kind,
          amount + 0.000000001 AS precise, COUNT(*) OVER () AS n
        FROM dataframe ORDER BY id LIMIT 2`,
        "result",
      );
      await chained(
        thirdId,
        `SELECT replace(pg_typeof(doubled), 'double', 'double precision') AS d_kind,
          doubled * 2 AS quad,
          replace(pg_typeof(precise), 'decimal(38,9)', 'numeric') AS p_kind,
          precise + 0.000000001 AS precise2, n
        FROM result ORDER BY doubled LIMIT 1`,
        "final",
      );
      const current = await actor(() =>
        getExecution.run({ projectId: project.id }, context),
      );
      if (current.status !== "found") throw new Error(current.status);
      const first = await actor(() =>
        startRun.run(
          runRequestSchema.parse({
            requestId: randomUUID(),
            snapshot: current.snapshot,
            mode: "cell-only",
            targetCellId: firstId,
            cache: "bypass",
            staleValues: "reject",
          }),
          context,
        ),
      );
      if (first.status !== "admitted") throw new Error(first.status);
      await drainNotebookRun(
        { ...scope, caller: context.caller },
        first.runId,
        {
          deadlineAt: Date.now() + 20_000,
        },
      );
      const firstOutput = await actor(() =>
        getCellExecution.run(
          {
            projectId: notebookProjectIdSchema.parse(project.id),
            cellId: notebookCellIdSchema.parse(firstId),
          },
          context,
        ),
      );
      expect(firstOutput).toMatchObject({
        status: "found",
        state: { status: "complete" },
      });
      const providerRequests = fixture.executeRequest.mock.calls.map(
        ([req]) => ({
          method: req.method,
          path: req.path,
          pageToken: req.query?.pageToken,
        }),
      );
      if (!jobReference) throw new Error("No provider job was submitted");
      const queryPath = `${projectPath}/queries/${jobReference.jobId}`;
      expect(providerRequests).toEqual([
        { method: "POST", path: `${projectPath}/jobs`, pageToken: undefined },
        { method: "POST", path: `${projectPath}/jobs`, pageToken: undefined },
        { method: "GET", path: queryPath, pageToken: undefined },
        { method: "GET", path: queryPath, pageToken: pageTwoToken },
      ]);
      const second = await actor(() =>
        runCell.run({ projectId: project.id, cellId: secondId }, context),
      );
      expect(second.output).toMatchObject({
        type: "table",
        rows: [
          ["double precision", 2.5, "numeric", "123456789.123456790", 1500],
          ["double precision", 2.5, "numeric", "123456789.123456790", 1500],
        ],
      });
      const third = await actor(() =>
        runCell.run({ projectId: project.id, cellId: thirdId }, context),
      );
      expect(third.output).toMatchObject({
        type: "table",
        rows: [["double precision", 5, "numeric", "123456789.123456791", 1500]],
      });
      const stored = await actor(() =>
        getCellExecution.run(
          {
            projectId: notebookProjectIdSchema.parse(project.id),
            cellId: notebookCellIdSchema.parse(thirdId),
          },
          context,
        ),
      );
      if (stored.status !== "found" || !stored.resultId)
        throw new Error("The final cell result was not saved");
      const read = await actor(() =>
        getResultPage.run({ resultId: stored.resultId, page: 1 }, context),
      );
      expect(read).toMatchObject({
        status: "ready",
        manifest: { status: "complete", rowCount: "1" },
        rows: [
          [
            "double precision",
            5,
            "numeric",
            { type: "decimal", value: "123456789.123456791" },
            { type: "integer", value: "1500" },
          ],
        ],
      });
      const executionRead = await actor(() =>
        getExecution.run({ projectId: project.id }, context),
      );
      expect(executionRead).toMatchObject({
        status: "found",
        cells: { [thirdId]: { resultId: stored.resultId, stale: false } },
      });
      expect(fixture.executeRequest).toHaveBeenCalledTimes(4); // oracle-change: BigQuery dry-runs the query for its region, then the job is submitted and its two result pages read
      const everything = JSON.stringify([
        firstOutput,
        second,
        third,
        stored,
        read,
        executionRead,
        fixture.executeRequest.mock.calls.length,
      ]);
      expect(everything).not.toContain(jobReference.jobId);
      expect(everything).not.toContain(pageTwoToken);
      expect(everything).not.toContain("jobIdentity");
    } finally {
      unregisterPrivateBlobProvider("org-chain-test");
    }
  });
});
