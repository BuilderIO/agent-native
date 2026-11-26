import { createRequire } from "node:module";

import type { ActionRunContext } from "@agent-native/core/action";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const harness = vi.hoisted(() => ({
  db: null as any,
  user: { email: "alice@example.com", orgId: null as string | null },
  // `${resourceType}:${id}` -> email -> role
  shares: new Map<string, Map<string, string>>(),
  // Runs once, just before the next transaction opens: a peer's write that
  // lands after the action's reads and before its compare-and-swap.
  beforeNextTransaction: null as null | (() => Promise<void>),
  // Runs once, just before an action's next own `getDashboard` read (the
  // store's internal reads don't count): a peer's write that lands after the
  // action's preflight.
  beforeNextDashboardRead: null as null | (() => Promise<void>),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: () => harness.db,
  schema: await vi.importActual("../server/db/schema.js"),
}));

// Access as the framework resolves it, reduced to what these specs need:
// owners, explicit shares, and org visibility for viewers.
vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  const { and, eq, inArray, or } = await import("drizzle-orm");
  const schema = await vi.importActual<typeof import("../server/db/schema.js")>(
    "../server/db/schema.js",
  );
  const tables: Record<string, any> = {
    dashboard: schema.dashboards,
    analysis: schema.analyses,
    "dashboard-folder": schema.dashboardFolders,
  };
  type Ctx = { userEmail?: string; orgId?: string };
  function roleFor(type: string, row: any, ctx: Ctx) {
    const email = ctx.userEmail?.toLowerCase();
    if (email && row.ownerEmail?.toLowerCase() === email) return "owner";
    const shared = email && harness.shares.get(`${type}:${row.id}`)?.get(email);
    if (shared) return shared;
    if (row.visibility === "org" && row.orgId && row.orgId === ctx.orgId) {
      return "viewer";
    }
    return row.visibility === "public" ? "viewer" : null;
  }
  async function resolveAccess(type: string, id: string, ctx: Ctx = {}) {
    const table = tables[type];
    if (!table) return null;
    const [row] = await harness.db.select().from(table).where(eq(table.id, id));
    const role = row ? roleFor(type, row, ctx) : null;
    return role ? { resource: row, role } : null;
  }
  async function assertAccess(
    type: string,
    id: string,
    minRole: any,
    ctx: Ctx = {},
  ) {
    const access = await resolveAccess(type, id, ctx);
    if (!access || !actual.roleSatisfies(access.role as any, minRole)) {
      throw new actual.ForbiddenError(`No access to ${type} ${id}`);
    }
    return access;
  }
  function accessFilter(table: any, _shares: unknown, ctx: Ctx) {
    const type =
      Object.entries(tables).find(([, value]) => value === table)?.[0] ?? "";
    const email = ctx.userEmail?.toLowerCase() ?? "";
    const sharedIds = [...harness.shares.entries()]
      .filter(
        ([key, grants]) => key.startsWith(`${type}:`) && grants.has(email),
      )
      .map(([key]) => key.slice(type.length + 1));
    return or(
      eq(table.ownerEmail, email),
      and(eq(table.visibility, "org"), eq(table.orgId, ctx.orgId ?? "")),
      eq(table.visibility, "public"),
      ...(sharedIds.length > 0 ? [inArray(table.id, sharedIds)] : []),
    );
  }
  return { ...actual, resolveAccess, assertAccess, accessFilter };
});

vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: async () => null,
  getUserSetting: async () => null,
  deleteOrgSetting: async () => undefined,
  deleteUserSetting: async () => undefined,
  listSettingsByPrefix: async () => [],
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => harness.user.email,
  getRequestOrgId: () => harness.user.orgId,
  getRequestRunContext: () => undefined,
  recordChange: () => undefined,
}));

vi.mock("@agent-native/core/tracking", () => ({ track: () => undefined }));

vi.mock("../server/lib/dashboard-collab-sync", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/dashboard-collab-sync")
  >()),
  queueDashboardCollabSync: async () => undefined,
}));

vi.mock("../server/lib/dashboards-store", async (importOriginal) => {
  const store =
    await importOriginal<typeof import("../server/lib/dashboards-store")>();
  return {
    ...store,
    getDashboard: async (...args: Parameters<typeof store.getDashboard>) => {
      const peer = harness.beforeNextDashboardRead;
      harness.beforeNextDashboardRead = null;
      if (peer) await peer();
      return store.getDashboard(...args);
    },
  };
});

vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: async () => null,
  dryRunQuerySchema: async () => null,
}));

vi.mock("../server/lib/first-party-analytics.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/first-party-analytics.js")
  >()),
  validateFirstPartyAnalyticsSqlForScope: async () => undefined,
}));

// Panel verification runs the panels' queries; it has its own specs.
vi.mock(
  "../server/lib/dashboard-panel-verification",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/lib/dashboard-panel-verification")
    >()),
    verifyPanelWrite: async () => ({
      verified: true,
      verification: null,
      proof: [],
      unverified: [],
    }),
  }),
);

const schema = await import("../server/db/schema.js");
const { WRITE_RECEIPTS_MIGRATION_SQL } =
  await import("../server/lib/write-receipts-migration");
const { listDashboardSummaries } =
  await import("../server/lib/dashboards-store");
const actions = {
  archive: (await import("./archive-dashboard")).default,
  compose: (await import("./compose-dashboard")).default,
  createFolder: (await import("./create-dashboard-folder")).default,
  hideAnalysis: (await import("./hide-analysis")).default,
  hideDashboard: (await import("./hide-dashboard")).default,
  listAnalysisRevisions: (await import("./list-analysis-revisions")).default,
  listDashboardRevisions: (await import("./list-dashboard-revisions")).default,
  mutate: (await import("./mutate-dashboard")).default,
  renameAnalysis: (await import("./rename-analysis")).default,
  renameDashboard: (await import("./rename-dashboard")).default,
  restoreAnalysis: (await import("./restore-analysis-revision")).default,
  restoreDashboard: (await import("./restore-dashboard-revision")).default,
  saveAnalysis: (await import("./save-analysis")).default,
  setFolder: (await import("./set-dashboard-folder")).default,
  update: (await import("./update-dashboard")).default,
};

type Action = { run: (args: any, ctx?: ActionRunContext) => Promise<any> };

const MCP = { caller: "mcp" } as ActionRunContext;
const IN_APP = { caller: "tool" } as ActionRunContext;
const SEED_AT = "2026-11-16T12:00:00.000Z";
const ALICE = "alice@example.com";
const BOB = "bob@example.com";

