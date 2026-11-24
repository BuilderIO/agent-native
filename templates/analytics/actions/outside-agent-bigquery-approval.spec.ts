import { createRequire } from "node:module";

import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const requireCore = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
);
const { Client } = requireCore("@modelcontextprotocol/client");
const { InMemoryTransport } = requireCore("@modelcontextprotocol/server");
const { PGlite } = requireCore("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const database = vi.hoisted(() => {
  const state = { queue: Promise.resolve() };
  return {
    client: null as null | PGliteClient,
    runExclusive: async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = state.queue;
      let release!: () => void;
      state.queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
});
const orgSettings = vi.hoisted(() => new Map<string, unknown>());
const jobs = vi.hoisted(() => ({ count: 0, cap: [] as number[] }));
const backend = vi.hoisted(() => ({ sink: "bigquery", unreadable: false }));
const ledger = vi.hoisted(() => ({ usageReads: 0, failingRead: 0 }));

interface GrantCall {
  nonce: string;
  actionName: string;
  argumentsHash: string;
  expiresAt: number;
  approvalNotice?: string | null;
  createdAt?: number;
}
interface Grant extends GrantCall {
  consumed: boolean;
  createdAt: number;
  reviewed?: "approved";
  answer?: string;
}
interface ToolResult {
  isError?: boolean;
  content: Array<{ text?: unknown }>;
  structuredContent?: {
    bigQueryBudget?: {
      today?: { person: { limitUsd: number; approvedToday: boolean } };
      refusal?: { code: string; message: string };
      maxTotalBytesBilled?: { requested: number; applied: number };
    };
  };
}

const approvalStore = vi.hoisted(() => {
  const grants = new Map<string, Grant>();
  const hooks = { beforeInsert: () => {} };
  const create = async (grant: GrantCall) => {
    hooks.beforeInsert();
    grants.set(grant.nonce, {
      ...grant,
      consumed: false,
      createdAt: grant.createdAt ?? Date.now(),
    });
  };
  return {
    grants,
    hooks,
    create,
    mock: async (importOriginal: () => Promise<object>) => ({
      ...(await importOriginal()),
      createMcpApprovalGrant: vi.fn(create),
      consumeMcpApprovalGrant: vi.fn(async () => {
        throw new Error("a review-page approval never takes a form answer");
      }),
      answerMcpApprovalPrompt: vi.fn(
        async (grant: GrantCall, answer: string) => {
          const existing = grants.get(grant.nonce);
          if (!existing || existing.consumed) return false;
          existing.answer = answer;
          return true;
        },
      ),
      consumeReviewedMcpApprovalGrant: vi.fn(
        async (
          call: Pick<GrantCall, "actionName" | "argumentsHash">,
          nonce?: string,
        ) => {
          for (const existing of grants.values()) {
            if (
              existing.reviewed === "approved" &&
              !existing.consumed &&
              existing.expiresAt >= Date.now() &&
              existing.actionName === call.actionName &&
              existing.argumentsHash === call.argumentsHash &&
              (nonce === undefined || existing.nonce === nonce)
            ) {
              existing.consumed = true;
              return { ...existing, status: "approved" };
            }
          }
          return null;
        },
      ),
      findRecentMcpApprovalRun: vi.fn(async () => null),
      recordMcpApprovalRun: vi.fn(async () => undefined),
    }),
  };
});
const { approvalAuth, userSettings } = vi.hoisted(() => ({
  approvalAuth: () => ({
    getAuthSecret: () => "fake-test-only-mcp-approval-secret",
    findBetterAuthUserIdForEmail: async () => undefined,
  }),
  userSettings: async (importOriginal: () => Promise<object>) => ({
    ...(await importOriginal()),
    getUserSetting: async () => null,
  }),
}));
vi.mock(
  "../../../packages/core/dist/server/better-auth-instance.js",
  approvalAuth,
);
vi.mock(
  "../../../packages/core/src/server/better-auth-instance.js",
  approvalAuth,
);
vi.mock(
  "../../../packages/core/dist/mcp/approval-store.js",
  approvalStore.mock,
);
vi.mock("../../../packages/core/src/mcp/approval-store.js", approvalStore.mock);
vi.mock("../../../packages/core/dist/settings/user-settings.js", userSettings);
vi.mock("../../../packages/core/src/settings/user-settings.js", userSettings);

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const query = async (
    run: (
      sql: string,
      args: unknown[],
    ) => Promise<{ rows: unknown[]; affectedRows?: number }>,
    { sql, args }: { sql: string; args?: unknown[] },
  ) => {
    const result = await run(sql, args ?? []);
    return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
  };
  return {
    ...(await importOriginal<typeof import("@agent-native/core/db")>()),
    getDbExec: () => ({
      execute: (input: { sql: string; args?: unknown[] }) =>
        database.runExclusive(async () => {
          if (
            input.sql.includes("AS person_settled") &&
            ++ledger.usageReads === ledger.failingRead
          ) {
            throw new Error("connection reset");
          }
          return query(
            (sql, args) => must(database.client).query(sql, args),
            input,
          );
        }),
      transaction: <T>(callback: (tx: unknown) => Promise<T>) =>
        database.runExclusive(() =>
          must(database.client).transaction((tx: PGliteClient) =>
            callback({
              execute: (input: { sql: string; args?: unknown[] }) =>
                query((sql, args) => tx.query(sql, args), input),
            }),
          ),
        ),
    }),
  };
});
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: async (orgId: string, key: string) =>
    orgSettings.get(`${orgId}:${key}`) ?? null,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "alice@example.com",
  getRequestOrgId: () => "org-1",
}));
vi.mock("@agent-native/core/tracking", () => ({ track: () => undefined }));
vi.mock(
  "../server/lib/first-party-analytics-backend",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/lib/first-party-analytics-backend")
    >()),
    getFirstPartyAnalyticsBackend: async () => {
      if (backend.unreadable) throw new Error("settings read failed");
      return { sink: backend.sink };
    },
  }),
);

