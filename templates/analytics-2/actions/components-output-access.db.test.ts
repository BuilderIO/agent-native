import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  ensureWorkspaceConnectionsTable,
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
  readComponent,
} from "../server/model/components-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { encodeJsonColumn } from "../server/model/json-column.js";
import { createProject } from "../server/model/projects-store.js";
import {} from "../server/model/runs-store.js";

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

const round = mkdtempSync(join(tmpdir(), "components-output-"));
let previousDatabase: string | undefined;
const orgA = `qa-result-${randomUUID()}`;
const orgB = `qa-result-${randomUUID()}`;
const owner = "result-owner@example.test";
const member = "result-member@example.test";
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

const orgMigrations: Array<{
  version: number;
  sql: string;
  name?: string;
}> = ORG_MIGRATIONS.map((migration) => {
  // raw-sql-ok: the framework's own migration text, copied verbatim
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
    table: "qa_components_output_org_migrations",
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
    owned.startsWith(resolve(tmpdir()) + "/components-output-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else {
    throw new Error(
      "Refused cleanup outside the owned components-output round",
    );
  }
});

// A component captures results only from connections its creator may read, and
// shows a captured result only while its reader still may.
const baseOf = baseCell;
function sourceCell(id: string, connectionId: string | null): CellDraft {
  return { ...sqlCell(id, connectionId), resultVariable: "orders" };
}

async function seed(
  projectId: string,
  cellId: string,
  options: { connection: string | null; recorded?: boolean; label?: string },
) {
  await getDb()
    .insert(schema.cellOutputs)
    .values({
      cellId,
      projectId,
      runId: null,
      sourceConnectionId: options.connection,
      connectionProvenanceRecorded: options.recorded ?? true,
      status: "complete",
      output: encodeJsonColumn(table([[options.label ?? "row"]])),
      ranAt: new Date().toISOString(),
    });
}

async function build(connection: string | null) {
  const id = newCellId("src");
  const project = await projectWith([sourceCell(id, connection)], member, orgA);
  return { project, id };
}

const create = (projectId: string, cellId: string, name: string) =>
  asActor(member, orgA, () =>
    createComponent(memberScope, {
      projectId,
      name,
      cellIds: [cellId],
      caller: "frontend",
    }),
  );

const countComponents = async (name: string) =>
  (
    await getDbExec().execute({
      sql: `SELECT "id" FROM "analytics2_components" WHERE "name" = ?`,
      args: [name],
    })
  ).rows.length;

// Components, get-project and dynamic inputs answer "may this account see this
// saved result" with one rule; this file pins the component side of it.
describe("component outputs keep the access they were captured under", () => {
  it("captures a readable, recorded result and shows it to a reader who can still read its source", async () => {
    void baseOf;
    const { project, id } = await build(allowedConnectionId);
    await seed(project.id, id, {
      connection: allowedConnectionId,
      label: "KEPT",
    });
    const made = await create(project.id, id, `allowed-${randomUUID()}`);
    const read = await asActor(member, orgA, () =>
      readComponent(memberScope, made.id, "frontend"),
    );
    expect(JSON.stringify(read?.cells[0]?.output)).toContain("KEPT");
    // The stored provenance and any private reference never reach the reader.
    expect(JSON.stringify(read)).not.toContain("sourceConnectionIds");
  });

  it.each([
    ["denied", () => deniedConnectionId, true, 403],
    ["foreign", () => foreignConnectionId, true, 403],
    ["unrecorded", () => allowedConnectionId, false, 409],
  ])(
    "refuses to capture a result from a %s source, and stores nothing",
    async (_name, pick, recorded, status) => {
      const { project, id } = await build(allowedConnectionId);
      await seed(project.id, id, {
        connection: pick(),
        recorded,
        label: "LEAKED-ROW",
      });
      const name = `refused-${randomUUID()}`;
      await expect(create(project.id, id, name)).rejects.toMatchObject({
        statusCode: status,
      });
      expect(await countComponents(name)).toBe(0);
    },
  );

  it("refuses to open a captured result once its source is no longer readable, and one captured without provenance", async () => {
    const { project, id } = await build(allowedConnectionId);
    await seed(project.id, id, {
      connection: allowedConnectionId,
      label: "GONE",
    });
    const made = await create(project.id, id, `revoked-${randomUUID()}`);
    const stored = await getDbExec().execute({
      sql: `SELECT "cells_json" AS "cellsJson" FROM "analytics2_components" WHERE "id" = ?`,
      args: [made.id],
    });
    const cellsJson = JSON.parse(
      String((stored.rows[0] as { cellsJson: string }).cellsJson),
    );
    const store = async () =>
      getDbExec().execute({
        sql: `UPDATE "analytics2_components" SET "cells_json" = ? WHERE "id" = ?`,
        args: [JSON.stringify(cellsJson), made.id],
      });
    // The member loses the source: reading is refused, nothing is returned.
    cellsJson[0].sourceConnectionIds = [deniedConnectionId];
    await store();
    await expect(
      asActor(member, orgA, () =>
        readComponent(memberScope, made.id, "frontend"),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    // A result stored without provenance cannot be verified.
    delete cellsJson[0].sourceConnectionIds;
    cellsJson[0].output = table([["LEGACY"]]);
    await store();
    await expect(
      asActor(member, orgA, () =>
        readComponent(memberScope, made.id, "frontend"),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "component_provenance_unavailable",
    });
  });
});
