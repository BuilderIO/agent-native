import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import type { DbExec } from "../db/client.js";
import { getSession } from "../server/auth.js";
import {
  getOrgContext,
  resolveOrgIdForEmail,
  resolveOrgIdForEmailViaEvent,
} from "./context.js";
import {
  __resetProcessMemberOrgCacheForTests,
  invalidateMemberOrgCaches,
} from "./request-org-cache.js";
import { checkWorkspaceAppAccessForRequest } from "./workspace-app-access-request.js";

// Per-request cost of a signed-in caller on a guarded action path. Runs the
// real session, org, and workspace-app gate against an in-memory Postgres.
// Counts every database statement and every outbound registry fetch. Better
// Auth is stubbed with a cookie-cache hit (no database round trip), which is
// the steady state for a warm session.

const harness = vi.hoisted(() => ({
  exec: undefined as DbExec | undefined,
  statements: [] as string[],
  fetchUrls: [] as string[],
  session: null as null | {
    user: { email: string; id: string; name: string; emailVerified: boolean };
    session: { token: string };
  },
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => harness.exec ?? actual.getDbExec(),
    isLocalDatabase: () => true,
  };
});

vi.mock("../server/better-auth-instance.js", async (importOriginal) => {
  const actual = await importOriginal<object>();
  const auth = {
    api: {
      getSession: vi.fn(async () => harness.session),
    },
  };
  return {
    ...actual,
    getBetterAuth: vi.fn(async () => auth),
    getBetterAuthSync: vi.fn(() => auth),
  };
});

const EMAIL = "member@example.test";
const OWNER = "owner@example.test";
const ORG_ID = "org-1";
const APP_PATH = "/_agent-native/actions/list-designs";
const WORKSPACE_APP_ID = "workspace-app-under-test";
const GATEWAY_URL = "https://dispatch.example.test";
const MEMBERSHIP_TTL_BOUND_MS = 15_000;