async function admitJob(bytes: number) {
  const { bigQueryJobGate } =
    await import("../server/lib/bigquery-agent-context");
  const gate = must(bigQueryJobGate());
  jobs.count++;
  jobs.cap.push(bytes);
  await gate.admit({
    projectId: "builder-3b0a2",
    jobId: `job_${jobs.count}`,
    credentialScope: "default",
    credentialFingerprint: "sa:runner@example.iam#1",
    exclusive: true,
    capBytes: gate.jobCapFor(bytes),
  });
}
vi.mock(
  "../server/lib/first-party-analytics-health",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../server/lib/first-party-analytics-health")
      >();
    return {
      ...actual,
      getFirstPartyAnalyticsHealth: async () => {
        if (backend.sink === "bigquery") {
          await admitJob(actual.FIRST_PARTY_ANALYTICS_HEALTH_MAX_BYTES_BILLED);
        }
        return actual.unavailableFirstPartyAnalyticsHealth(
          "health_read_failed",
        );
      },
    };
  },
);
vi.mock("../server/lib/onboarding-journey", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/onboarding-journey")>();
  return {
    ...actual,
    getOnboardingJourney: async () => {
      if (backend.sink === "bigquery") {
        await admitJob(actual.ONBOARDING_EVENTS_MAX_BYTES_BILLED);
      }
      return {
        window: { from: "2026-11-01", to: "2026-11-02" },
        app: "all",
        rootN: 0,
        coverage: {
          sessionsWithEvents: 0,
          sessionsWithReplay: 0,
          truncated: false,
        },
        nodes: [],
      };
    },
  };
});

const {
  BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
  BIGQUERY_AGENT_BUDGET_SETTING_KEY,
  BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
} = await import("../server/lib/bigquery-agent-budget");
const { onboardingFollowUpBytes } =
  await import("../server/lib/onboarding-journey-agent-budget");
const { billedBytesForUsd, BYTES_PER_TIB, ON_DEMAND_USD_PER_TIB } =
  await import("../server/lib/bigquery-pricing");
const { default: getHealth } =
  await import("./get-first-party-analytics-health");
const { default: getOnboardingJourney } =
  await import("./get-onboarding-journey");
const { default: estimateOnboardingJourneyCost } =
  await import("./estimate-onboarding-journey-cost");

const actions = {
  "get-first-party-analytics-health": getHealth,
  "get-onboarding-journey": getOnboardingJourney,
  "estimate-onboarding-journey-cost": estimateOnboardingJourneyCost,
};
const NOON = new Date("2026-11-17T12:00:00.000Z");
const MB = 1_000_000;
const closeClients: Array<() => Promise<void>> = [];
const elicit = vi.fn(async () => ({
  action: "accept",
  content: { decision: "approve" },
}));

