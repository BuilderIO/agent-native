import { createRequire } from "node:module";

import { readAgentSqlQuery } from "@agent-native/core/agent-sql";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertFirstPartyAnalyticsBigQuerySql,
  renderFirstPartyAnalyticsBigQuerySql,
} from "./first-party-analytics-backend.js";
import {
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics.js";
import {
  buildOnboardingJourneyEventsSql,
  buildOnboardingJourneyFollowupSql,
  buildOnboardingJourneyPersonFollowupSql,
  isCalendarDate,
  type OnboardingJourneyEventsFilters,
  type OnboardingJourneyObservationWindow,
  type OnboardingJourneyPersonMember,
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
        received_at text NOT NULL,
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
    sessionId: string | null,
    eventName: string,
    second: number,
    options: {
      email?: string | null;
      template?: string;
      date?: string;
      path?: string;
      properties?: Record<string, unknown>;
      orgId?: string;
    } = {},
  ) {
    const date = options.date ?? today;
    const stamp = `${date}T12:00:${String(second).padStart(2, "0")}.000Z`;
    await client.query(
      `INSERT INTO analytics_events
        (id, event_name, user_id, anonymous_id, session_id, timestamp, received_at, event_date, app, template, hostname, path, properties, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $8, 'clips.agent-native.com', $9, $10, $11)`,
      [
        `ev-${nextId++}`,
        eventName,
        options.email ?? null,
        `anon-${sessionId ?? "missing"}`,
        sessionId,
        stamp,
        date,
        options.template ?? "clips",
        options.path ?? null,
        JSON.stringify(options.properties ?? {}),
        options.orgId ?? SCOPE.orgId,
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
      observationWatermark: overrides.observationWatermark ?? observationCutoff,
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

  async function runPersonFollowup(
    members: readonly OnboardingJourneyPersonMember[],
    filterOverrides: Partial<OnboardingJourneyEventsFilters> = {},
    window = observation(),
  ) {
    const sql = buildOnboardingJourneyPersonFollowupSql(
      filters(filterOverrides),
      members,
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
    const personFollowupSql = buildOnboardingJourneyPersonFollowupSql(
      filters(),
      [
        {
          sessionId: "session-1",
          stepKey: "step:role",
          tsMs: Date.parse(`${today}T12:00:00.000Z`),
          app: "clips",
          authUserId: "person-1",
        },
      ],
      observation({ observationWatermark: window.observationCutoff }),
    );
    for (const sql of [journeySql, followupSql, personFollowupSql]) {
      expect(() => validateFirstPartyAnalyticsSql(sql)).not.toThrow();
      expect(() => assertFirstPartyAnalyticsBigQuerySql(sql)).not.toThrow();
      expect(sql).toContain(window.observationCutoff);
    }
  });

  it("reuses one scoped source pass and preserves output uniqueness in BigQuery", async () => {
    await setup();
    const sql = buildOnboardingJourneyEventsSql(
      filters(),
      { limit: 10, offset: 0 },
      observation(),
    );

    expect(sql.match(/\bFROM\s+scoped_onboarding_events\s+e\b/gi)).toHaveLength(
      1,
    );
    expect(sql).toContain(
      "PARTITION BY e.template_name, e.output_id, e.output_attempt_id",
    );
    expect(sql).toContain("MIN(e.candidate_session_id) OVER (");
    expect(sql).toContain("MAX(e.candidate_session_id) OVER (");
    expect(sql).toContain("MIN(e.candidate_journey_kind) OVER (");
    expect(sql).toContain("MAX(e.candidate_journey_kind) OVER (");
    expect(sql).not.toContain("COUNT(DISTINCT source_session_id)");

    const scoped = scopedAnalyticsSql(sql, SCOPE);
    await client.query(scoped.sql, scoped.args);
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      scoped.sql,
      scoped.args,
      {
        projectId: "example-project",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "example-project.analytics.first_party_analytics_events_raw",
      },
      { eventDateRange: { startDate: yesterday, endDate: today } },
    );
    expect(() =>
      readAgentSqlQuery(rendered, { dialect: "bigquery" }),
    ).not.toThrow();
  });

  it("preserves hostile member JSON through PostgreSQL scoping and BigQuery rendering", async () => {
    await setup();
    const member = {
      sessionId: "session'\\path\\u0027",
      stepKey: "step:'quoted'\\u0027\nline",
      tsMs: Date.parse(`${today}T12:00:00.000Z`),
      app: "clips",
      authUserId: "person'\\u0027\nline",
    };
    const sql = buildOnboardingJourneyPersonFollowupSql(
      filters(),
      [member],
      observation(),
    );
    const scoped = scopedAnalyticsSql(sql, SCOPE);
    const postgres = (await client.query(scoped.sql, scoped.args)) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(postgres.rows).toHaveLength(1);
    expect(postgres.rows[0]?.terminal_step_key).toBe(member.stepKey);

    const payload = JSON.stringify({
      sessionId: member.sessionId,
      stepKey: member.stepKey,
      app: member.app,
      timestamp: new Date(member.tsMs).toISOString(),
      authUserId: member.authUserId,
    });
    const table = {
      projectId: "example-project",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified:
        "example-project.analytics.first_party_analytics_events_raw",
    };
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      scoped.sql,
      scoped.args,
      table,
    );
    expect(rendered).toContain(
      `'${payload.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
    );
    expect(() =>
      readAgentSqlQuery(rendered, { dialect: "bigquery" }),
    ).not.toThrow();
    expect(rendered).toContain(
      "FROM `example-project.analytics.first_party_analytics_events_raw`",
    );
  });

  it("avoids an unused identity-bridge scan while keeping session email filters", async () => {
    await setup();
    await seedSessions();
    const window = observation();
    const journeySql = buildOnboardingJourneyEventsSql(
      filters(),
      { limit: 10, offset: 0 },
      window,
    );
    const sessionFollowupSql = buildOnboardingJourneyFollowupSql(
      filters(),
      [
        {
          sessionId: "normal",
          stepKey: "step:role",
          tsMs: Date.parse(`${today}T12:00:04.000Z`),
        },
      ],
      window,
    );

    for (const sql of [journeySql, sessionFollowupSql]) {
      expect(sql).not.toContain("auth_identity_bridge");
      expect(sql).not.toContain("funnel_user_key");
      expect(sql).toContain("funnel_user_email");
      expect(sql.match(/FROM analytics_events/g)).toHaveLength(1);
    }

    expect(sessionsOf(await run())).toEqual(["design", "normal"]);
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

  it("classifies canonical people across sessions and first-party apps within a fixed horizon", async () => {
    await setup();
    const terminalAt = Date.parse(`${today}T12:00:04.000Z`);
    const oldTerminalAt = Date.parse(`${longAgo}T12:00:04.000Z`);
    await insert("same-session", "button_click", 5, {
      email: "same@example.com",
      properties: { auth_user_id: "person-same" },
    });
    await insert("both-selected", "button_click", 5, {
      email: "both@example.com",
      properties: { auth_user_id: "person-both" },
    });
    await insert("other-app", "button_click", 6, {
      email: "outside@example.com",
      template: "design",
      properties: { auth_user_id: "person-outside" },
    });
    await insert("both-outside", "button_click", 6, {
      email: "both@example.com",
      template: "design",
      properties: { auth_user_id: "person-both" },
    });
    await insert("unavailable", "button_click", 7);
    await insert("builder-activity", "button_click", 8, {
      email: "dev@builder.io",
      template: "design",
      properties: { auth_user_id: "person-outside" },
    });
    await insert("test-identity-activity", "button_click", 9, {
      email: "qa+autoz1@example.com",
      template: "design",
      properties: { auth_user_id: "person-outside" },
    });

    const members: OnboardingJourneyPersonMember[] = [
      {
        sessionId: "same-session",
        stepKey: "step:role",
        tsMs: terminalAt,
        app: "clips",
        authUserId: "person-same",
      },
      {
        sessionId: "both-selected",
        stepKey: "step:role",
        tsMs: terminalAt,
        app: "clips",
        authUserId: "person-both",
      },
      {
        sessionId: "outside-terminal",
        stepKey: "step:role",
        tsMs: terminalAt,
        app: "clips",
        authUserId: "person-outside",
      },
      {
        sessionId: "no-activity",
        stepKey: "step:role",
        tsMs: oldTerminalAt,
        app: "clips",
        authUserId: "person-no-activity",
      },
      {
        sessionId: "censored",
        stepKey: "step:role",
        tsMs: terminalAt,
        app: "clips",
        authUserId: "person-censored",
      },
      {
        sessionId: "unavailable",
        stepKey: "step:role",
        tsMs: terminalAt,
        app: "clips",
        authUserId: null,
      },
    ];
    const watermark = observation({
      observationWatermark: `${new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`,
    });
    const rows = await runPersonFollowup(members, { app: "clips" }, watermark);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      terminal_step_key: "step:role",
      canonical_people: 5,
      identity_unavailable_sessions: 1,
      later_activity_in_selected_session: 2,
      later_activity_outside_selected_session_or_app: 2,
      later_activity_in_both_selected_and_outside: 1,
      later_activity_observed_anywhere: 3,
      no_activity_observed_within_horizon: 1,
      right_censored_horizon: 1,
      fully_observed_canonical_people: 1,
      identity_unavailable_with_selected_session_activity: 1,
      identity_unavailable_with_outside_session_or_app_activity: 0,
    });
  });

  it("keeps Builder filtering session-scoped and counts sessionless activity as outside", async () => {
    await setup();
    const terminalAt = Date.parse(`${today}T12:00:02.000Z`);
    await insert("builder-cohort", "onboarding_step_viewed", 2, {
      email: "dev@builder.io",
      properties: {
        flow: "first_run",
        step_id: "role",
        auth_user_id: "person-builder",
      },
    });
    await insert("builder-cohort", "button_click", 3, {
      properties: { auth_user_id: "person-builder" },
    });
    await insert(null, "button_click", 4, {
      email: "dev@builder.io",
      template: "design",
      properties: { auth_user_id: "person-builder" },
    });
    await insert("unclassified-session", "button_click", 5, {
      template: "design",
      properties: { auth_user_id: "person-builder" },
    });

    const rows = await runPersonFollowup(
      [
        {
          sessionId: "builder-cohort",
          stepKey: "step:role",
          tsMs: terminalAt,
          app: "clips",
          authUserId: "person-builder",
        },
      ],
      { emailFilter: "only_builder" },
      observation({
        observationWatermark: `${new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`,
      }),
    );

    expect(rows).toMatchObject([
      {
        canonical_people: 1,
        later_activity_in_selected_session: 1,
        later_activity_outside_selected_session_or_app: 1,
        later_activity_in_both_selected_and_outside: 1,
        later_activity_observed_anywhere: 1,
      },
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

  it("links a sessionless saved Clip only through one exact cohort output and attempt pair", async () => {
    await setup();
    const exactLink = {
      output_id: "clip-exact",
      recording_attempt_id: "attempt-exact",
    };
    await insert("exact-session", "signup", 1, {
      email: "alice@example.com",
    });
    await insert("exact-session", "recording_started", 2, {
      properties: exactLink,
    });
    await insert("exact-session", "recording_started", 3, {
      properties: exactLink,
    });
    await insert(null, "recording_ready", 4, {
      properties: {
        ...exactLink,
        output_type: "clip",
      },
    });

    const ambiguousLink = {
      output_id: "clip-ambiguous",
      recording_attempt_id: "attempt-ambiguous",
    };
    for (const sessionId of ["ambiguous-a", "ambiguous-b"]) {
      await insert(sessionId, "signup", 5, {
        email: `${sessionId}@example.com`,
      });
      await insert(sessionId, "recording_started", 6, {
        properties: ambiguousLink,
      });
    }
    await insert(null, "recording_ready", 7, {
      properties: {
        ...ambiguousLink,
        output_type: "clip",
      },
    });
    await insert(null, "recording_ready", 8, {
      properties: {
        output_id: "clip-unmatched",
        recording_attempt_id: "attempt-unmatched",
        output_type: "clip",
      },
    });
    await insert("wrong-attempt", "signup", 9, {
      email: "wrong@example.com",
    });
    await insert("wrong-attempt", "recording_started", 10, {
      properties: {
        output_id: "clip-same-output",
        recording_attempt_id: "attempt-one",
      },
    });
    await insert(null, "recording_ready", 11, {
      properties: {
        output_id: "clip-same-output",
        recording_attempt_id: "attempt-two",
        output_type: "clip",
      },
    });

    const rows = await run({ app: "clips" });
    const readyRows = rows.filter(
      (row) => row.event_name === "recording_ready",
    );

    expect(readyRows.map((row) => row.session_id)).toEqual(["exact-session"]);
    expect(readyRows[0]).toMatchObject({ attempt_id: "attempt-exact" });
    expect(readyRows[0]).not.toHaveProperty("output_id");
    expect(readyRows[0]).not.toHaveProperty("recording_attempt_id");
  });

  it("keeps session classification and output links inside their exact scope", async () => {
    await setup();
    await insert("mixed-session", "signup", 1, {
      email: "mixed@example.com",
      template: "clips",
    });
    await insert("mixed-session", "integration_setup_exposed", 2, {
      template: "design",
    });
    await insert("mixed-session", "onboarding_step_viewed", 3, {
      template: "clips",
      properties: { step_id: "role" },
    });

    const sharedLink = {
      output_id: "shared-output",
      recording_attempt_id: "shared-attempt",
    };
    await insert("clips-source", "signup", 1, {
      email: "clips@example.com",
      template: "clips",
    });
    await insert("clips-source", "recording_started", 2, {
      template: "clips",
      properties: sharedLink,
    });
    await insert("builder-source", "signup", 1, {
      email: "dev@builder.io",
      template: "clips",
    });
    await insert("builder-source", "recording_started", 2, {
      template: "clips",
      properties: sharedLink,
    });
    await insert("other-org-source", "signup", 1, {
      email: "other-org@example.com",
      template: "clips",
      orgId: "org-2",
    });
    await insert("other-org-source", "recording_started", 2, {
      template: "clips",
      properties: sharedLink,
      orgId: "org-2",
    });
    await insert(null, "recording_ready", 3, {
      template: "clips",
      properties: sharedLink,
    });

    await insert("slides-source", "signup", 1, {
      email: "slides@example.com",
      template: "slides",
    });
    await insert("slides-source", "generation_started", 2, {
      template: "slides",
      properties: {
        output_id: "shared-output",
        generation_attempt_id: "shared-attempt",
      },
    });
    await insert(null, "generation_completed", 3, {
      template: "slides",
      properties: {
        output_id: "shared-output",
        generation_attempt_id: "shared-attempt",
      },
    });

    await insert("null-attempt-source", "signup", 1, {
      email: "null-attempt@example.com",
      template: "clips",
    });
    await insert("null-attempt-source", "recording_started", 2, {
      template: "clips",
      properties: { output_id: "missing-attempt-output" },
    });
    await insert(null, "recording_ready", 3, {
      template: "clips",
      properties: { output_id: "missing-attempt-output" },
    });

    const rows = await run({ app: "all" });
    const mixedRows = rows.filter((row) => row.session_id === "mixed-session");
    expect(mixedRows.map((row) => row.journey_kind)).toEqual(
      Array(mixedRows.length).fill("onboarding"),
    );
    expect(mixedRows.some((row) => row.template_name === "design")).toBe(true);

    expect(
      rows.find((row) => row.event_name === "recording_ready"),
    ).toMatchObject({ session_id: "clips-source", journey_kind: "onboarding" });
    expect(
      rows.find((row) => row.event_name === "generation_completed"),
    ).toMatchObject({
      session_id: "slides-source",
      journey_kind: "onboarding",
    });
    expect(
      rows.some(
        (row) =>
          row.event_name === "recording_ready" &&
          row.session_id === "null-attempt-source",
      ),
    ).toBe(false);
  });

  it("links a sessionless Slide completion through its exact viewed output and attempt", async () => {
    await setup();
    await insert("slides-session", "signup", 1, {
      email: "slides@example.com",
      template: "slides",
    });
    await insert("slides-session", "output_viewed", 2, {
      template: "slides",
      properties: {
        output_id: "deck-1",
        output_type: "deck",
        generation_attempt_id: "attempt-1",
      },
    });
    await insert(null, "generation_completed", 3, {
      template: "slides",
      properties: {
        output_id: "deck-1",
        output_type: "deck",
        generation_attempt_id: "attempt-1",
      },
    });
    await insert(null, "generation_failed", 4, {
      template: "slides",
      properties: {
        output_id: "deck-2",
        output_type: "deck",
        generation_attempt_id: "attempt-2",
      },
    });
    await insert(null, "generation_outcome_unresolved", 5, {
      template: "slides",
      properties: {
        output_id: "deck-3",
        output_type: "deck",
        generation_attempt_id: "attempt-3",
      },
    });
    await insert("slides-session", "deck_edited", 6, {
      template: "slides",
      properties: { output_id: "deck-2", output_type: "deck" },
    });

    const rows = await run({ app: "slides" });

    expect(rows.map((row) => [row.event_name, row.session_id])).toEqual([
      ["signup", "slides-session"],
      ["generation_completed", "slides-session"],
    ]);
    expect(rows.some((row) => row.event_name === "output_viewed")).toBe(false);
    expect(rows.some((row) => row.event_name === "deck_edited")).toBe(false);
    expect(rows.some((row) => row.event_name === "generation_failed")).toBe(
      false,
    );
    expect(
      rows.some((row) => row.event_name === "generation_outcome_unresolved"),
    ).toBe(false);
    expect(rows[1]).toMatchObject({ attempt_id: "attempt-1" });
    expect(rows.some((row) => row.generation_attempt_id)).toBe(false);
    expect(rows.some((row) => row.output_id)).toBe(false);
  });

  it("links a new sessionless Slide completion from its accepted attempt", async () => {
    await setup();
    const attempt = {
      generation_attempt_id: "initial-attempt",
    };
    await insert("initial-deck", "signup", 1, {
      email: "initial@example.com",
      template: "Slides",
    });
    await insert("initial-deck", "generation_started", 2, {
      template: "Slides",
      properties: attempt,
    });
    await insert("initial-deck", "generation_request_accepted", 3, {
      template: "SLIDES",
      properties: { ...attempt, output_id: "new-deck" },
    });
    await insert(null, "generation_completed", 4, {
      template: "sLiDeS",
      properties: {
        ...attempt,
        output_id: "new-deck",
        output_type: "deck",
      },
    });

    const rows = await run({ app: "slides" });

    expect(rows.map((row) => [row.event_name, row.session_id])).toEqual([
      ["signup", "initial-deck"],
      ["generation_started", "initial-deck"],
      ["generation_request_accepted", "initial-deck"],
      ["generation_completed", "initial-deck"],
    ]);
    expect(rows.every((row) => row.template_name === "slides")).toBe(true);
    expect(rows.some((row) => row.output_id)).toBe(false);
    expect(rows.some((row) => row.generation_attempt_id)).toBe(false);
  });

  it("preserves sessionless Slides attempt outcomes by exact output and attempt", async () => {
    await setup();
    await insert("slides-retry", "signup", 1, {
      email: "retry@example.com",
      template: "slides",
    });
    const exactAttempts = [
      ["retry-deck", "failed-attempt"],
      ["retry-deck", "retry-attempt"],
      ["unresolved-deck", "unresolved-attempt"],
      ["accepted-deck", "accepted-attempt"],
      ["stuck-deck", "stuck-attempt"],
      ["cancelled-deck", "cancelled-attempt"],
      ["abandoned-deck", "abandoned-attempt"],
      ["complete-deck", "complete-attempt"],
      ["absent-deck", "absent-attempt"],
    ] as const;
    for (const [outputId, attemptId] of exactAttempts) {
      await insert("slides-retry", "generation_started", 2, {
        template: "slides",
        properties: {
          output_id: outputId,
          output_type: "deck",
          generation_attempt_id: attemptId,
        },
      });
    }

    const sessionlessEvents = [
      ["generation_failed", "retry-deck", "failed-attempt", {}],
      [
        "generation_outcome_unresolved",
        "unresolved-deck",
        "unresolved-attempt",
        { persisted_output: true },
      ],
      ["generation_request_accepted", "accepted-deck", "accepted-attempt", {}],
      ["generation_stuck", "stuck-deck", "stuck-attempt", {}],
      ["generation_cancelled", "cancelled-deck", "cancelled-attempt", {}],
      ["generation_abandoned", "abandoned-deck", "abandoned-attempt", {}],
      ["generation_completed", "retry-deck", "retry-attempt", {}],
      ["generation_completed", "complete-deck", "complete-attempt", {}],
      // A retry reuses the deck ID, so its exact attempt ID must also match.
      ["generation_completed", "retry-deck", "missing-attempt", {}],
    ] as const;
    for (const [eventName, outputId, attemptId, extra] of sessionlessEvents) {
      await insert(null, eventName, 3, {
        template: "slides",
        properties: {
          output_id: outputId,
          output_type: "deck",
          generation_attempt_id: attemptId,
          ...extra,
        },
      });
    }

    for (const sessionId of ["ambiguous-a", "ambiguous-b"]) {
      await insert(sessionId, "signup", 4, {
        email: `${sessionId}@example.com`,
        template: "slides",
      });
      await insert(sessionId, "generation_started", 5, {
        template: "slides",
        properties: {
          output_id: "ambiguous-deck",
          output_type: "deck",
          generation_attempt_id: "ambiguous-attempt",
        },
      });
    }
    await insert(null, "generation_completed", 6, {
      template: "slides",
      properties: {
        output_id: "ambiguous-deck",
        output_type: "deck",
        generation_attempt_id: "ambiguous-attempt",
      },
    });

    const rows = await run({ app: "slides" });
    const linked = rows
      .filter((row) => row.session_id === "slides-retry")
      .map((row) => row.event_name);

    expect(linked).toContain("generation_failed");
    expect(linked).toContain("generation_outcome_unresolved");
    expect(linked).toContain("generation_request_accepted");
    expect(linked).toContain("generation_stuck");
    expect(linked).toContain("generation_cancelled");
    expect(linked).toContain("generation_abandoned");
    expect(linked).toContain("generation_completed");
    expect(
      rows.filter((row) => row.event_name === "generation_completed"),
    ).toHaveLength(2);
    expect(
      rows.some(
        (row) =>
          row.session_id === "ambiguous-a" &&
          row.event_name === "generation_completed",
      ),
    ).toBe(false);
    expect(
      rows.some(
        (row) =>
          row.session_id === "ambiguous-b" &&
          row.event_name === "generation_completed",
      ),
    ).toBe(false);
    expect(rows.some((row) => row.output_id)).toBe(false);
    expect(rows.some((row) => row.generation_attempt_id)).toBe(false);
  });

  it("links a sessionless Design completion to its exact result pageview", async () => {
    await setup();
    const exactLink = {
      output_id: "design-output",
      generation_attempt_id: "V1StGXR8_Z5jdHi6B-myT",
    };
    await insert("design-session", "signup", 1, {
      email: "design@example.com",
      template: "design",
    });
    await insert("design-session", "pageview", 2, {
      template: "design",
      path: "/design/design-output",
      properties: {
        ...exactLink,
        sessionReplayId: "replay-fixture",
        sessionReplayStartedAt: "2026-10-09T12:00:00.000Z",
      },
    });
    await insert(null, "generation_completed", 3, {
      template: "design",
      properties: { ...exactLink, output_type: "design" },
    });
    await insert(null, "generation_completed", 4, {
      template: "design",
      properties: {
        ...exactLink,
        generation_attempt_id: "another-attempt-id",
        output_type: "design",
      },
    });

    const rows = await run({ app: "design" });
    const completed = rows.filter(
      (row) => row.event_name === "generation_completed",
    );

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      session_id: "design-session",
      journey_kind: "onboarding",
      template_name: "design",
      attempt_id: exactLink.generation_attempt_id,
    });
    expect(rows.find((row) => row.event_name === "pageview")).toMatchObject({
      attempt_id: exactLink.generation_attempt_id,
      session_replay_id: "replay-fixture",
      session_replay_started_at: "2026-10-09T12:00:00.000Z",
    });
    expect(rows.some((row) => row.output_id || row.properties)).toBe(false);
  });

  it("keeps ambiguous Design output attempts unattributed", async () => {
    await setup();
    const exactLink = {
      output_id: "shared-output",
      generation_attempt_id: "V1StGXR8_Z5jdHi6B-myT",
    };
    for (const sessionId of ["design-a", "design-b"]) {
      await insert(sessionId, "signup", 1, {
        email: `${sessionId}@example.com`,
        template: "design",
      });
      await insert(sessionId, "pageview", 2, {
        template: "design",
        path: "/design/shared-output",
        properties: exactLink,
      });
    }
    await insert(null, "generation_completed", 3, {
      template: "design",
      properties: { ...exactLink, output_type: "design" },
    });

    const rows = await run({ app: "design" });

    expect(rows.some((row) => row.event_name === "generation_completed")).toBe(
      false,
    );
  });

  it("keeps Design output completion in the standalone setup tree", async () => {
    await setup();
    const exactLink = {
      output_id: "standalone-output",
      generation_attempt_id: "V1StGXR8_Z5jdHi6B-myT",
    };
    await insert("standalone-design", "app_entered", 1, {
      template: "design",
    });
    await insert("standalone-design", "integration_setup_exposed", 2, {
      template: "design",
    });
    await insert("standalone-design", "pageview", 3, {
      template: "design",
      path: "/design/standalone-output",
      properties: exactLink,
    });
    await insert(null, "generation_completed", 4, {
      template: "design",
      properties: { ...exactLink, output_type: "design" },
    });

    const rows = await run({ app: "design" });
    const completed = rows.find(
      (row) => row.event_name === "generation_completed",
    );

    expect(completed).toMatchObject({
      session_id: "standalone-design",
      journey_kind: "standalone_setup",
      attempt_id: exactLink.generation_attempt_id,
    });
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

  it("preserves journey results with the explicit event source projection", async () => {
    await setup();
    await seedSessions();
    const sql = buildOnboardingJourneyEventsSql(
      filters(),
      { limit: 100, offset: 0 },
      observation(),
    );
    const fullScope = scopedAnalyticsSql(sql, SCOPE);
    const projectedScope = scopedAnalyticsSql(sql, SCOPE, undefined, {
      scopedEventsSingleScan: true,
      scopedEventsProjection: "onboarding_journey",
    });
    const fullResult = (await client.query(fullScope.sql, fullScope.args)) as {
      rows: Array<Record<string, unknown>>;
    };
    const projectedResult = (await client.query(
      projectedScope.sql,
      projectedScope.args,
    )) as { rows: Array<Record<string, unknown>> };

    expect(projectedResult.rows).toEqual(fullResult.rows);
  });

  it("selects attempt ids only as an internal journey field", async () => {
    await setup();
    await insert("slides", "signup", 1, {
      email: "person@example.com",
      template: "slides",
    });
    await insert("slides", "generation_started", 2, {
      template: "slides",
      properties: { generation_attempt_id: "private-generation-attempt" },
    });

    const rows = await run({ app: "slides" });
    const started = rows.find((row) => row.event_name === "generation_started");

    expect(started).toMatchObject({
      session_id: "slides",
      attempt_id: "private-generation-attempt",
    });
    expect(started).not.toHaveProperty("generation_attempt_id");
    expect(started).not.toHaveProperty("properties");
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
      "app",
      "attempt_id",
      "auth_user_id",
      "event_name",
      "flow",
      "id",
      "journey_kind",
      "method_id",
      "outcome",
      "path",
      "session_id",
      "session_replay_id",
      "session_replay_started_at",
      "source",
      "step_id",
      "step_index",
      "template_name",
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