let client: any;
let keySeq = 0;
const newKey = () => `key-${++keySeq}`;

function createTableSql(table: PgTable): string {
  const config = getTableConfig(table);
  const dialect = new PgDialect();
  const columns = config.columns.map((column) => {
    let definition = `"${column.name}" ${column.getSQLType()}`;
    if (column.primary) definition += " PRIMARY KEY";
    if (column.notNull) definition += " NOT NULL";
    if (column.default !== undefined) {
      const value = column.default;
      definition += ` DEFAULT ${
        is(value, SQL)
          ? dialect.sqlToQuery(value).sql
          : typeof value === "string"
            ? `'${value.replace(/'/g, "''")}'`
            : String(value)
      }`;
    }
    return definition;
  });
  return `CREATE TABLE "${config.name}" (${columns.join(", ")})`;
}

beforeAll(async () => {
  client = await PGlite.create();
  for (const table of [
    schema.dashboards,
    schema.dashboardRevisions,
    schema.dashboardNameLocks,
    schema.dashboardFolders,
    schema.analyses,
    schema.analysisRevisions,
  ]) {
    await client.exec(createTableSql(table));
  }
  for (const statement of WRITE_RECEIPTS_MIGRATION_SQL) {
    await client.exec(statement);
  }
  const db = drizzle(client);
  const transaction = db.transaction.bind(db);
  (db as any).transaction = async (...args: Parameters<typeof transaction>) => {
    const peer = harness.beforeNextTransaction;
    harness.beforeNextTransaction = null;
    if (peer) await peer();
    return transaction(...args);
  };
  harness.db = db;
});

beforeEach(async () => {
  await client.exec(`
    DELETE FROM dashboards; DELETE FROM dashboard_revisions;
    DELETE FROM dashboard_name_locks; DELETE FROM dashboard_folders;
    DELETE FROM analyses; DELETE FROM analysis_revisions;
    DELETE FROM analytics_write_receipts;
  `);
  harness.user = { email: ALICE, orgId: null };
  harness.shares.clear();
  harness.beforeNextTransaction = null;
  harness.beforeNextDashboardRead = null;
});

afterEach(() => {
  vi.useRealTimers();
});

function as(email: string, orgId: string | null = null) {
  harness.user = { email, orgId };
}

function demoPanel(id: string, title = id) {
  // raw-sql-ok: a demo panel's `sql` holds a PromQL descriptor, not SQL.
  return {
    id,
    title,
    source: "demo",
    chartType: "line",
    width: 1,
    sql: JSON.stringify({ promql: "up", mode: "range" }),
  };
}

function seedConfig(name = "Traffic") {
  return { name, panels: [demoPanel("a"), demoPanel("b")] };
}

async function seedDashboard(
  id: string,
  options: {
    name?: string;
    owner?: string;
    archivedAt?: string | null;
    hiddenAt?: string | null;
    folderId?: string | null;
    visibility?: string;
    orgId?: string | null;
  } = {},
) {
  const name = options.name ?? "Traffic";
  await harness.db.insert(schema.dashboards).values({
    id,
    kind: "sql",
    title: name,
    config: JSON.stringify(seedConfig(name)),
    ownerEmail: options.owner ?? ALICE,
    orgId: options.orgId ?? null,
    visibility: options.visibility ?? "private",
    createdAt: SEED_AT,
    createdBy: options.owner ?? ALICE,
    updatedAt: SEED_AT,
    updatedBy: options.owner ?? ALICE,
    archivedAt: options.archivedAt ?? null,
    hiddenAt: options.hiddenAt ?? null,
    hiddenBy: options.hiddenAt ? (options.owner ?? ALICE) : null,
    folderId: options.folderId ?? null,
  });
}

async function seedFolder(id: string, owner = ALICE) {
  await harness.db.insert(schema.dashboardFolders).values({
    id,
    name: `Folder ${id}`,
    scope: "personal",
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
    ownerEmail: owner,
    orgId: null,
    visibility: "private",
  });
}

function analysisFields(name = "Closed lost") {
  return {
    name,
    description: "Deal loss analysis",
    question: "Why did we lose deals?",
    instructions: "Query HubSpot for closed-lost deals.",
    dataSources: ["hubspot"],
    resultMarkdown: "# Findings v1",
    resultData: { rows: 3 },
  };
}

async function seedAnalysis(
  id: string,
  options: { hiddenAt?: string | null; owner?: string } = {},
) {
  const fields = analysisFields();
  await harness.db.insert(schema.analyses).values({
    id,
    ...fields,
    dataSources: JSON.stringify(fields.dataSources),
    resultData: JSON.stringify(fields.resultData),
    author: options.owner ?? ALICE,
    ownerEmail: options.owner ?? ALICE,
    orgId: null,
    visibility: "private",
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
    hiddenAt: options.hiddenAt ?? null,
    hiddenBy: options.hiddenAt ? (options.owner ?? ALICE) : null,
  });
}

async function seedDashboardRevision(dashboardId: string, title: string) {
  const id = `rev-${dashboardId}-${title.replace(/\W/g, "")}`;
  await harness.db.insert(schema.dashboardRevisions).values({
    id,
    dashboardId,
    kind: "sql",
    title,
    config: JSON.stringify(seedConfig(title)),
    createdAt: "2026-11-01T00:00:00.000Z",
    createdBy: ALICE,
    ownerEmail: ALICE,
    orgId: null,
  });
  return id;
}

async function seedAnalysisRevision(analysisId: string, name: string) {
  const id = `rev-${analysisId}-${name.replace(/\W/g, "")}`;
  const fields = analysisFields(name);
  await harness.db.insert(schema.analysisRevisions).values({
    id,
    analysisId,
    ...fields,
    dataSources: JSON.stringify(fields.dataSources),
    resultData: JSON.stringify(fields.resultData),
    createdAt: "2026-11-01T00:00:00.000Z",
    createdBy: ALICE,
    ownerEmail: ALICE,
    orgId: null,
  });
  return id;
}

async function rows(table: string): Promise<any[]> {
  return (await client.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
}

/** Every record, history entry, and receipt, for zero-effect checks. */
async function everything() {
  return {
    dashboards: await rows("dashboards"),
    dashboardRevisions: await rows("dashboard_revisions"),
    folders: await rows("dashboard_folders"),
    analyses: await rows("analyses"),
    analysisRevisions: await rows("analysis_revisions"),
    receipts: await rows("analytics_write_receipts"),
  };
}

async function updatedAtOf(kind: "dashboard" | "analysis", id: string) {
  const table = kind === "dashboard" ? "dashboards" : "analyses";
  const result = await client.query(
    `SELECT updated_at FROM ${table} WHERE id = $1`,
    [id],
  );
  return result.rows[0]?.updated_at as string;
}

/** Another writer saves the record, advancing its version. */
async function peerWrite(kind: "dashboard" | "analysis", id: string) {
  const at = new Date(Date.parse(await updatedAtOf(kind, id)) + 60_000);
  if (kind === "dashboard") {
    await client.query(
      `UPDATE dashboards SET updated_at = $2, updated_by = $3,
        config = jsonb_set(config::jsonb, '{description}', '"peer edit"')::text
        WHERE id = $1`,
      [id, at.toISOString(), "peer@example.com"],
    );
  } else {
    await client.query(
      `UPDATE analyses SET updated_at = $2, description = 'peer edit' WHERE id = $1`,
      [id, at.toISOString()],
    );
  }
}

async function run(
  action: Action,
  args: Record<string, unknown>,
  ctx: ActionRunContext = MCP,
) {
  return action.run(args, ctx);
}

type Kind = "dashboard" | "analysis";
type Args = Record<string, unknown>;

interface MatrixCase {
  name: string;
  kind: Kind;
  action: Action;
  seed: (id: string) => Promise<void>;
  /** Changes the seeded record. */
  change: (id: string) => Args;
  /** Leaves the seeded record as it is; absent when every call writes. */
  noop?: (id: string) => Args;
  /** Changes the record again after `change` was applied. */
  next: (id: string) => Args;
  /** Whether an applied change leaves a history entry. */
  keepsHistory: boolean;
}

async function seedComposedDashboard(id: string) {
  await run(
    actions.compose,
    { dashboardId: id, title: "Traffic", metrics: ["total-signups"] },
    IN_APP,
  );
  await client.query(`UPDATE dashboards SET updated_at = $2 WHERE id = $1`, [
    id,
    SEED_AT,
  ]);
}

const setName = (name: string) => (id: string) => ({
  dashboardId: id,
  operations: [{ op: "setDashboard", patch: { name } }],
});
const replaceName = (name: string) => (id: string) => ({
  dashboardId: id,
  ops: [{ op: "replace", path: "/name", value: name }],
});

const MATRIX: MatrixCase[] = [
  {
    name: "mutate-dashboard",
    kind: "dashboard",
    action: actions.mutate,
    seed: (id) => seedDashboard(id),
    change: setName("Renamed"),
    noop: setName("Traffic"),
    next: setName("Traffic"),
    keepsHistory: true,
  },
  {
    name: "update-dashboard config",
    kind: "dashboard",
    action: actions.update,
    seed: (id) => seedDashboard(id),
    change: (id) => ({ dashboardId: id, config: seedConfig("Renamed") }),
    noop: (id) => ({ dashboardId: id, config: seedConfig("Traffic") }),
    next: (id) => ({ dashboardId: id, config: seedConfig("Traffic") }),
    keepsHistory: true,
  },
  {
    name: "update-dashboard ops",
    kind: "dashboard",
    action: actions.update,
    seed: (id) => seedDashboard(id),
    change: replaceName("Renamed"),
    noop: replaceName("Traffic"),
    next: replaceName("Traffic"),
    keepsHistory: true,
  },
  {
    name: "update-dashboard panelOrder",
    kind: "dashboard",
    action: actions.update,
    seed: (id) => seedDashboard(id),
    change: (id) => ({ dashboardId: id, panelOrder: ["b"] }),
    noop: (id) => ({ dashboardId: id, panelOrder: ["a"] }),
    next: (id) => ({ dashboardId: id, panelOrder: ["a"] }),
    keepsHistory: true,
  },
  {
    name: "rename-dashboard",
    kind: "dashboard",
    action: actions.renameDashboard,
    seed: (id) => seedDashboard(id),
    change: (id) => ({ id, name: "Renamed" }),
    noop: (id) => ({ id, name: "Traffic" }),
    next: (id) => ({ id, name: "Traffic" }),
    keepsHistory: true,
  },
  {
    name: "hide-dashboard hide",
    kind: "dashboard",
    action: actions.hideDashboard,
    seed: (id) => seedDashboard(id),
    change: (id) => ({ id, hidden: true }),
    noop: (id) => ({ id, hidden: false }),
    next: (id) => ({ id, hidden: false }),
    keepsHistory: false,
  },
  {
    name: "hide-dashboard unhide",
    kind: "dashboard",
    action: actions.hideDashboard,
    seed: (id) => seedDashboard(id, { hiddenAt: SEED_AT }),
    change: (id) => ({ id, hidden: false }),
    noop: (id) => ({ id, hidden: true }),
    next: (id) => ({ id, hidden: true }),
    keepsHistory: false,
  },
  {
    name: "archive-dashboard archive",
    kind: "dashboard",
    action: actions.archive,
    seed: (id) => seedDashboard(id),
    change: (id) => ({ id, archived: true }),
    noop: (id) => ({ id, archived: false }),
    next: (id) => ({ id, archived: false }),
    keepsHistory: false,
  },
  {
    name: "archive-dashboard unarchive",
    kind: "dashboard",
    action: actions.archive,
    seed: (id) => seedDashboard(id, { archivedAt: SEED_AT }),
    change: (id) => ({ id, archived: false }),
    noop: (id) => ({ id, archived: true }),
    next: (id) => ({ id, archived: true }),
    keepsHistory: false,
  },
  {
    name: "set-dashboard-folder set",
    kind: "dashboard",
    action: actions.setFolder,
    seed: async (id) => {
      await seedFolder("f1");
      await seedDashboard(id);
    },
    change: (id) => ({ dashboardId: id, folderId: "f1" }),
    noop: (id) => ({ dashboardId: id, folderId: null }),
    next: (id) => ({ dashboardId: id, folderId: null }),
    keepsHistory: false,
  },
  {
    name: "set-dashboard-folder unset",
    kind: "dashboard",
    action: actions.setFolder,
    seed: async (id) => {
      await seedFolder("f1");
      await seedDashboard(id, { folderId: "f1" });
    },
    change: (id) => ({ dashboardId: id, folderId: null }),
    noop: (id) => ({ dashboardId: id, folderId: "f1" }),
    next: (id) => ({ dashboardId: id, folderId: "f1" }),
    keepsHistory: false,
  },
  {
    // A restore always writes, so it has no unchanged form.
    name: "restore-dashboard-revision",
    kind: "dashboard",
    action: actions.restoreDashboard,
    seed: async (id) => {
      await seedDashboard(id);
      await seedDashboardRevision(id, "Older");
    },
    change: (id) => ({ dashboardId: id, revisionId: `rev-${id}-Older` }),
    next: (id) => ({ dashboardId: id, revisionId: `rev-${id}-Older` }),
    keepsHistory: true,
  },
  {
    name: "compose-dashboard append",
    kind: "dashboard",
    action: actions.compose,
    seed: seedComposedDashboard,
    change: (id) => ({ dashboardId: id, metrics: ["signups-over-time"] }),
    noop: (id) => ({ dashboardId: id, metrics: ["total-signups"] }),
    next: (id) => ({ dashboardId: id, metrics: ["sessions-by-app"] }),
    keepsHistory: true,
  },
  {
    name: "rename-analysis",
    kind: "analysis",
    action: actions.renameAnalysis,
    seed: (id) => seedAnalysis(id),
    change: (id) => ({ id, name: "Renamed" }),
    noop: (id) => ({ id, name: "Closed lost" }),
    next: (id) => ({ id, name: "Closed lost" }),
    keepsHistory: true,
  },
  {
    name: "hide-analysis hide",
    kind: "analysis",
    action: actions.hideAnalysis,
    seed: (id) => seedAnalysis(id),
    change: (id) => ({ id, hidden: true }),
    noop: (id) => ({ id, hidden: false }),
    next: (id) => ({ id, hidden: false }),
    keepsHistory: false,
  },
  {
    name: "hide-analysis unhide",
    kind: "analysis",
    action: actions.hideAnalysis,
    seed: (id) => seedAnalysis(id, { hiddenAt: SEED_AT }),
    change: (id) => ({ id, hidden: false }),
    noop: (id) => ({ id, hidden: true }),
    next: (id) => ({ id, hidden: true }),
    keepsHistory: false,
  },
  {
    name: "save-analysis",
    kind: "analysis",
    action: actions.saveAnalysis,
    seed: (id) => seedAnalysis(id),
    change: (id) => ({
      id,
      ...analysisFields(),
      resultMarkdown: "# Findings v2",
    }),
    noop: (id) => ({ id, ...analysisFields() }),
    next: (id) => ({ id, ...analysisFields() }),
    keepsHistory: true,
  },
  {
    // A restore always writes, so it has no unchanged form.
    name: "restore-analysis-revision",
    kind: "analysis",
    action: actions.restoreAnalysis,
    seed: async (id) => {
      await seedAnalysis(id);
      await seedAnalysisRevision(id, "Older");
    },
    change: (id) => ({ analysisId: id, revisionId: `rev-${id}-Older` }),
    next: (id) => ({ analysisId: id, revisionId: `rev-${id}-Older` }),
    keepsHistory: true,
  },
];

const conflictCode = (kind: Kind) => `${kind}_conflict`;
const historyTable = (kind: Kind) =>
  kind === "dashboard" ? "dashboard_revisions" : "analysis_revisions";

describe.each(MATRIX)("$name over MCP", (testCase) => {
  const id = "target";
  // `null` leaves the fence out.
  const guarded = (args: Args, fence: string | null = SEED_AT) => ({
    ...args,
    ...(fence === null ? {} : { expectedUpdatedAt: fence }),
    idempotencyKey: newKey(),
  });

  beforeEach(async () => {
    await testCase.seed(id);
  });

  it("refuses a call without idempotencyKey and changes nothing", async () => {
    const before = await everything();

    await expect(
      run(testCase.action, {
        ...testCase.change(id),
        expectedUpdatedAt: SEED_AT,
      }),
    ).rejects.toMatchObject({
      errorCode: "idempotency_key_required",
      statusCode: 400,
    });

    expect(await everything()).toEqual(before);
  });

  it("refuses a call without expectedUpdatedAt and changes nothing", async () => {
    const before = await everything();

    await expect(
      run(testCase.action, guarded(testCase.change(id), null)),
    ).rejects.toMatchObject({
      errorCode: "expected_updated_at_required",
      statusCode: 400,
    });

    expect(await everything()).toEqual(before);
  });

  it("refuses a change on a stale fence and changes nothing", async () => {
    await peerWrite(testCase.kind, id);
    const current = await updatedAtOf(testCase.kind, id);
    const before = await everything();

    await expect(
      run(testCase.action, guarded(testCase.change(id))),
    ).rejects.toMatchObject({
      errorCode: conflictCode(testCase.kind),
      statusCode: 409,
      details: { currentRevision: current, expectedUpdatedAt: SEED_AT },
    });

    expect(await everything()).toEqual(before);
  });

  it("never retries a lost race onto a version the caller did not read", async () => {
    const history = await rows(historyTable(testCase.kind));
    harness.beforeNextTransaction = () => peerWrite(testCase.kind, id);
    const peerAt = new Date(Date.parse(SEED_AT) + 60_000).toISOString();

    await expect(
      run(testCase.action, guarded(testCase.change(id))),
    ).rejects.toMatchObject({
      errorCode: conflictCode(testCase.kind),
      statusCode: 409,
      details: { expectedUpdatedAt: SEED_AT },
    });

    // The peer's write happened mid-call, and only the peer's write landed.
    expect(harness.beforeNextTransaction).toBeNull();
    expect(await updatedAtOf(testCase.kind, id)).toBe(peerAt);
    expect(await rows(historyTable(testCase.kind))).toEqual(history);
    expect(await rows("analytics_write_receipts")).toEqual([]);
  });

  it("advances the revision on every write under a frozen clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(SEED_AT));
    const history = (await rows(historyTable(testCase.kind))).length;

    const first = await run(testCase.action, guarded(testCase.change(id)));
    expect(first.updatedAt).toBe("2026-11-16T12:00:00.001Z");
    expect(await updatedAtOf(testCase.kind, id)).toBe(first.updatedAt);
    expect(first.writeReceipt).toMatchObject({
      outcome: "applied",
      revision: { before: SEED_AT, after: first.updatedAt },
      idempotency: { result: "applied" },
    });

    const second = await run(
      testCase.action,
      guarded(testCase.next(id), first.updatedAt),
    );
    expect(second.updatedAt).toBe("2026-11-16T12:00:00.002Z");
    expect(await updatedAtOf(testCase.kind, id)).toBe(second.updatedAt);

    const receipts = await rows("analytics_write_receipts");
    expect(receipts).toHaveLength(2);
    expect((await rows(historyTable(testCase.kind))).length).toBe(
      testCase.keepsHistory ? history + 2 : history,
    );
  });
});

// Restores always write, so they have no unchanged form to test.
const NOOP_MATRIX = MATRIX.filter(
  (testCase): testCase is MatrixCase & { noop: (id: string) => Args } =>
    testCase.noop !== undefined,
);

describe.each(NOOP_MATRIX)("$name no-op over MCP", (testCase) => {
  const id = "target";
  const guarded = (args: Args) => ({
    ...args,
    expectedUpdatedAt: SEED_AT,
    idempotencyKey: newKey(),
  });

  beforeEach(async () => {
    await testCase.seed(id);
  });

  it("refuses a no-op on a stale fence and changes nothing", async () => {
    await peerWrite(testCase.kind, id);
    const before = await everything();

    await expect(
      run(testCase.action, guarded(testCase.noop(id))),
    ).rejects.toMatchObject({
      errorCode: conflictCode(testCase.kind),
      statusCode: 409,
    });

    expect(await everything()).toEqual(before);
  });

  it("records an unchanged receipt for a current no-op", async () => {
    const before = await everything();

    const result = await run(testCase.action, guarded(testCase.noop(id)));

    expect(result.writeReceipt).toMatchObject({
      outcome: "unchanged",
      revision: { before: SEED_AT, after: SEED_AT },
    });
    const after = await everything();
    expect({ ...after, receipts: [] }).toEqual({ ...before, receipts: [] });
    expect(after.receipts).toHaveLength(1);
  });
});

const rename = (id: string, name: string, fence: string, key = newKey()) => ({
  id,
  name,
  expectedUpdatedAt: fence,
  idempotencyKey: key,
});

describe("AMCP-8: a guarded dashboard edit", () => {
  it("renames and adds a panel once, replays its key, and refuses a stale fence", async () => {
    await seedDashboard("d1");
    const key = newKey();
    const edit = {
      dashboardId: "d1",
      operations: [
        { op: "setDashboard", patch: { name: "Renamed" } },
        { op: "insertPanel", panel: demoPanel("c", "New panel") },
      ],
      expectedUpdatedAt: SEED_AT,
      idempotencyKey: key,
    };

    const applied = await run(actions.mutate, edit);
    expect(applied.saved).toBe(true);
    expect(applied.writeReceipt).toMatchObject({
      action: "mutate-dashboard",
      target: { kind: "dashboard", id: "d1" },
      outcome: "applied",
      revision: { before: SEED_AT, after: applied.updatedAt },
      revisionId: expect.any(String),
      idempotency: { key, result: "applied" },
    });
    const [saved] = await rows("dashboards");
    expect(saved.title).toBe("Renamed");
    expect(JSON.parse(saved.config).panels.map((p: any) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const afterApply = await everything();

    const replayed = await run(actions.mutate, edit);
    expect(replayed).toMatchObject({
      replayed: true,
      dashboardId: "d1",
      writeReceipt: {
        ...applied.writeReceipt,
        idempotency: {
          ...applied.writeReceipt.idempotency,
          result: "replayed",
          replayedAt: expect.any(String),
        },
      },
    });
    expect(await everything()).toEqual(afterApply);

    await expect(
      run(actions.mutate, { ...edit, idempotencyKey: newKey() }),
    ).rejects.toMatchObject({
      errorCode: "dashboard_conflict",
      statusCode: 409,
      details: {
        currentRevision: applied.updatedAt,
        expectedUpdatedAt: SEED_AT,
      },
    });
    expect(await everything()).toEqual(afterApply);
  });
});

describe("AMCP-9: history and restore", () => {
  it("lists a dashboard edit and restores the version before it", async () => {
    await seedDashboard("d1");
    const applied = await run(
      actions.renameDashboard,
      rename("d1", "Renamed", SEED_AT),
    );

    const { revisions } = await run(actions.listDashboardRevisions, {
      dashboardId: "d1",
    });
    expect(revisions[0]).toMatchObject({
      id: applied.writeReceipt.revisionId,
      title: "Traffic",
      createdBy: ALICE,
      changesStatus: "valid",
    });

    const restored = await run(actions.restoreDashboard, {
      dashboardId: "d1",
      revisionId: applied.writeReceipt.revisionId,
      expectedUpdatedAt: applied.updatedAt,
      idempotencyKey: newKey(),
    });
    expect(restored.name).toBe("Traffic");
    const [row] = await rows("dashboards");
    expect(row.title).toBe("Traffic");
    expect(JSON.parse(row.config).name).toBe("Traffic");

    // The restore is itself in history, so it can be undone too.
    const after = await run(actions.listDashboardRevisions, {
      dashboardId: "d1",
    });
    expect(after.revisions[0]).toMatchObject({
      id: restored.snapshotRevisionId,
      title: "Renamed",
    });
    expect(restored.writeReceipt.revisionId).toBe(restored.snapshotRevisionId);
  });

  it("lists an analysis edit and restores the version before it", async () => {
    await seedAnalysis("a1");
    const applied = await run(actions.saveAnalysis, {
      id: "a1",
      ...analysisFields("Rewritten"),
      resultMarkdown: "# Findings v2",
      expectedUpdatedAt: SEED_AT,
      idempotencyKey: newKey(),
    });

    const { revisions } = await run(actions.listAnalysisRevisions, {
      analysisId: "a1",
    });
    expect(revisions[0]).toMatchObject({
      id: applied.writeReceipt.revisionId,
      name: "Closed lost",
    });

    const restored = await run(actions.restoreAnalysis, {
      analysisId: "a1",
      revisionId: applied.writeReceipt.revisionId,
      expectedUpdatedAt: applied.updatedAt,
      idempotencyKey: newKey(),
    });
    expect(restored.name).toBe("Closed lost");
    const [row] = await rows("analyses");
    expect(row.result_markdown).toBe("# Findings v1");
  });
});

describe("AMCP-10: deleting over MCP", () => {
  it("serves no hard delete as an MCP tool", async () => {
    const deletes = [
      (await import("./delete-sql-dashboard")).default,
      (await import("./delete-explorer-dashboard")).default,
      (await import("./delete-analysis")).default,
    ];
    for (const action of deletes) {
      expect((action as { mcpTool?: boolean }).mcpTool).not.toBe(true);
    }
  });

  it("archives a dashboard and brings it back", async () => {
    await seedDashboard("d1");
    const ctx = { email: ALICE, orgId: null };

    const archived = await run(actions.archive, {
      id: "d1",
      archived: true,
      expectedUpdatedAt: SEED_AT,
      idempotencyKey: newKey(),
    });
    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(await listDashboardSummaries(ctx)).toEqual([]);

    const restored = await run(actions.archive, {
      id: "d1",
      archived: false,
      expectedUpdatedAt: archived.updatedAt,
      idempotencyKey: newKey(),
    });
    expect(restored.archivedAt).toBeNull();
    expect((await listDashboardSummaries(ctx)).map((d) => d.id)).toEqual([
      "d1",
    ]);
  });
});

describe("write receipts", () => {
  it("replays after later edits without undoing them", async () => {
    await seedDashboard("d1");
    const request = rename("d1", "Renamed", SEED_AT);
    const applied = await run(actions.renameDashboard, request);
    await run(
      actions.renameDashboard,
      rename("d1", "Later", applied.updatedAt),
    );
    const afterLater = await everything();

    const replayed = await run(actions.renameDashboard, request);

    expect(replayed).toMatchObject({
      replayed: true,
      writeReceipt: {
        receiptId: applied.writeReceipt.receiptId,
        revision: applied.writeReceipt.revision,
        idempotency: { result: "replayed" },
      },
    });
    expect(await everything()).toEqual(afterLater);
    expect(afterLater.dashboards[0].title).toBe("Later");
  });

  it("refuses a key reused for a different request and changes nothing", async () => {
    await seedDashboard("d1");
    const request = rename("d1", "Renamed", SEED_AT);
    const applied = await run(actions.renameDashboard, request);
    const before = await everything();

    for (const changed of [
      { ...request, name: "Something else" },
      { ...request, expectedUpdatedAt: applied.updatedAt },
    ]) {
      await expect(run(actions.renameDashboard, changed)).rejects.toMatchObject(
        {
          errorCode: "IDEMPOTENCY_KEY_REUSED",
          statusCode: 409,
          details: { idempotencyKey: request.idempotencyKey },
        },
      );
    }
    expect(await everything()).toEqual(before);
  });

  it("keeps the same key apart across users, orgs, actions, and targets", async () => {
    await seedDashboard("d1");
    harness.shares.set("dashboard:d1", new Map([[BOB, "editor"]]));
    const key = newKey();

    const alice = await run(
      actions.renameDashboard,
      rename("d1", "Renamed", SEED_AT, key),
    );
    as(BOB);
    const bob = await run(
      actions.renameDashboard,
      rename("d1", "Renamed", alice.updatedAt, key),
    );
    expect(bob.writeReceipt.idempotency.result).toBe("applied");
    expect(bob.writeReceipt.receiptId).not.toBe(alice.writeReceipt.receiptId);

    await seedDashboard("d2");
    as(ALICE, "org-a");
    const orgA = await run(
      actions.renameDashboard,
      rename("d2", "Second", SEED_AT, key),
    );
    as(ALICE, "org-b");
    const orgB = await run(
      actions.renameDashboard,
      rename("d2", "Second again", orgA.updatedAt, key),
    );
    expect(orgB.writeReceipt.idempotency.result).toBe("applied");
    expect(orgB.name).toBe("Second again");

    as(ALICE);
    await seedDashboard("d3");
    await run(actions.renameDashboard, rename("d3", "Third", SEED_AT, key));
    const before = await everything();
    await expect(
      run(actions.hideDashboard, {
        id: "d3",
        hidden: true,
        expectedUpdatedAt: (await updatedAtOf("dashboard", "d3")) as string,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
    expect(await everything()).toEqual(before);

    await seedDashboard("d4");
    const otherTarget = await run(
      actions.renameDashboard,
      rename("d4", "Fourth", SEED_AT, key),
    );
    expect(otherTarget.writeReceipt.idempotency.result).toBe("applied");
    expect(otherTarget.writeReceipt.target.id).toBe("d4");
    // Alice and Bob on d1, two orgs on d2, d3, and d4; the refused hide kept none.
    expect(await rows("analytics_write_receipts")).toHaveLength(6);
  });

  it("authorizes the caller before answering with a replay", async () => {
    await seedDashboard("d1");
    harness.shares.set("dashboard:d1", new Map([[BOB, "editor"]]));
    as(BOB);
    const request = rename("d1", "Renamed", SEED_AT);
    await run(actions.renameDashboard, request);
    const before = await everything();

    harness.shares.set("dashboard:d1", new Map([[BOB, "viewer"]]));
    await expect(run(actions.renameDashboard, request)).rejects.toMatchObject({
      statusCode: 403,
    });
    harness.shares.clear();
    await expect(run(actions.renameDashboard, request)).rejects.toMatchObject({
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
    expect(await everything()).toEqual(before);
  });

  it("refuses a compose replay once the caller can no longer see the dashboard", async () => {
    await seedComposedDashboard("d1");
    harness.shares.set("dashboard:d1", new Map([[BOB, "editor"]]));
    as(BOB);
    const request = {
      dashboardId: "d1",
      metrics: ["signups-over-time"],
      expectedUpdatedAt: SEED_AT,
      idempotencyKey: newKey(),
    };
    const applied = await run(actions.compose, request);
    expect(applied.writeReceipt.idempotency.result).toBe("applied");
    const before = await everything();

    harness.shares.clear();
    await expect(run(actions.compose, request)).rejects.toMatchObject({
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
    expect(await everything()).toEqual(before);
  });

  it("checks access again before answering a failed write from a receipt", async () => {
    await seedDashboard("d1");
    harness.shares.set("dashboard:d1", new Map([[BOB, "editor"]]));
    as(BOB);
    const request = rename("d1", "Renamed", SEED_AT);
    // A duplicate commits after this request's preflight, then Bob loses his
    // share; this request's write then fails on the moved version.
    harness.beforeNextTransaction = async () => {
      await run(actions.renameDashboard, request);
      harness.shares.clear();
    };

    await expect(run(actions.renameDashboard, request)).rejects.toMatchObject({
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
    expect(await rows("analytics_write_receipts")).toHaveLength(1);
  });

  it("answers a config duplicate that commits after its preflight with the receipt", async () => {
    await seedDashboard("d1");
    const request = {
      dashboardId: "d1",
      config: seedConfig("Renamed"),
      expectedUpdatedAt: SEED_AT,
      idempotencyKey: newKey(),
    };
    let first: any;
    harness.beforeNextDashboardRead = async () => {
      first = await run(actions.update, request);
    };

    const second = await run(actions.update, request);

    expect(first.writeReceipt.idempotency.result).toBe("applied");
    expect(second).toMatchObject({
      replayed: true,
      writeReceipt: {
        receiptId: first.writeReceipt.receiptId,
        idempotency: { result: "replayed" },
      },
    });
    expect(await rows("analytics_write_receipts")).toHaveLength(1);
    expect(await rows("dashboard_revisions")).toHaveLength(1);
  });

  it("answers a concurrent duplicate with the committed receipt", async () => {
    await seedDashboard("d1");
    const request = rename("d1", "Renamed", SEED_AT);

    const results = await Promise.all([
      run(actions.renameDashboard, request),
      run(actions.renameDashboard, request),
    ]);

    const outcomes = results
      .map((result) => result.writeReceipt.idempotency.result)
      .sort();
    expect(outcomes).toEqual(["applied", "replayed"]);
    expect(results[0].writeReceipt.receiptId).toBe(
      results[1].writeReceipt.receiptId,
    );
    expect(await rows("analytics_write_receipts")).toHaveLength(1);
    expect(await rows("dashboard_revisions")).toHaveLength(1);
  });

  it("answers concurrent duplicate creates with one dashboard and one folder", async () => {
    const compose = {
      dashboardId: "new-dashboard",
      title: "New dashboard",
      metrics: ["total-signups"],
      idempotencyKey: newKey(),
    };
    const composed = await Promise.all([
      run(actions.compose, compose),
      run(actions.compose, compose),
    ]);
    expect(
      composed.map((r) => r.writeReceipt.idempotency.result).sort(),
    ).toEqual(["applied", "replayed"]);
    expect(composed[0].writeReceipt).toMatchObject({
      revision: { before: null },
      target: { kind: "dashboard", id: "new-dashboard" },
    });

    const folder = {
      name: "Team",
      scope: "personal",
      idempotencyKey: newKey(),
    };
    const created = await Promise.all([
      run(actions.createFolder, folder),
      run(actions.createFolder, folder),
    ]);
    expect(
      created.map((r) => r.writeReceipt.idempotency.result).sort(),
    ).toEqual(["applied", "replayed"]);
    const folders = await rows("dashboard_folders");
    expect(folders).toHaveLength(1);
    for (const result of created) {
      expect(result.writeReceipt.target).toEqual({
        kind: "dashboard-folder",
        id: folders[0].id,
      });
    }
    expect(await rows("dashboards")).toHaveLength(1);
    expect(await rows("analytics_write_receipts")).toHaveLength(2);
  });

  it("rolls the write and its history back when the receipt cannot be stored", async () => {
    await seedDashboard("d1");
    await seedAnalysis("a1");
    await client.exec(`
      CREATE FUNCTION refuse_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'receipt store unavailable'; END $$;
      CREATE TRIGGER refuse_receipt BEFORE INSERT ON analytics_write_receipts
        FOR EACH ROW EXECUTE FUNCTION refuse_receipt();
    `);
    try {
      const before = await everything();
      const attempts: Array<[Action, Args]> = [
        [actions.renameDashboard, rename("d1", "Renamed", SEED_AT)],
        [
          actions.mutate,
          { ...setName("Renamed")("d1"), expectedUpdatedAt: SEED_AT },
        ],
        [
          actions.archive,
          { id: "d1", archived: true, expectedUpdatedAt: SEED_AT },
        ],
        [
          actions.saveAnalysis,
          {
            id: "a1",
            ...analysisFields(),
            resultMarkdown: "# v2",
            expectedUpdatedAt: SEED_AT,
          },
        ],
        [
          actions.compose,
          { dashboardId: "new-dashboard", metrics: ["total-signups"] },
        ],
        [actions.createFolder, { name: "Team", scope: "personal" }],
      ];
      for (const [action, args] of attempts) {
        const error = await run(action, {
          ...args,
          idempotencyKey: newKey(),
        }).then(
          () => null,
          (failure: Error & { cause?: Error }) => failure,
        );
        expect(`${error?.message} ${error?.cause?.message}`).toMatch(
          /receipt store unavailable/,
        );
      }
      expect(await everything()).toEqual(before);
    } finally {
      await client.exec(`
        DROP TRIGGER refuse_receipt ON analytics_write_receipts;
        DROP FUNCTION refuse_receipt();
      `);
    }
  });

  it("replays inside the retention window and treats the key as new after it", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(SEED_AT));
    await seedDashboard("d1");
    const request = rename("d1", "Renamed", SEED_AT);
    const applied = await run(actions.renameDashboard, request);

    vi.setSystemTime(new Date(Date.parse(SEED_AT) + 89 * DAY));
    const replayed = await run(actions.renameDashboard, request);
    expect(replayed.writeReceipt.receiptId).toBe(
      applied.writeReceipt.receiptId,
    );

    vi.setSystemTime(new Date(Date.parse(SEED_AT) + 91 * DAY));
    const before = await everything();
    // Expired, so the same request is new again, and its fence is stale.
    await expect(run(actions.renameDashboard, request)).rejects.toMatchObject({
      errorCode: "dashboard_conflict",
    });
    expect(await everything()).toEqual(before);

    const reused = await run(actions.renameDashboard, {
      ...request,
      name: "Renamed again",
      expectedUpdatedAt: applied.updatedAt,
    });
    expect(reused.writeReceipt.idempotency.result).toBe("applied");
    const receipts = await rows("analytics_write_receipts");
    expect(receipts.map((r) => r.id)).toEqual([reused.writeReceipt.receiptId]);
  });

  it("prunes expired receipts in bounded batches as writes land", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    for (let index = 0; index < 60; index += 1) {
      await client.query(
        `INSERT INTO analytics_write_receipts (id, owner_email, org_id, target_kind,
          target_id, action, caller_scope, idempotency_key, request_digest,
          result_json, created_at)
         VALUES ($1, $2, NULL, 'dashboard', 'old', 'rename-dashboard', 'mcp', $1, 'x', '{}', $3)`,
        [
          `expired-${index}`,
          ALICE,
          new Date(now - (91 + index) * DAY).toISOString(),
        ],
      );
    }
    await client.query(
      `INSERT INTO analytics_write_receipts (id, owner_email, org_id, target_kind,
        target_id, action, caller_scope, idempotency_key, request_digest,
        result_json, created_at)
       VALUES ('recent', $1, NULL, 'dashboard', 'old', 'rename-dashboard', 'mcp', 'recent', 'x', '{}', $2)`,
      [ALICE, new Date(now - 89 * DAY).toISOString()],
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    await seedDashboard("d1");

    await run(actions.renameDashboard, rename("d1", "Renamed", SEED_AT));

    const ids = (await rows("analytics_write_receipts")).map((r) => r.id);
    expect(ids.filter((id) => id.startsWith("expired-"))).toHaveLength(10);
    expect(ids).toContain("recent");
  });
});

describe("a no-op that a peer's identical change made", () => {
  it("returns the stored record, not the one read before the lock", async () => {
    await seedDashboard("d1");
    await seedAnalysis("a1");

    harness.beforeNextTransaction = async () => {
      await run(actions.hideDashboard, { id: "d1", hidden: true }, IN_APP);
    };
    const dashboard = await run(
      actions.hideDashboard,
      { id: "d1", hidden: true },
      IN_APP,
    );
    const [storedDashboard] = await rows("dashboards");
    expect(storedDashboard.hidden_at).not.toBeNull();
    expect(dashboard.hiddenAt).toBe(storedDashboard.hidden_at);

    harness.beforeNextTransaction = async () => {
      await run(actions.hideAnalysis, { id: "a1", hidden: true }, IN_APP);
    };
    const analysis = await run(
      actions.hideAnalysis,
      { id: "a1", hidden: true },
      IN_APP,
    );
    let [storedAnalysis] = await rows("analyses");
    expect(storedAnalysis.hidden_at).not.toBeNull();
    expect(analysis.hiddenAt).toBe(storedAnalysis.hidden_at);

    const { upsertAnalysis } = await import("../server/lib/dashboards-store");
    const body = { ...analysisFields(), resultMarkdown: "# Findings v2" };
    const ctx = { email: ALICE, orgId: null };
    harness.beforeNextTransaction = async () => {
      await upsertAnalysis("a1", body, ctx);
    };
    const saved = await upsertAnalysis("a1", body, ctx);
    [storedAnalysis] = await rows("analyses");
    expect(saved.resultMarkdown).toBe("# Findings v2");
    expect(saved.updatedAt).toBe(storedAnalysis.updated_at);
  });
});

describe("making a record visible again", () => {
  it("claims an unowned record only when it unhides one", async () => {
    await seedDashboard("d1");
    await seedAnalysis("a1");
    await client.query(`UPDATE dashboards SET owner_email = ''`);
    await client.query(`UPDATE analyses SET owner_email = ''`);
    harness.shares.set("dashboard:d1", new Map([[BOB, "viewer"]]));
    harness.shares.set("analysis:a1", new Map([[BOB, "viewer"]]));
    as(BOB);

    await run(actions.hideDashboard, { id: "d1", hidden: false }, IN_APP);
    await run(actions.hideAnalysis, { id: "a1", hidden: false }, IN_APP);
    expect((await rows("dashboards"))[0].owner_email).toBe("");
    expect((await rows("analyses"))[0].owner_email).toBe("");

    await client.query(`UPDATE dashboards SET hidden_at = $1`, [SEED_AT]);
    await client.query(`UPDATE analyses SET hidden_at = $1`, [SEED_AT]);
    await run(actions.hideDashboard, { id: "d1", hidden: false }, IN_APP);
    await run(actions.hideAnalysis, { id: "a1", hidden: false }, IN_APP);
    expect((await rows("dashboards"))[0]).toMatchObject({
      owner_email: BOB,
      hidden_at: null,
    });
    expect((await rows("analyses"))[0]).toMatchObject({
      owner_email: BOB,
      hidden_at: null,
    });
  });

  it("refuses to unarchive what a peer archived after the read", async () => {
    await seedDashboard("d1");
    // The read sees a visible dashboard, so no name lock is taken.
    harness.beforeNextTransaction = async () => {
      await run(actions.archive, { id: "d1", archived: true }, IN_APP);
    };

    await expect(
      run(actions.archive, { id: "d1", archived: false }, IN_APP),
    ).rejects.toMatchObject({
      errorCode: "dashboard_conflict",
      statusCode: 409,
    });
    expect((await rows("dashboards"))[0].archived_at).not.toBeNull();
  });
});

describe("in-app callers", () => {
  it("keep the result shape and write no receipt without protocol arguments", async () => {
    await seedDashboard("d1");

    const result = await run(
      actions.renameDashboard,
      { id: "d1", name: "Renamed" },
      IN_APP,
    );

    expect(result).toEqual({ id: "d1", name: "Renamed" });
    expect(await rows("analytics_write_receipts")).toEqual([]);
  });

  it("keep merging a lost race when they send no fence", async () => {
    await seedDashboard("d1");
    harness.beforeNextTransaction = () => peerWrite("dashboard", "d1");

    const result = await run(actions.mutate, setName("Renamed")("d1"), IN_APP);

    expect(result.saved).toBe(true);
    const [row] = await rows("dashboards");
    const config = JSON.parse(row.config);
    expect(config.name).toBe("Renamed");
    expect(config.description).toBe("peer edit");
  });

  it("keep creating with save-analysis and update-dashboard, which MCP cannot", async () => {
    await expect(
      run(actions.saveAnalysis, {
        id: "new-analysis",
        ...analysisFields(),
        expectedUpdatedAt: SEED_AT,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      errorCode: "analysis_not_found",
      statusCode: 404,
    });
    await expect(
      run(actions.update, {
        dashboardId: "new-dashboard",
        config: seedConfig("New"),
        expectedUpdatedAt: SEED_AT,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
    expect(await rows("analyses")).toEqual([]);
    expect(await rows("dashboards")).toEqual([]);

    await run(
      actions.saveAnalysis,
      { id: "new-analysis", ...analysisFields() },
      IN_APP,
    );
    await run(
      actions.update,
      { dashboardId: "new-dashboard", config: seedConfig("New") },
      IN_APP,
    );
    expect((await rows("analyses")).map((r) => r.id)).toEqual(["new-analysis"]);
    expect((await rows("dashboards")).map((r) => r.id)).toEqual([
      "new-dashboard",
    ]);
  });
});

describe("creates over MCP", () => {
  it.each([
    [
      "compose-dashboard",
      () => actions.compose,
      { dashboardId: "x", metrics: ["total-signups"] },
    ],
    [
      "create-dashboard-folder",
      () => actions.createFolder,
      { name: "Team", scope: "personal" },
    ],
  ] as const)(
    "%s refuses a call without idempotencyKey",
    async (_name, action, args) => {
      await expect(run(action(), args)).rejects.toMatchObject({
        errorCode: "idempotency_key_required",
        statusCode: 400,
      });
      expect(await everything()).toEqual({
        dashboards: [],
        dashboardRevisions: [],
        folders: [],
        analyses: [],
        analysisRevisions: [],
        receipts: [],
      });
    },
  );

  it("compose-dashboard refuses to append without a fence", async () => {
    await seedComposedDashboard("d1");
    const before = await everything();

    await expect(
      run(actions.compose, {
        dashboardId: "d1",
        metrics: ["signups-over-time"],
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ errorCode: "expected_updated_at_required" });
    expect(await everything()).toEqual(before);
  });
});
