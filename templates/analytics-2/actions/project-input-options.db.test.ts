import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
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
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { storeDataframe } from "../server/model/dataframe-materialization.js";
import { createInputChoiceResolver } from "../server/model/input-options.js";
import { encodeJsonColumn } from "../server/model/json-column.js";
import { createProject } from "../server/model/projects-store.js";
import { writeCellOutput } from "../server/model/runs-store.js";

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

const round = mkdtempSync(join(tmpdir(), "input-options-"));
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
    table: "qa_input_options_org_migrations",
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
    owned.startsWith(resolve(tmpdir()) + "/input-options-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else {
    throw new Error("Refused cleanup outside the owned input-options round");
  }
});

// The saved result behind a query-driven input is read with the same access
// rules as any other saved result: the target query's own connection says
// nothing about whether this account may see the source's rows.
const dropdown = (): CellDraft => ({
  ...baseCell,
  id: newCellId("input"),
  kind: "input",
  name: "region",
  inputType: "DROPDOWN",
  defaultValueString: "",
  options: [],
  optionsSource: { dataframe: "regions", valueColumn: "value" },
});

function sourceCell(id: string, connectionId: string | null): CellDraft {
  return { ...sqlCell(id, connectionId), resultVariable: "regions" };
}

async function seedSource(input: {
  projectId: string;
  cellId: string;
  sourceConnectionId: string | null;
  recorded?: boolean;
  status?: "complete" | "error";
  output?: CellOutput;
}): Promise<void> {
  await getDb()
    .insert(schema.cellOutputs)
    .values({
      cellId: input.cellId,
      projectId: input.projectId,
      runId: null,
      sourceConnectionId: input.sourceConnectionId,
      connectionProvenanceRecorded: input.recorded ?? true,
      status: input.status ?? "complete",
      output: encodeJsonColumn(input.output ?? table([["a"], ["b"]])),
      ranAt: new Date().toISOString(),
    });
}

async function choices(projectId: string) {
  const document = await getDb()
    .select({ id: schema.cells.id, contents: schema.cells.contents })
    .from(schema.cells)
    .where(eq(schema.cells.projectId, projectId));
  const cells = document.map((row) => ({
    id: row.id,
    contents: JSON.parse(row.contents),
  }));
  const input = cells.find((cell) => cell.contents.kind === "input");
  if (input == null) throw new Error("Fixture has no input cell");
  return asActor(member, orgA, () =>
    createInputChoiceResolver({
      scope: memberScope,
      projectId,
      cells,
      caller: "frontend",
    })(input.contents),
  );
}

describe("query-driven input choices read the source result under its own access", () => {
  const build = async (connectionId: string | null) => {
    const sourceId = newCellId("source");
    const project = await projectWith(
      [sourceCell(sourceId, connectionId), dropdown()],
      member,
      orgA,
    );
    return { project, sourceId };
  };

  it("offers the values of a readable, recorded, complete source result", async () => {
    const { project, sourceId } = await build(allowedConnectionId);
    await seedSource({
      projectId: project.id,
      cellId: sourceId,
      sourceConnectionId: allowedConnectionId,
    });
    expect((await choices(project.id)).options.map((o) => o.text)).toEqual([
      "a",
      "b",
    ]);
  });

  it.each([
    ["denied", () => deniedConnectionId],
    ["foreign", () => foreignConnectionId],
  ])(
    "refuses a source result from a %s connection and leaks no value",
    async (_name, pick) => {
      const { project, sourceId } = await build(allowedConnectionId);
      await seedSource({
        projectId: project.id,
        cellId: sourceId,
        sourceConnectionId: pick(),
        output: table([["LEAKED-CHOICE"]]),
      });
      await expect(choices(project.id)).rejects.toMatchObject({
        errorCode: "project_input_options_source_unavailable",
      });
    },
  );

  it("refuses a source result whose connection was never recorded", async () => {
    const { project, sourceId } = await build(allowedConnectionId);
    await seedSource({
      projectId: project.id,
      cellId: sourceId,
      sourceConnectionId: allowedConnectionId,
      recorded: false,
      output: table([["LEAKED-CHOICE"]]),
    });
    await expect(choices(project.id)).rejects.toMatchObject({
      errorCode: "project_input_options_source_unavailable",
    });
  });

  it("refuses a source result that is not a complete run", async () => {
    const { project, sourceId } = await build(allowedConnectionId);
    await seedSource({
      projectId: project.id,
      cellId: sourceId,
      sourceConnectionId: allowedConnectionId,
      status: "error",
      output: table([["LEAKED-CHOICE"]]),
    });
    await expect(choices(project.id)).rejects.toMatchObject({
      errorCode: "project_input_options_pending",
    });
  });
});

describe("a derived source result is judged by every connection upstream of it", () => {
  const blobs = new Map<string, Uint8Array>();
  beforeAll(() => {
    registerPrivateBlobProvider({
      id: "dynamic-input-memory",
      name: "Dynamic input test",
      isConfigured: () => true,
      put: async ({ data }) => {
        const id = randomUUID();
        blobs.set(id, new Uint8Array(data));
        return {
          id,
          provider: "dynamic-input-memory",
          opaque: true,
          encrypted: true,
        };
      },
      read: async (handle) => {
        const data = blobs.get(handle.id);
        if (!data) throw new PrivateBlobError("Missing blob", "gone");
        return { data, handle };
      },
      delete: async (handle) => ({
        deleted: blobs.delete(handle.id),
        provider: "dynamic-input-memory",
      }),
    });
  });
  afterAll(() => unregisterPrivateBlobProvider("dynamic-input-memory"));
  async function derivedSource(lineage: string | null, rows: string[][]) {
    const data = {
      type: "table" as const,
      columns: [{ name: "value", type: "string" as const }],
      rows,
      rowCount: rows.length,
      truncated: false,
    };
    const stored = await asActor(owner, orgA, () =>
      storeDataframe(data, owner),
    );
    const sourceId = newCellId("derived");
    const project = await projectWith(
      [sourceCell(sourceId, null), dropdown()],
      member,
      orgA,
    );
    await writeCellOutput({
      ...memberScope,
      projectId: project.id,
      cellId: sourceId,
      runId: null,
      status: "complete",
      output: {
        ...data,
        materialization: {
          version: 1,
          ...stored,
          snapshot: "a".repeat(64),
          dependencies: [
            {
              cellId: "upstream",
              generation: "generation",
              connectionId: lineage,
              snapshot: "c".repeat(64),
            },
          ],
        },
      } as CellOutput,
    });
    return project;
  }

  it("offers the values of a derived source whose upstream connection is readable, without its private reference", async () => {
    const project = await derivedSource(allowedConnectionId, [["x"], ["y"]]);
    const offered = await choices(project.id);
    expect(offered.options.map((option) => option.text)).toEqual(["x", "y"]);
  });

  it("refuses a derived source whose upstream connection is denied or foreign, and leaks no value", async () => {
    for (const lineage of [deniedConnectionId, foreignConnectionId]) {
      const project = await derivedSource(lineage, [["LEAKED-UPSTREAM"]]);
      await expect(choices(project.id)).rejects.toMatchObject({
        errorCode: "project_input_options_source_unavailable",
      });
    }
  });
});
