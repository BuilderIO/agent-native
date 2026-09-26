import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { assertFirstPartyAnalyticsBigQuerySql } from "./first-party-analytics-backend.js";
import { validateFirstPartyAnalyticsSql } from "./first-party-analytics.js";
import { buildPanel } from "./first-party-metric-catalog.js";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

function interpolate(sql: string, values: Record<string, string>): string {
  return sql.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,
    (_match, key: string) => values[key] ?? "",
  );
}

const FILTERS = {
  timeRange: "",
  emailFilter: "exclude_builder",
  appFilter: "",
};
let nextRowId = 0;
let eventDay = "";

describe("onboarding funnel metrics", () => {
  let client: PGliteClient;

  afterEach(async () => {
    await client?.close();
  });

  async function createEventsTable() {
    client = await PGlite.create("memory://");
    eventDay = (
      (await client.query(
        "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today",
      )) as { rows: Array<{ today: string }> }
    ).rows[0]!.today;
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
        properties text NOT NULL DEFAULT '{}'
      )
    `);
  }

  async function insertEvent(
    eventName: string,
    authUserId: string,
    properties: Record<string, unknown>,
    options: {
      email?: string | null;
      anonymousId?: string;
      userKey?: string | null;
      authUserId?: string | null;
    } = {},
  ) {
    const canonicalAuthUserId =
      options.authUserId === undefined ? authUserId : options.authUserId;
    await client.query(
      `INSERT INTO analytics_events
        (id, event_name, user_id, anonymous_id, user_key, timestamp, event_date, app, template, hostname, properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'clips', 'clips', 'clips.agent-native.com', $8)`,
      [
        `event-${nextRowId++}`,
        eventName,
        Object.prototype.hasOwnProperty.call(options, "email")
          ? options.email
          : `${authUserId}@example.com`,
        options.anonymousId ?? `anon-${authUserId}`,
        options.userKey ?? null,
        `${eventDay}T12:00:00.000Z`,
        eventDay,
        JSON.stringify({
          ...properties,
          ...(canonicalAuthUserId ? { auth_user_id: canonicalAuthUserId } : {}),
        }),
      ],
    );
  }

  it("counts reached, completed, skipped, and unresolved users separately", async () => {
    await createEventsTable();
    const step = {
      flow: "first_run",
      step_id: "choice",
      step_index: 1,
    };
    for (const user of ["u1", "u2", "u3", "u4", "u5+autoz"]) {
      await insertEvent("onboarding_step_viewed", user, step);
    }
    await insertEvent("onboarding_step_completed", "u1", step);
    await insertEvent("onboarding_step_skipped", "u2", step);
    await insertEvent("onboarding_step_completed", "u4", step);
    await insertEvent("onboarding_step_skipped", "u4", step);

    const panel = buildPanel("onboarding-step-dropoff")!;
    expect(() => validateFirstPartyAnalyticsSql(panel.sql)).not.toThrow();
    expect(() => assertFirstPartyAnalyticsBigQuerySql(panel.sql)).not.toThrow();
    const result = (await client.query(interpolate(panel.sql, FILTERS))) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        flow: "first_run",
        step_id: "choice",
        users_reached: 4,
        users_completed: 2,
        users_skipped: 2,
        users_no_recorded_outcome: 1,
      }),
    );
  }, 20_000);

  it("joins choice, Builder outcomes, and unresolved attempts by canonical identity and attempt id", async () => {
    await createEventsTable();
    const step = { flow: "first_run", step_id: "choice", step_index: 1 };
    for (const user of ["u1", "u2", "u3", "u4", "u6", "u5+autoz", "internal"]) {
      await insertEvent("onboarding_step_viewed", user, step, {
        email:
          user === "u1"
            ? null
            : user === "internal"
              ? "test@builder.io"
              : `${user}@example.com`,
        anonymousId: `view-${user}`,
      });
    }
    const attempts = [
      {
        user: "u1",
        method: "builder_create_account",
        id: "a1",
        outcome: "connected",
      },
      {
        user: "u2",
        method: "builder_create_account",
        id: "a2",
        outcome: "failed",
      },
      {
        user: "u3",
        method: "custom_keys",
        id: "a3",
        outcome: "settings_opened",
      },
      {
        user: "u3",
        method: "custom_keys",
        id: "a7",
        outcome: "handoff_failed",
      },
      { user: "u6", method: "builder_sign_in", id: "a4" },
      {
        user: "u5+autoz",
        method: "builder_create_account",
        id: "a5",
        outcome: "connected",
      },
    ];
    for (const attempt of attempts) {
      const properties = {
        ...step,
        method_id: attempt.method,
        method_kind: attempt.method === "custom_keys" ? "manual" : "builder",
        onboarding_attempt_id: attempt.id,
      };
      const email = `${attempt.user}@example.com`;
      await insertEvent("onboarding_method_clicked", attempt.user, properties, {
        email,
        anonymousId: `click-${attempt.user}`,
      });
      await insertEvent("onboarding_method_started", attempt.user, properties, {
        email,
        anonymousId: `start-${attempt.user}`,
      });
      if (attempt.outcome) {
        await insertEvent(
          "onboarding_method_outcome",
          attempt.user,
          { ...properties, outcome: attempt.outcome },
          { email, anonymousId: `outcome-${attempt.user}` },
        );
      }
    }
    await insertEvent("onboarding_method_clicked", "unseen", {
      ...step,
      method_id: "builder_create_account",
      onboarding_attempt_id: "a8",
    });

    const panel = buildPanel("onboarding-setup-choice")!;
    expect(() => validateFirstPartyAnalyticsSql(panel.sql)).not.toThrow();
    expect(() => assertFirstPartyAnalyticsBigQuerySql(panel.sql)).not.toThrow();
    const result = (await client.query(interpolate(panel.sql, FILTERS))) as {
      rows: Array<Record<string, unknown>>;
    };
    const createAccount = result.rows.find(
      (row) => row.method_id === "builder_create_account",
    );
    expect(createAccount).toMatchObject({
      choice_screen_viewers: 5,
      first_choice_users: 2,
      first_choice_rate: 0.4,
      connection_success_users: 1,
      connection_failure_users: 1,
      connection_success_attempts: 1,
      connection_failure_attempts: 1,
      handoff_failure_attempts: 0,
    });
    expect(
      result.rows.find((row) => row.method_id === "builder_sign_in"),
    ).toMatchObject({
      first_choice_users: 1,
      connection_no_outcome_attempts: 1,
    });
    expect(
      result.rows.find((row) => row.method_id === "custom_keys"),
    ).toMatchObject({
      first_choice_users: 1,
      settings_handoff_attempts: 1,
      handoff_failure_attempts: 1,
    });
  }, 20_000);

  it("keeps onboarding identity stable across the auth-user-id rollout", async () => {
    await createEventsTable();
    const step = { flow: "first_run", step_id: "choice", step_index: 1 };
    await insertEvent("onboarding_step_viewed", "legacy", step, {
      email: "alice@example.com",
      userKey: "alice@example.com",
      authUserId: null,
      anonymousId: "legacy-visitor",
    });
    await insertEvent(
      "onboarding_method_clicked",
      "current",
      {
        ...step,
        method_id: "builder_create_account",
        method_kind: "builder",
        onboarding_attempt_id: "attempt-1",
      },
      {
        email: "alice@example.com",
        userKey: "alice@example.com",
        authUserId: "better-auth-alice",
        anonymousId: "identified-visitor",
      },
    );

    const panel = buildPanel("onboarding-setup-choice")!;
    const result = (await client.query(interpolate(panel.sql, FILTERS))) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(
      result.rows.find((row) => row.method_id === "builder_create_account"),
    ).toMatchObject({
      choice_screen_viewers: 1,
      first_choice_users: 1,
      first_choice_rate: 1,
    });
  }, 20_000);

  it("uses the canonical auth ID when a user's email changes", async () => {
    await createEventsTable();
    const step = { flow: "first_run", step_id: "choice", step_index: 1 };
    await insertEvent("onboarding_step_viewed", "alice", step, {
      email: "alice-old@example.com",
      userKey: "alice-old@example.com",
      authUserId: "better-auth-alice",
    });
    await insertEvent(
      "onboarding_method_clicked",
      "alice",
      {
        ...step,
        method_id: "builder_create_account",
        method_kind: "builder",
        onboarding_attempt_id: "attempt-1",
      },
      {
        email: "alice-new@example.com",
        userKey: "alice-new@example.com",
        authUserId: "better-auth-alice",
      },
    );

    const panel = buildPanel("onboarding-setup-choice")!;
    const result = (await client.query(interpolate(panel.sql, FILTERS))) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(
      result.rows.find((row) => row.method_id === "builder_create_account"),
    ).toMatchObject({
      choice_screen_viewers: 1,
      first_choice_users: 1,
      first_choice_rate: 1,
    });
  }, 20_000);

  it("filters email-valued user keys but not opaque identity keys", async () => {
    await createEventsTable();
    const step = { flow: "first_run", step_id: "choice", step_index: 1 };
    for (const user of [
      {
        key: "employee@builder.io",
        authId: "employee-auth-id",
        method: "builder_create_account",
      },
      {
        key: "seed+autoz@example.com",
        authId: "seed-auth-id",
        method: "builder_create_account",
      },
      {
        key: "opaque-user-key-123",
        authId: "opaque-auth-id",
        method: "builder_sign_in",
      },
    ]) {
      const options = {
        email: null,
        userKey: user.key,
        authUserId: user.authId,
      };
      await insertEvent("onboarding_step_viewed", user.authId, step, options);
      await insertEvent(
        "onboarding_method_clicked",
        user.authId,
        {
          ...step,
          method_id: user.method,
          method_kind: "builder",
          onboarding_attempt_id: `${user.authId}-attempt`,
        },
        options,
      );
    }

    const panel = buildPanel("onboarding-setup-choice")!;
    const result = (await client.query(interpolate(panel.sql, FILTERS))) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(
      result.rows.find((row) => row.method_id === "builder_sign_in"),
    ).toMatchObject({
      method_id: "builder_sign_in",
      choice_screen_viewers: 1,
      first_choice_users: 1,
      first_choice_rate: 1,
    });
    expect(
      result.rows.find((row) => row.method_id === "builder_create_account"),
    ).toMatchObject({
      selected_users: 0,
      first_choice_users: 0,
    });
  }, 20_000);
});
