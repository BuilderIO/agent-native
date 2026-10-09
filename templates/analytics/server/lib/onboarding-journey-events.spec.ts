import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { assertFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend.js";
import {
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics.js";
import {
  buildOnboardingJourneyFollowupSql,
  buildOnboardingJourneyEventsSql,
  isCalendarDate,
  type OnboardingJourneyEventsFilters,
  type OnboardingJourneyObservationWindow,
  type OnboardingJourneyTerminalStep,
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

  function observation(
    overrides: Partial<OnboardingJourneyObservationWindow> = {},
  ): OnboardingJourneyObservationWindow {
    const nextDate = new Date(
      Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const observationCutoff =
      overrides.observationCutoff ?? `${nextDate}T00:00:00.000Z`;
    return {
      observationCutoff,
      observationDate:
        overrides.observationDate ?? observationCutoff.slice(0, 10),
      ...overrides,
    };
  }

  async function run(
    overrides: Partial<OnboardingJourneyEventsFilters> = {},
    page = { limit: 1000, offset: 0 },
    window = observation(),
  ) {
    const sql = buildOnboardingJourneyEventsSql(
      filters(overrides),
      page,
      window,
    );
    const scoped = scopedAnalyticsSql(sql, SCOPE);
    const result = (await client.query(scoped.sql, scoped.args)) as {
      rows: Array<Record<string, unknown>>;
    };
    return result.rows;
  }

  async function runFollowup(
    terminals: readonly OnboardingJourneyTerminalStep[],
    filterOverrides: Partial<OnboardingJourneyEventsFilters> = {},
    window = observation(),
  ) {
    const sql = buildOnboardingJourneyFollowupSql(
      filters(filterOverrides),
      terminals,
      window,
    );
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

  it("validates and translates both frozen journey and follow-up reads", async () => {
    await setup();
    const window = observation();
    const journeySql = buildOnboardingJourneyEventsSql(
      filters(),
      { limit: 10, offset: 0 },
      window,
    );
    const followupSql = buildOnboardingJourneyFollowupSql(
      filters(),
      [
        {
          sessionId: "session-1",
          stepKey: "step:role",
          tsMs: Date.parse(`${today}T12:00:00.000Z`),
        },
      ],
      window,
    );
    for (const sql of [journeySql, followupSql]) {
      expect(() => validateFirstPartyAnalyticsSql(sql)).not.toThrow();
      expect(() => assertFirstPartyAnalyticsBigQuerySql(sql)).not.toThrow();
      expect(sql).toContain(window.observationCutoff);
    }
  });

  it("keeps template-like terminal values literal and aggregates activity once per session", async () => {
    await setup();
    const sql = buildOnboardingJourneyFollowupSql(
      filters(),
      [
        {
          sessionId: "session-{{unknown}}-{{timeRange}}",
          stepKey: "step:{{observationCutoff}}",
          tsMs: Date.parse(`${today}T12:00:00.000Z`),
        },
      ],
      observation(),
    );

    expect(sql).toContain("'session-{{unknown}}-{{timeRange}}' AS session_id");
    expect(sql).toContain("'step:{{observationCutoff}}' AS terminal_step_key");
    expect(sql).toContain(
      "MAX(later.timestamp::timestamptz) AS last_activity_at",
    );
    expect(sql).not.toContain("WHEN EXISTS (");
  });

  it("uses the same date, app, test, Builder, identity, and cutoff scope for later activity", async () => {
    await setup();
    await seedSessions();
    await insert("identity-switch", "signup", 3, {
      email: "eve@example.com",
    });
    await insert("identity-switch", "onboarding_step_viewed", 4, {
      email: "eve@example.com",
      properties: { flow: "first_run", step_id: "role" },
    });
    // The selected terminal step is authenticated; this later native event is
    // anonymous in the same session and therefore has a different funnel key.
    await insert("identity-switch", "button_click", 5);
    await insert("no-later", "signup", 3, { email: "frank@example.com" });
    await insert("no-later", "onboarding_step_viewed", 4, {
      email: "frank@example.com",
      properties: { flow: "first_run", step_id: "role" },
    });
    // An event exactly at the exclusive cutoff is not observed.
    await insert("no-later", "button_click", 6);

    const terminals = [
      "normal",
      "identity-switch",
      "no-later",
      "employee",
      "qa",
      "old",
      "design",
    ].map(
      (sessionId): OnboardingJourneyTerminalStep => ({
        sessionId,
        stepKey: "step:role",
        tsMs: Date.parse(`${today}T12:00:04.000Z`),
      }),
    );
    const cutoff = `${today}T12:00:06.000Z`;
    const window = observation({ observationCutoff: cutoff });
    const rows = await runFollowup(terminals, { app: "clips" }, window);

    expect(rows).toEqual([
      {
        terminal_step_key: "step:role",
        cohort_sessions: 3,
        later_recorded_activity: 2,
      },
    ]);
    const journeyRows = await run({ app: "clips" }, undefined, window);
    expect(sessionsOf(journeyRows)).toEqual([
      "identity-switch",
      "no-later",
      "normal",
    ]);
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

  it("returns standalone chat setup sessions outside onboarding denominators", async () => {
    await setup();
    await insert("home-chat", "pageview", 1, { path: "/home" });
    await insert("home-chat", "app_entered", 2);
    await insert("home-chat", "integration_setup_exposed", 3, {
      properties: { flow: "chat_setup", method_id: "setup_card" },
    });
    await insert("home-chat", "integration_method_clicked", 4, {
      properties: { flow: "chat_setup", method_id: "custom_keys" },
    });
    await insert("home-chat", "integration_method_outcome", 5, {
      properties: {
        flow: "chat_setup",
        method_id: "custom_keys",
        outcome: "credential_saved",
      },
    });
    await insert("cohort-chat", "signup", 1);
    await insert("cohort-chat", "integration_setup_exposed", 2, {
      properties: { flow: "chat_setup", method_id: "setup_card" },
    });

    const rows = await run();
    const standalone = rows.filter((row) => row.session_id === "home-chat");
    const cohort = rows.filter((row) => row.session_id === "cohort-chat");

    expect(standalone.map((row) => row.event_name)).toEqual([
      "pageview",
      "app_entered",
      "integration_setup_exposed",
      "integration_method_clicked",
      "integration_method_outcome",
    ]);
    expect(standalone.map((row) => row.journey_kind)).toEqual(
      Array(standalone.length).fill("standalone_setup"),
    );
    expect(cohort.map((row) => row.journey_kind)).toEqual([
      "onboarding",
      "onboarding",
    ]);
    expect(rows.filter((row) => row.session_id === "returning")).toEqual([]);
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
        event_alias_id: "builder-click-alias-1",
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
      "alias_id",
      "event_name",
      "flow",
      "id",
      "journey_kind",
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
    expect(builderRows[2]?.alias_id).toBe("builder-click-alias-1");
    expect(builderRows[2]).not.toHaveProperty("user_id");
    expect(builderRows[2]?.journey_kind).toBe("onboarding");
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
