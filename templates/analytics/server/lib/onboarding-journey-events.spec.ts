import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { assertFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend.js";
import {
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics.js";
import {
  buildOnboardingJourneyEventsSql,
  isCalendarDate,
  type OnboardingJourneyEventsFilters,
} from "./first-party-metric-catalog.js";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE = { userEmail: "owner@example.test", orgId: "org-1" };

describe("onboarding journey events SQL", () => {
  let client: PGliteClient;
  let today = "";
  let yesterday = "";
  let longAgo = "";
  let nextId = 0;

  afterEach(async () => {
    await client?.close();
    client = undefined as unknown as PGliteClient;
  });

  async function setup() {
    client = await PGlite.create("memory://");
    const days = (await client.query(
      `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today,
              to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD') AS yesterday,
              to_char(CURRENT_DATE - INTERVAL '40 days', 'YYYY-MM-DD') AS long_ago`,
    )) as {
      rows: Array<{ today: string; yesterday: string; long_ago: string }>;
    };
    today = days.rows[0]!.today;
    yesterday = days.rows[0]!.yesterday;
    longAgo = days.rows[0]!.long_ago;
    await client.query(`
      CREATE TABLE analytics_events (
        id text PRIMARY KEY,
        event_name text NOT NULL,
        user_id text,
        anonymous_id text,
        user_key text,
        session_id text,
        timestamp text NOT NULL,
        event_date text,
        app text,
        template text,
        hostname text,
        signed_in text,
        path text,
        properties text NOT NULL DEFAULT '{}',
        org_id text DEFAULT 'org-1',
        owner_email text
      )
    `);
  }

  async function insert(
    sessionId: string,
    eventName: string,
    second: number,
    options: {
      email?: string | null;
      template?: string;
      date?: string;
      path?: string;
      properties?: Record<string, unknown>;
    } = {},
  ) {
    const date = options.date ?? today;
    const stamp = `${date}T12:00:${String(second).padStart(2, "0")}.000Z`;
    await client.query(
      `INSERT INTO analytics_events
        (id, event_name, user_id, anonymous_id, session_id, timestamp, event_date, app, template, hostname, path, properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, 'clips.agent-native.com', $9, $10)`,
      [
        `ev-${nextId++}`,
        eventName,
        options.email ?? null,
        `anon-${sessionId}`,
        sessionId,
        stamp,
        date,
        options.template ?? "clips",
        options.path ?? null,
        JSON.stringify(options.properties ?? {}),
      ],
    );
  }

  function filters(
    overrides: Partial<OnboardingJourneyEventsFilters> = {},
  ): OnboardingJourneyEventsFilters {
    return {
      dateFrom: yesterday,
      dateTo: today,
      app: "all",
      emailFilter: "exclude_builder",
      ...overrides,
    };
  }

  async function run(
    overrides: Partial<OnboardingJourneyEventsFilters> = {},
    page = { limit: 1000, offset: 0 },
  ) {
    const sql = buildOnboardingJourneyEventsSql(filters(overrides), page);
    const scoped = scopedAnalyticsSql(sql, SCOPE);
    const result = (await client.query(scoped.sql, scoped.args)) as {
      rows: Array<Record<string, unknown>>;
    };
    return result.rows;
  }

  const sessionsOf = (rows: Array<Record<string, unknown>>) =>
    [...new Set(rows.map((row) => row.session_id as string))].sort();

  async function seedSessions() {
    // A normal signed-up user: anonymous sign-in page, then identified events.
    await insert("normal", "pageview", 1, { path: "/sign-in" });
    await insert("normal", "auth.signup_viewed", 2);
    await insert("normal", "signup", 3, { email: "alice@example.com" });
    await insert("normal", "onboarding_step_viewed", 4, {
      email: "alice@example.com",
      properties: { flow: "first_run", step_id: "role" },
    });
    await insert("normal", "button_click", 5, { email: "alice@example.com" });
    // A Builder employee: anonymous pre-signup events share the session.
    await insert("employee", "pageview", 1, { path: "/sign-in" });
    await insert("employee", "signup", 3, { email: "dev@builder.io" });
    await insert("employee", "onboarding_step_viewed", 4, {
      email: "dev@builder.io",
      properties: { step_id: "role" },
    });
    // A QA identity, with an anonymous event that would survive a per-event filter.
    await insert("qa", "pageview", 1, { path: "/sign-in" });
    await insert("qa", "signup", 3, { email: "qa+autoz1@example.com" });
    await insert("qa", "onboarding_step_viewed", 4, {
      email: "qa+autoz1@example.com",
      properties: { step_id: "role" },
    });
    // Visited the app but never entered onboarding.
    await insert("returning", "pageview", 1, { path: "/home" });
    await insert("returning", "app_entered", 2, { email: "bob@example.com" });
    // Outside the window, and a different app.
    await insert("old", "signup", 3, {
      email: "carol@example.com",
      date: longAgo,
    });
    await insert("design", "signup", 3, {
      email: "dave@example.com",
      template: "design",
    });
  }

  it("is accepted by the first-party validators and BigQuery translation", async () => {
    await setup();
    const sql = buildOnboardingJourneyEventsSql(filters(), {
      limit: 10,
      offset: 0,
    });
    expect(() => validateFirstPartyAnalyticsSql(sql)).not.toThrow();
    expect(() => assertFirstPartyAnalyticsBigQuerySql(sql)).not.toThrow();
  });

  it("selects renderable Design output events for onboarding sessions", async () => {
    await setup();
    await insert("design-output", "signup", 1, {
      email: "dave@example.com",
      template: "design",
    });
    await insert("design-output", "design_output_created", 2, {
      email: "dave@example.com",
      template: "design",
      properties: { source: "create_file_action" },
    });

    const rows = await run({ app: "design" });

    expect(rows.map((row) => row.event_name)).toEqual([
      "signup",
      "design_output_created",
    ]);
  });

  it("returns only step events of onboarding sessions, in window, with their properties", async () => {
    await setup();
    await seedSessions();
    const rows = await run();

    expect(sessionsOf(rows)).toEqual(["design", "normal"]);
    const normal = rows.filter((row) => row.session_id === "normal");
    expect(normal.map((row) => row.event_name)).toEqual([
      "pageview",
      "auth.signup_viewed",
      "signup",
      "onboarding_step_viewed",
    ]);
    expect(normal[0]).toMatchObject({ path: "/sign-in" });
    expect(normal[3]).toMatchObject({ step_id: "role", method_id: null });
  });

  it("selects Builder aliases and custom-key outcomes without returning raw properties", async () => {
    await setup();
    await insert("setup-flow", "signup", 1, {
      email: "person@example.com",
    });
    await insert("setup-flow", "onboarding_method_clicked", 2, {
      email: "person@example.com",
      properties: {
        flow: "first_run",
        step_id: "choice",
        method_id: "builder_create_account",
      },
    });
    await insert("setup-flow", "builder_connect_clicked", 3, {
      properties: {
        agent_native_flow: "first_run",
        agent_native_connect_source: "first_run_onboarding",
        ignored: "not-selected",
      },
    });
    await insert("setup-flow", "builder connect clicked", 4);
    await insert("setup-flow", "integration_key_validation_outcome", 5, {
      properties: {
        flow: "settings",
        outcome: "accepted",
        ignored: "not-selected",
      },
    });
    await insert("setup-flow", "integration_key_save_outcome", 6, {
      properties: {
        flow: "settings",
        outcome: "saved",
        ignored: "not-selected",
      },
    });
    await insert("custom-key-flow", "signup", 1, {
      email: "other@example.com",
    });
    await insert("custom-key-flow", "onboarding_method_clicked", 2, {
      email: "other@example.com",
      properties: {
        flow: "first_run",
        step_id: "choice",
        method_id: "custom_keys",
      },
    });
    await insert("custom-key-flow", "onboarding_method_started", 3, {
      properties: {
        flow: "first_run",
        step_id: "choice",
        method_id: "custom_keys",
      },
    });
    await insert("custom-key-flow", "onboarding_method_outcome", 4, {
      properties: {
        flow: "first_run",
        step_id: "choice",
        method_id: "custom_keys",
        outcome: "credential_validated",
      },
    });
    await insert("custom-key-flow", "onboarding_method_outcome", 5, {
      properties: {
        flow: "first_run",
        step_id: "choice",
        method_id: "custom_keys",
        outcome: "credential_saved",
      },
    });

    const rows = await run({ app: "clips" });
    const builderRows = rows.filter((row) => row.session_id === "setup-flow");
    const customKeyRows = rows.filter(
      (row) => row.session_id === "custom-key-flow",
    );
    expect(builderRows.map((row) => row.event_name)).toEqual([
      "signup",
      "onboarding_method_clicked",
      "builder_connect_clicked",
      "builder connect clicked",
      "integration_key_validation_outcome",
      "integration_key_save_outcome",
    ]);
    expect(builderRows[2]).toMatchObject({
      flow: "first_run",
      source: "first_run_onboarding",
    });
    expect(builderRows[4]).toMatchObject({
      flow: "settings",
      outcome: "accepted",
    });
    expect(builderRows[5]).toMatchObject({
      flow: "settings",
      outcome: "saved",
    });
    expect(customKeyRows.map((row) => [row.event_name, row.outcome])).toEqual([
      ["signup", null],
      ["onboarding_method_clicked", null],
      ["onboarding_method_started", null],
      ["onboarding_method_outcome", "credential_validated"],
      ["onboarding_method_outcome", "credential_saved"],
    ]);
    expect(Object.keys(builderRows[2]!).sort()).toEqual([
      "action",
      "event_name",
      "flow",
      "id",
      "method_id",
      "outcome",
      "path",
      "session_id",
      "source",
      "step_id",
      "step_index",
      "timestamp",
    ]);
    expect(builderRows[2]).not.toHaveProperty("ignored");
    expect(builderRows[2]).not.toHaveProperty("user_id");
  });

  it("drops a Builder employee's whole session, including its anonymous events", async () => {
    await setup();
    await seedSessions();
    const rows = await run({ emailFilter: "exclude_builder" });
    expect(sessionsOf(rows)).not.toContain("employee");
    expect(rows.filter((row) => row.session_id === "employee")).toEqual([]);
  });

  it("never returns test identities, even when employees are included", async () => {
    await setup();
    await seedSessions();
    const rows = await run({ emailFilter: "all" });
    expect(sessionsOf(rows)).toEqual(["design", "employee", "normal"]);
    expect(
      rows
        .filter((row) => row.session_id === "employee")
        .map((row) => row.event_name),
    ).toEqual(["pageview", "signup", "onboarding_step_viewed"]);
  });

  it("keeps a Builder session's anonymous events when only employees are wanted", async () => {
    await setup();
    await seedSessions();
    const rows = await run({ emailFilter: "only_builder" });
    expect(sessionsOf(rows)).toEqual(["employee"]);
    expect(rows[0]).toMatchObject({ event_name: "pageview" });
  });

  it("applies the app filter and the window before anything is counted", async () => {
    await setup();
    await seedSessions();
    expect(sessionsOf(await run({ app: "design" }))).toEqual(["design"]);
    expect(sessionsOf(await run({ app: "clips" }))).toEqual(["normal"]);
    const wide = await run({ dateFrom: longAgo, dateTo: today });
    expect(sessionsOf(wide)).toContain("old");
    // The 40-day-old signup is outside a window that starts yesterday.
    expect(sessionsOf(await run())).not.toContain("old");
  });

  it("pages deterministically with LIMIT and OFFSET", async () => {
    await setup();
    await seedSessions();
    const all = await run();
    const first = await run({}, { limit: 3, offset: 0 });
    const second = await run({}, { limit: 3, offset: 3 });
    expect(first).toHaveLength(3);
    expect([...first, ...second].map((row) => row.id)).toEqual(
      all.slice(0, 6).map((row) => row.id),
    );
  });

  it("rejects values that would not be safe to interpolate", () => {
    const ok = { limit: 10, offset: 0 };
    expect(() =>
      buildOnboardingJourneyEventsSql(
        filters({ dateFrom: "2026-01-01' OR 1=1" }),
        ok,
      ),
    ).toThrow(/YYYY-MM-DD/);
    // Date.parse rolls these over to the next month; the SQL would not.
    for (const impossible of ["2026-02-31", "2026-04-31", "2026-02-29"]) {
      expect(isCalendarDate(impossible)).toBe(false);
      expect(() =>
        buildOnboardingJourneyEventsSql(filters({ dateTo: impossible }), ok),
      ).toThrow(/YYYY-MM-DD/);
    }
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(() =>
      buildOnboardingJourneyEventsSql(
        filters({ app: "x' OR '1" as never }),
        ok,
      ),
    ).toThrow(/Unknown first-party app/);
    expect(() =>
      buildOnboardingJourneyEventsSql(
        filters({ emailFilter: "everyone" as never }),
        ok,
      ),
    ).toThrow(/email filter/);
    expect(() =>
      buildOnboardingJourneyEventsSql(filters(), { limit: 0, offset: 0 }),
    ).toThrow(/limit/);
  });
});