async function connect(
  modes: { form?: object; url?: object } = { form: {} },
  answer: typeof elicit | (() => Promise<{ action: "decline" }>) = elicit,
) {
  const server = await createMCPServerForRequest(
    {
      name: "Analytics",
      description: "Analytics test server",
      appId: "analytics",
      actions,
    },
    {
      userEmail: "alice@example.com",
      orgDomain: undefined,
      orgId: "org-1",
      identityAssurance: "user",
      oauthScopes: ["mcp:read", "mcp:write"],
    },
    { origin: "http://localhost:8080", transport: "http" },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "analytics-approval-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  client.registerCapabilities({ elicitation: modes });
  client.setRequestHandler("elicitation/create", answer);
  closeClients.push(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return async (
    name: keyof typeof actions,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult> => client.callTool({ name, arguments: args });
}

async function seedJob(
  bytes: number,
  state: "settled" | "pending",
  at: Date = NOON,
  owner = "alice@example.com",
) {
  const id = `seed_${Math.random().toString(36).slice(2)}`;
  await must(database.client).query(
    `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
       credential_scope, source, utc_day, reserved_bytes, billed_bytes, state, submission_state, created_at,
       lease_expires_at, resolved_at)
     VALUES ($1, 'builder-3b0a2', $1, $9, 'org-1', 'org:org-1', 'default', 'seed', $2, $3,
       $4, $5, 'accepted', $6, $7, $8)`,
    [
      id,
      at.toISOString().slice(0, 10),
      bytes,
      state === "settled" ? bytes : null,
      state,
      at.toISOString(),
      new Date(at.getTime() + 6 * 3_600_000).toISOString(),
      state === "settled" ? at.toISOString() : null,
      owner,
    ],
  );
  return id;
}

async function settleJob(id: string, billedBytes: number) {
  await must(database.client).query(
    "UPDATE analytics_bigquery_agent_jobs SET state = 'settled', billed_bytes = $2, resolved_at = $3 WHERE request_id = $1",
    [id, billedBytes, new Date().toISOString()],
  );
}

async function releaseJob(id: string) {
  await must(database.client).query(
    "UPDATE analytics_bigquery_agent_jobs SET state = 'released', resolved_at = $2 WHERE request_id = $1",
    [id, new Date().toISOString()],
  );
}

async function allowanceRows() {
  const { rows } = await must(database.client).query(
    "SELECT utc_day, allowance_bytes::text AS allowance, approved_via, expires_at FROM analytics_bigquery_agent_allowance_approvals",
  );
  return rows;
}

function text(result: ToolResult): string {
  return result.content.map((part) => String(part.text)).join("\n");
}

function budgetOf(result: ToolResult) {
  return must(result.structuredContent?.bigQueryBudget);
}

function onlyGrant(): Grant {
  const grants = [...approvalStore.grants.values()];
  expect(grants).toHaveLength(1);
  const [grant] = grants;
  return must(grant);
}

function approveOnReviewPage(grant: Grant) {
  grant.reviewed = "approved";
  grant.expiresAt = Date.now() + 10 * 60_000;
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
  database.client = await PGlite.create("memory://");
  for (const statement of [
    ...BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
    ...BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  ]) {
    await database.client.exec(statement);
  }
  orgSettings.clear();
  approvalStore.grants.clear();
  approvalStore.hooks.beforeInsert = () => {};
  backend.sink = "bigquery";
  backend.unreadable = false;
  ledger.usageReads = 0;
  ledger.failingRead = 0;
  jobs.count = 0;
  jobs.cap.length = 0;
  elicit.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no BigQuery call in this spec");
    }),
  );
});

afterEach(async () => {
  for (const close of closeClients.splice(0)) await close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await database.client?.close();
  database.client = null;
});

