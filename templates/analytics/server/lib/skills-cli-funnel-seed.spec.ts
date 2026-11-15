import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadDashboardSeed } from "./dashboard-seeds";
import {
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics";
import { renderFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend";

// Every panel of the shipped Skills CLI Funnel seed, run through the real
// first-party scoping against synthetic CLI runs in a local PGlite database.

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const scope = { userEmail: "owner@example.com", orgId: "org-1" };
const today = "2026-11-08";
const bigQueryTable = {
  projectId: "example-project",
  datasetId: "analytics",
  tableId: "events",
  fullyQualified: "example-project.analytics.events",
};

const EVENT_COLUMNS =
  "id, event_name, user_id, user_key, anonymous_id, session_id, timestamp, event_date, received_at, hostname, app, template, properties, owner_email, org_id";

type SeedPanel = { id: string; source?: string; sql?: string };

const seed = loadDashboardSeed("skills-cli-funnel");
const panels = (Array.isArray(seed?.panels) ? seed.panels : []) as SeedPanel[];

function panelSql(id: string): string {
  const sql = panels.find((panel) => panel.id === id)?.sql;
  if (!sql) throw new Error(`Skills CLI Funnel seed has no panel ${id}`);
  return sql;
}

// Four runs, as the CLI reports them: one finishes, one stops after picking
// clients, one stops right after starting, and one picks custom skills.
const RUNS: Array<{
  session: string;
  events: Array<[string, Record<string, string>?]>;
}> = [
  {
    session: "run-1",
    events: [
      ["skills_cli started"],
      ["skills_cli skills prompted"],
      ["skills_cli skills selected", { selected: "assets,content" }],
      ["skills_cli clients selected", { clients: "codex,claude-code" }],
      ["skills_cli scope selected", { scope: "project" }],
      ["skills_cli install completed"],
      ["skills_cli completed"],
    ],
  },
  {
    session: "run-2",
    events: [
      ["skills_cli started"],
      ["skills_cli skills selected", { selected: "content, design" }],
      ["skills_cli clients selected", { clients: "codex" }],
    ],
  },
  { session: "run-3", events: [["skills_cli started"]] },
  {
    session: "run-4",
    events: [
      ["skills_cli started"],
      ["skills_cli skills selected", { selected: "custom,custom,content" }],
      ["skills_cli clients selected", { clients: "" }],
    ],
  },
];

describe("Skills CLI Funnel seed panels", () => {
  let client: Awaited<ReturnType<typeof PGlite.create>>;

  beforeAll(async () => {
    client = await PGlite.create();
    await client.exec(`
      CREATE TABLE analytics_events (
        id text, event_name text, user_id text, user_key text, anonymous_id text,
        session_id text, timestamp text, event_date text, received_at text,
        hostname text, app text, template text, properties text,
        owner_email text, org_id text
      );
    `);
    for (const run of RUNS) {
      for (const [index, [eventName, properties]] of run.events.entries()) {
        await client.query(
          `INSERT INTO analytics_events (${EVENT_COLUMNS}) VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $5, NULL, NULL, NULL, $7, 'owner@example.com', 'org-1')`,
          [
            `${run.session}-${index}`,
            eventName,
            `install-${run.session}`,
            run.session,
            `${today}T00:00:0${index}.000Z`,
            today,
            JSON.stringify(properties ?? {}),
          ],
        );
      }
    }
  });

  afterAll(async () => {
    await client.close();
  });

  async function run(sql: string): Promise<Array<Record<string, unknown>>> {
    const scoped = scopedAnalyticsSql(sql, scope, today);
    const result = await client.query(scoped.sql, scoped.args);
    return result.rows as Array<Record<string, unknown>>;
  }

  it("ships its 12 first-party panels", () => {
    expect(panels).toHaveLength(12);
    expect(panels.every((panel) => panel.source === "first-party")).toBe(true);
  });

  it.each(panels.map((panel) => [panel.id, panel] as const))(
    "%s passes the first-party SQL rules, runs on Postgres and renders for BigQuery",
    async (_id, panel) => {
      const sql = panel.sql ?? "";
      expect(() => validateFirstPartyAnalyticsSql(sql)).not.toThrow();
      await expect(run(sql)).resolves.toBeInstanceOf(Array);
      const scoped = scopedAnalyticsSql(sql, scope, today);
      expect(() =>
        renderFirstPartyAnalyticsBigQuerySql(
          scoped.sql,
          scoped.args,
          bigQueryTable,
        ),
      ).not.toThrow();
    },
  );

  it("rates completed installs against started runs", async () => {
    const rows = await run(panelSql("skills-cli-completion-rate"));
    expect(rows.map((row) => Number(row.rate))).toEqual([25]);
  });

  it("lists each step's runs and their share of starts", async () => {
    const rows = await run(panelSql("skills-cli-dropoff-table"));
    expect(
      rows.map((row) => [
        row.step,
        Number(row.reached),
        Number(row.pct_of_start),
      ]),
    ).toEqual([
      ["Started", 4, 100],
      ["Skills prompted", 1, 25],
      ["Skills selected", 3, 75],
      ["Clients selected", 3, 75],
      ["Scope selected", 1, 25],
      ["Install completed", 1, 25],
      ["Completed", 1, 25],
    ]);
  });

  const counts = (rows: Array<Record<string, unknown>>, key: string) =>
    Object.fromEntries(rows.map((row) => [row[key], Number(row.count)]));

  it("counts every skill in each run's comma-joined list", async () => {
    const rows = await run(panelSql("skills-cli-skills-popularity"));
    expect(counts(rows, "skill")).toEqual({
      content: 3,
      custom: 2,
      assets: 1,
      design: 1,
    });
  });

  it("counts every client in each run's comma-joined list", async () => {
    const rows = await run(panelSql("skills-cli-clients-chosen"));
    expect(counts(rows, "client")).toEqual({ codex: 2, "claude-code": 1 });
  });

  it.each(["skills-cli-skills-popularity", "skills-cli-clients-chosen"])(
    "%s splits its list with a fixed index BigQuery can read",
    (id) => {
      const scoped = scopedAnalyticsSql(panelSql(id), scope, today);
      const rendered = renderFirstPartyAnalyticsBigQuerySql(
        scoped.sql,
        scoped.args,
        bigQueryTable,
      );
      expect(rendered).toContain("[SAFE_OFFSET(0)]");
      expect(rendered).not.toMatch(/\bunnest\b|\bLATERAL\b/i);
    },
  );
});