function countingExec(
  pg: Awaited<ReturnType<typeof createTestPglite>>,
): DbExec {
  return {
    async execute(query) {
      const statement =
        typeof query === "string" ? { sql: query, args: [] } : query;
      harness.statements.push(statement.sql);
      let index = 0;
      const result = await pg.db.query(
        statement.sql.replace(/\?/g, () => `$${++index}`),
        (statement.args ?? []).map((value) =>
          value === undefined ? null : value,
        ),
      );
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
  } as unknown as DbExec;
}

function makeEvent() {
  const url = new URL(`http://localhost${APP_PATH}`);
  return {
    context: {},
    method: "GET",
    path: APP_PATH,
    url,
    req: new Request(url, {
      headers: { cookie: "an_org_selection=warm-selection-0123456789" },
    }),
    res: { headers: new Headers() },
  } as any;
}

async function seed(pg: Awaited<ReturnType<typeof createTestPglite>>) {
  await pg.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY, name TEXT, created_by TEXT, created_at BIGINT,
      a2a_secret TEXT, identity_authority TEXT, identity_id TEXT, allowed_domain TEXT
    );
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY, org_id TEXT, email TEXT, role TEXT, joined_at BIGINT,
      federation_removal_pending_at BIGINT
    );
    CREATE TABLE workspace_apps (
      id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT, visibility TEXT, org_enabled BOOLEAN
    );
    CREATE TABLE identity_rekeys (
      id TEXT PRIMARY KEY, old_email TEXT, new_email TEXT, status TEXT, error TEXT,
      actor_email TEXT, counts_json TEXT, created_at BIGINT, updated_at BIGINT, completed_at BIGINT
    );
    INSERT INTO organizations (id, name, created_by, created_at, a2a_secret, allowed_domain)
      VALUES ('${ORG_ID}', 'Acme', '${OWNER}', 1, 'secret', 'example.test');
    INSERT INTO org_members (id, org_id, email, role, joined_at)
      VALUES ('m1', '${ORG_ID}', '${OWNER}', 'owner', 1);
    INSERT INTO workspace_apps (id, owner_email, org_id, visibility, org_enabled)
      VALUES ('${WORKSPACE_APP_ID}', '${OWNER}', '${ORG_ID}', 'org', true);
  `);
}

// The per-request path: session guard, workspace-app gate, then the org
// resolution the generated UI action context performs for the same event.
async function warmRequest(email = EMAIL) {
  const event = makeEvent();
  const session = await getSession(event);
  const access = await checkWorkspaceAppAccessForRequest({
    path: APP_PATH,
    method: "GET",
    email: session!.email,
    orgId: session!.orgId,
  });
  await getSession(event);
  return {
    access,
    orgId: (await resolveOrgIdForEmailViaEvent(event, email)) ?? null,
    context: await getOrgContext(event),
  };
}

// The first request on an instance pays schema probes and cache fills. The
// second, on a fresh event, is the warm request the budget is about.
async function measureWarm() {
  await warmRequest();
  harness.statements.length = 0;
  harness.fetchUrls.length = 0;
  const result = await warmRequest();
  return {
    result,
    statements: [...harness.statements],
    fetches: [...harness.fetchUrls],
  };
}

// The registry fixture's disabled flag, read by the fetch spy at call time.
const harnessFetch = vi.hoisted(() => ({ appEnabled: true }));

// One database for both blocks: the settings store memoizes its table setup per
// module instance, so a second database would never get the table.
let pg: Awaited<ReturnType<typeof createTestPglite>>;

beforeAll(async () => {
  pg = await createTestPglite();
  await seed(pg);
  harness.exec = countingExec(pg);
}, 60_000);

// Every block starts from the same membership: the member row is re-added and
// the process caches are dropped. Without the re-add, a block run alone would
// auto-join the member by domain and measure that path instead.
beforeEach(async () => {
  __resetProcessMemberOrgCacheForTests();
  await pg.exec(`DELETE FROM org_members WHERE id = 'm2'`);
  await pg.exec(
    `INSERT INTO org_members (id, org_id, email, role, joined_at)
     VALUES ('m2', '${ORG_ID}', '${EMAIL}', 'member', 2)`,
  );
  harness.statements.length = 0;
  harness.fetchUrls.length = 0;
});

describe("warm signed-in request budget (direct database gate)", () => {
  beforeAll(() => {
    defineAppConfig({ app: { id: "design", workspaceId: WORKSPACE_APP_ID } });
  });

  afterAll(() => {
    resetAppConfigForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    harness.session = {
      user: {
        email: EMAIL,
        id: "user-member",
        name: "Member",
        emailVerified: true,
      },
      session: { token: "session-token-member" },
    };
  });

  it("counts statements for a warm request", async () => {
    const { result, statements } = await measureWarm();
    expect(result.access).toBe(true);
    expect(result.orgId).toBe(ORG_ID);
    expect(result.context.orgId).toBe(ORG_ID);
    expect(statements).toHaveLength(WARM_DIRECT_STATEMENTS);
  });

  it("honors a removed membership after invalidation", async () => {
    expect((await warmRequest()).orgId).toBe(ORG_ID);

    await pg.exec(
      `DELETE FROM org_members WHERE org_id = '${ORG_ID}' AND email = '${EMAIL}'`,
    );
    invalidateMemberOrgCaches();

    const after = await warmRequest();
    expect(after.orgId).toBeNull();
    expect(after.access).toBe(false);
  });

  it("honors a removed membership once the TTL bound has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    expect((await warmRequest()).orgId).toBe(ORG_ID);

    await pg.exec(
      `DELETE FROM org_members WHERE org_id = '${ORG_ID}' AND email = '${EMAIL}'`,
    );
    vi.setSystemTime(Date.now() + MEMBERSHIP_TTL_BOUND_MS + 1);

    const after = await warmRequest();
    expect(after.orgId).toBeNull();
    expect(after.access).toBe(false);
  });

  it("keeps resolveOrgIdForEmail honest about removed memberships", async () => {
    expect(await resolveOrgIdForEmail(EMAIL)).toBe(ORG_ID);
    await pg.exec(
      `DELETE FROM org_members WHERE org_id = '${ORG_ID}' AND email = '${EMAIL}'`,
    );
    invalidateMemberOrgCaches();
    expect(await resolveOrgIdForEmail(EMAIL)).toBeNull();
  });
});

describe("warm signed-in request budget (hosted dispatch registry)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    process.env.A2A_SECRET = "budget-test-a2a-secret";
    resetAppConfigForTests();
    defineAppConfig({
      app: { id: "design", workspaceId: WORKSPACE_APP_ID },
      workspace: { gatewayUrl: GATEWAY_URL },
    });
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: any) => {
        const url = String(input?.url ?? input);
        harness.fetchUrls.push(url);
        return new Response(
          JSON.stringify({
            apps: [
              {
                id: WORKSPACE_APP_ID,
                name: "Design",
                path: "/design",
                orgEnabled: harnessFetch.appEnabled,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
  });

  afterAll(() => {
    fetchSpy.mockRestore();
    delete process.env.A2A_SECRET;
    resetAppConfigForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    harnessFetch.appEnabled = true;
    harness.session = {
      user: {
        email: EMAIL,
        id: "user-member",
        name: "Member",
        emailVerified: true,
      },
      session: { token: "session-token-member" },
    };
  });

  it("counts statements and registry fetches for a warm request", async () => {
    const { result, statements, fetches } = await measureWarm();
    expect(result.access).toBe(true);
    expect(statements).toHaveLength(WARM_HOSTED_STATEMENTS);
    expect(fetches).toHaveLength(WARM_HOSTED_FETCHES);
  });

  it("honors a disabled app once the TTL bound has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    expect((await warmRequest()).access).toBe(true);

    harnessFetch.appEnabled = false;
    vi.setSystemTime(Date.now() + MEMBERSHIP_TTL_BOUND_MS + 1);

    expect((await warmRequest()).access).toBe(false);
  });

  it("honors a disabled app immediately after invalidation", async () => {
    expect((await warmRequest()).access).toBe(true);

    harnessFetch.appEnabled = false;
    invalidateMemberOrgCaches();

    expect((await warmRequest()).access).toBe(false);
  });
});

// A warm request reads its workspace access from this instance's caches. Any
// statement or registry fetch here means a cache was bypassed or missed.
const WARM_DIRECT_STATEMENTS = 0;
const WARM_HOSTED_STATEMENTS = 0;
const WARM_HOSTED_FETCHES = 0;