describe("asking an MCP agent's person once past the no-ask allowance", () => {
  it("runs under $1 without asking", async () => {
    const call = await connect();
    const result = await call("get-first-party-analytics-health");
    expect(result.isError).not.toBe(true);
    expect(approvalStore.grants.size).toBe(0);
    expect(jobs.count).toBe(1);
  });

  it("asks once on the review page with the notice, then records $5 for today and admits the job", async () => {
    await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
    const call = await connect();

    const asked = await call("get-first-party-analytics-health");
    expect(asked.isError).toBe(true);
    const grant = onlyGrant();
    expect(text(asked)).toContain(
      `get-first-party-analytics-health needs the user's approval on its review page before it runs. Ask the user to review it here: http://localhost:8080/_agent-native/mcp/approvals/${grant.nonce}`,
    );
    const notice = must(grant.approvalNotice);
    expect(notice.split("\n")).toEqual([
      "Allow up to $5.00 of BigQuery today?",
      "At today's limits, this call can bill up to $0.01. Today you have spent $1.00 and reserved $0.00 of your $1.00 no-ask allowance.",
      "Approving lets your outside agents spend up to $5.00 in total today (UTC), a hard stop. Your organization's $50.00 daily limit for outside agents is also a hard stop; it has spent $1.00 and reserved $0.00.",
      "The approval expires at 00:00 UTC (2026-11-18T00:00:00.000Z).",
    ]);
    expect(text(asked)).toContain(notice);
    expect(elicit).not.toHaveBeenCalled();
    expect(jobs.count).toBe(0);

    approveOnReviewPage(grant);
    const ran = await call("get-first-party-analytics-health");
    expect(ran.isError).not.toBe(true);
    expect(await allowanceRows()).toEqual([
      {
        utc_day: "2026-11-17",
        allowance: String(OUTSIDE_AGENT_PERSON_CEILING_BYTES),
        approved_via: "mcp-review-page",
        expires_at: "2026-11-18T00:00:00.000Z",
      },
    ]);
    expect(jobs.count).toBe(1);
    expect(budgetOf(ran).today?.person).toMatchObject({
      limitUsd: 5,
      approvedToday: true,
    });

    expect((await call("get-first-party-analytics-health")).isError).not.toBe(
      true,
    );
    expect(approvalStore.grants.size).toBe(1);
    expect(jobs.count).toBe(2);
  });

  it("asks the onboarding journey where it would refuse, stating a cost its approved run can't exceed", async () => {
    const personSpent = OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB;
    await seedJob(personSpent, "settled");
    const othersReservation = await seedJob(
      OUTSIDE_AGENT_ORG_LIMIT_BYTES - personSpent - 80_000 * MB,
      "pending",
      NOON,
      "bob@example.com",
    );
    const call = await connect();
    const window = { dateFrom: "2026-11-01", dateTo: "2026-11-02" };
    const asked = await call("get-onboarding-journey", window);
    expect(asked.isError).toBe(true);
    const grant = onlyGrant();
    expect(grant.actionName).toBe("get-onboarding-journey");
    const stated = Number(
      must(
        must(grant.approvalNotice).match(
          /^Allow up to \$5\.00 of BigQuery today\?\nAt today's limits, this call can bill up to \$(\d+\.\d\d)\. /,
        )?.[1],
      ),
    );
    expect(grant.approvalNotice).toContain(
      "The approval expires at 00:00 UTC (2026-11-18T00:00:00.000Z).",
    );
    expect(jobs.count).toBe(0);

    await releaseJob(othersReservation);
    approveOnReviewPage(grant);
    const ran = await call("get-onboarding-journey", window);
    expect(ran.isError).not.toBe(true);
    expect(await allowanceRows()).toHaveLength(1);
    expect(jobs.count).toBe(1);
    const { applied } = must(budgetOf(ran).maxTotalBytesBilled);
    const runCostUsd =
      ((applied + onboardingFollowUpBytes({ followUpMode: "session" })) /
        BYTES_PER_TIB) *
      ON_DEMAND_USD_PER_TIB;
    expect(stated).toBeGreaterThanOrEqual(runCostUsd);
    expect(stated - runCostUsd).toBeLessThan(0.01);
  });

  it("asks nothing and records nothing for an onboarding journey whose queries run on Postgres", async () => {
    backend.sink = "postgres";
    await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
    const call = await connect();
    const result = await call("get-onboarding-journey", {
      dateFrom: "2026-11-01",
      dateTo: "2026-11-02",
    });
    expect(result.isError).not.toBe(true);
    expect(approvalStore.grants.size).toBe(0);
    expect(await allowanceRows()).toEqual([]);
    expect(jobs.count).toBe(0);
  });

  it("uses an approval whose reservation settled lower before the retry, so a later crossing asks nothing", async () => {
    await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 300 * MB, "settled");
    const running = await seedJob(500 * MB, "pending");
    const call = await connect();
    expect((await call("get-first-party-analytics-health")).isError).toBe(true);
    const grant = onlyGrant();

    approveOnReviewPage(grant);
    await settleJob(running, MB);
    expect((await call("get-first-party-analytics-health")).isError).not.toBe(
      true,
    );
    expect(grant.consumed).toBe(true);
    expect(await allowanceRows()).toEqual([
      expect.objectContaining({
        utc_day: "2026-11-17",
        approved_via: "mcp-review-page",
      }),
    ]);

    await seedJob(500 * MB, "settled");
    expect((await call("get-first-party-analytics-health")).isError).not.toBe(
      true,
    );
    expect(approvalStore.grants.size).toBe(1);
    expect(jobs.count).toBe(2);
  });

  it("asks nothing when an admin-raised allowance covers the call", async () => {
    orgSettings.set(`org-1:${BIGQUERY_AGENT_BUDGET_SETTING_KEY}`, {
      personDailyAllowanceBytes: { "alice@example.com": billedBytesForUsd(3) },
    });
    await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
    const call = await connect();
    const result = await call("get-first-party-analytics-health");
    expect(result.isError).not.toBe(true);
    expect(approvalStore.grants.size).toBe(0);
    expect(jobs.count).toBe(1);
  });

  it("keeps $5 a hard stop that no question can raise", async () => {
    await seedJob(OUTSIDE_AGENT_PERSON_CEILING_BYTES - 10 * MB, "settled");
    const call = await connect();
    const result = await call("get-first-party-analytics-health");
    expect(approvalStore.grants.size).toBe(0);
    expect(jobs.count).toBe(1);
    expect(budgetOf(result).refusal).toMatchObject({
      code: "budget_exhausted",
    });
    expect(await allowanceRows()).toEqual([]);
  });

  it("records nothing for an approval used after 00:00 UTC, even one whose grant was made past midnight, and asks again for the new day", async () => {
    const lastSecond = new Date("2026-11-17T23:59:59.900Z");
    vi.setSystemTime(lastSecond);
    await seedJob(
      OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB,
      "pending",
      lastSecond,
    );
    const call = await connect();
    approvalStore.hooks.beforeInsert = () => {
      vi.setSystemTime(new Date("2026-11-18T00:00:00.100Z"));
    };
    expect((await call("get-first-party-analytics-health")).isError).toBe(true);
    approvalStore.hooks.beforeInsert = () => {};
    const grant = onlyGrant();
    expect(grant.approvalNotice).toContain(
      "The approval expires at 00:00 UTC (2026-11-18T00:00:00.000Z).",
    );
    expect(new Date(grant.createdAt).toISOString().slice(0, 10)).toBe(
      "2026-11-17",
    );

    vi.setSystemTime(new Date("2026-11-18T00:01:00.000Z"));
    approveOnReviewPage(grant);
    const used = await call("get-first-party-analytics-health");
    expect(await allowanceRows()).toEqual([]);
    expect(budgetOf(used).refusal).toMatchObject({
      code: "approval_required",
      message: expect.stringContaining(
        "Calling get-first-party-analytics-health with the same arguments asks you once to allow up to $5.00 of BigQuery today, until 00:00 UTC.",
      ),
    });

    const again = await call("get-first-party-analytics-health");
    expect(again.isError).toBe(true);
    expect(approvalStore.grants.size).toBe(2);
    expect(jobs.count).toBe(1);
  });
});

