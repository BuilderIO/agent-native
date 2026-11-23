// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  actionCallIntent,
  preparedCallNeedsApproval,
  runPreparedActionCall,
  type PreparedActionCall,
} from "@agent-native/core/action";
import {
  appStateDelete,
  appStateGet,
} from "@agent-native/core/application-state";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";
import searchWorkspace from "./search-workspace.js";

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listThreads: async () => [],
    getThread: async () => null,
  };
});

const OWNER = "qa-search-nav@example.test";
const ORG_ID = "org-search-nav";
const TAB_ID = "tab-k-ana-5-1";
const NAV_KEY = `navigate:${TAB_ID}`;

let tempDir: string | undefined;

async function prepare(input: unknown): Promise<PreparedActionCall> {
  const intent = await actionCallIntent(searchWorkspace, input);
  if (!intent.valid) throw intent.error;
  return intent;
}

function asTab<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    {
      userEmail: OWNER,
      orgId: ORG_ID,
      run: { browserTabId: TAB_ID },
    },
    fn,
  );
}

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-search-nav-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);
  await ensureAnalyticsDatabase();
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES (${ORG_ID},'Search nav fixture',${OWNER},1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-search-nav',${ORG_ID},${OWNER},'member',1)`,
  );
  await createProject({
    ownerEmail: OWNER,
    orgId: ORG_ID,
    title: "Revenue overview",
    description: "Monthly revenue and order volume",
  });
});

beforeEach(async () => {
  await asTab(() => appStateDelete(OWNER, NAV_KEY));
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("search-workspace real navigation guard integration (K-ANA-5-1)", () => {
  it.each(["mcp", "tool"] as const)(
    "queues /home/search?q= through the real action frame and app-state guard when %s passes intent: open",
    async (caller) => {
      const prepared = await prepare({ text: "revenue", intent: "open" });
      expect(
        await preparedCallNeedsApproval(searchWorkspace, prepared, {
          caller,
        }),
      ).toBe(false);

      const output = await asTab(() =>
        runPreparedActionCall(searchWorkspace, prepared, { caller }),
      );

      expect(output.results.map((r) => r.title)).toContain("Revenue overview");
      expect(output.navigation).toEqual({ status: "requested" });
      expect(prepared.readOnly).toBe(false);

      const queued = await asTab(() => appStateGet(OWNER, NAV_KEY));
      expect(queued).toMatchObject({ path: "/home/search?q=revenue" });
    },
  );

  it("stays read-only and leaves the browser tab untouched when intent is omitted", async () => {
    const prepared = await prepare({ text: "revenue" });
    expect(prepared.readOnly).toBe(true);

    const output = await asTab(() =>
      runPreparedActionCall(searchWorkspace, prepared, { caller: "mcp" }),
    );

    expect(output.results.map((r) => r.title)).toContain("Revenue overview");
    expect(output.navigation).toBeUndefined();

    const queued = await asTab(() => appStateGet(OWNER, NAV_KEY));
    expect(queued).toBeNull();
  });

  it("does not queue navigation for frontend UI calls", async () => {
    const prepared = await prepare({ text: "revenue" });
    const output = await asTab(() =>
      runPreparedActionCall(searchWorkspace, prepared, { caller: "frontend" }),
    );

    expect(output.results.map((r) => r.title)).toContain("Revenue overview");
    expect(output.navigation).toBeUndefined();

    const queued = await asTab(() => appStateGet(OWNER, NAV_KEY));
    expect(queued).toBeNull();
  });
});