describe("never asking without the notice, or about a read that won't run on BigQuery", () => {
  const window = { dateFrom: "2026-11-01", dateTo: "2026-11-02" };
  const askingReads = [
    ["get-first-party-analytics-health", {}],
    ["get-onboarding-journey", window],
  ] as const;

  it.each(askingReads)(
    "fails %s, with no grant, when the notice's ledger read fails, then asks with the notice once it reads",
    async (name, args) => {
      await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
      const call = await connect();
      const noticeRead = 2;
      ledger.failingRead = noticeRead;

      const failed = await call(name, args);
      expect(failed.isError).toBe(true);
      expect(text(failed)).toContain(
        "The outside-agent BigQuery budget could not be read, so no job was started and nothing was charged. Try again in a few minutes.",
      );
      expect(approvalStore.grants.size).toBe(0);
      expect(jobs.count).toBe(0);

      expect((await call(name, args)).isError).toBe(true);
      expect(onlyGrant().approvalNotice).toContain(
        "Allow up to $5.00 of BigQuery today?",
      );
      expect(await allowanceRows()).toEqual([]);
    },
  );

  it("makes no replacement grant without the notice after a client declines the prompt", async () => {
    await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
    const decline = vi.fn(async () => ({ action: "decline" as const }));
    const call = await connect({ url: {} }, decline);
    const replacementNoticeRead = 3;
    ledger.failingRead = replacementNoticeRead;

    const result = await call("get-first-party-analytics-health");
    expect(decline).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "The outside-agent BigQuery budget could not be read, so no job was started and nothing was charged. Try again in a few minutes.",
    );
    expect([...approvalStore.grants.values()]).toEqual([
      expect.objectContaining({
        answer: "declined",
        approvalNotice: expect.stringContaining(
          "Allow up to $5.00 of BigQuery today?",
        ),
      }),
    ]);
    expect(jobs.count).toBe(0);
  });

  it.each(askingReads)(
    "fails %s, with no grant, when where its queries run can't be read",
    async (name, args) => {
      await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
      backend.unreadable = true;
      const call = await connect();

      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(
        "Analytics could not read where its first-party queries run, so it asked nothing about BigQuery spend and nothing ran. Try again in a few minutes.",
      );
      expect(approvalStore.grants.size).toBe(0);
      expect(jobs.count).toBe(0);
      expect(await allowanceRows()).toEqual([]);
    },
  );

  it.each(["postgres", "dual"])(
    "records nothing for a health approval used after the sink moved to %s",
    async (sink) => {
      await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
      const call = await connect();
      expect((await call("get-first-party-analytics-health")).isError).toBe(
        true,
      );
      const grant = onlyGrant();

      backend.sink = sink;
      approveOnReviewPage(grant);
      const ran = await call("get-first-party-analytics-health");
      expect(ran.isError).not.toBe(true);
      expect(grant.consumed).toBe(true);
      expect(await allowanceRows()).toEqual([]);
      expect(jobs.count).toBe(0);
    },
  );

  it("estimates past $1 by naming the journey that asks, only where the journey asks", async () => {
    await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
    const call = await connect();

    backend.sink = "postgres";
    const unsupported = await call("estimate-onboarding-journey-cost", window);
    expect(unsupported.isError).toBe(true);
    expect(text(unsupported)).toContain(
      "A BigQuery event-page estimate is unavailable for this Analytics backend.",
    );
    expect(text(unsupported)).not.toContain("get-onboarding-journey");
    expect((await call("get-onboarding-journey", window)).isError).not.toBe(
      true,
    );
    expect(approvalStore.grants.size).toBe(0);

    backend.sink = "bigquery";
    const refused = await call("estimate-onboarding-journey-cost", window);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain(
      "Calling get-onboarding-journey with the same arguments asks you once to allow up to $5.00 of BigQuery today, until 00:00 UTC.",
    );
    expect((await call("get-onboarding-journey", window)).isError).toBe(true);
    expect(onlyGrant().actionName).toBe("get-onboarding-journey");
  });
});

describe("a caller that can't be asked", () => {
  it("tells an A2A caller what approving takes and not to retry today", async () => {
    await seedJob(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB, "settled");
    const result = await getHealth.run({}, { caller: "a2a" });
    expect(result.metrics.coverage).toEqual({
      kind: "unavailable",
      reason: "outside_agent_budget",
    });
    const refusal = must(result.bigQueryBudget?.refusal);
    expect(refusal.code).toBe("approval_required");
    expect(refusal.message).toContain(
      "Allowing up to $5.00 today needs your approval on Analytics' review page, which this call can't ask for. Analytics asks once over MCP, when a get-onboarding-journey, get-first-party-analytics-health or query-warehouse call needs more, and that approval covers all your outside agents until 00:00 UTC; an Analytics organization admin can also raise your daily allowance. Until then, do not retry this call today.",
    );
    expect(await allowanceRows()).toEqual([]);
  });
});
