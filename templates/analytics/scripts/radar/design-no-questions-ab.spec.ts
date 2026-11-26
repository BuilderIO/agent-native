import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  resolveRadarOrganizationId: vi.fn(),
  resolveRadarFirstPartyBackend: vi.fn(),
  resolveRadarBigQueryEventsTable: vi.fn(),
  runBigQuery: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return { ...actual, ...queryMocks };
});

import {
  buildBigQueryDesignNoQuestionsAbSql,
  buildPostgresDesignNoQuestionsAbSql,
  formatDesignNoQuestionsReadout,
  runDesignNoQuestionsReadout,
  sampleNeededPerArmForTenPointLift,
} from "./design-no-questions-ab.ts";
import { isReadOnlySql } from "./query.ts";

async function createAnalyticsEventsTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE analytics_events (
      id text PRIMARY KEY,
      public_key_id text NOT NULL DEFAULT 'pk-test',
      event_name text NOT NULL,
      user_id text,
      anonymous_id text,
      user_key text,
      session_id text,
      timestamp text NOT NULL,
      event_date text,
      received_at text NOT NULL DEFAULT '2026-11-01T00:00:00Z',
      url text,
      path text,
      hostname text DEFAULT 'design.agent-native.com',
      referrer text,
      app text DEFAULT 'design',
      template text DEFAULT 'design',
      signed_in text DEFAULT 'true',
      properties text NOT NULL DEFAULT '{}',
      context text NOT NULL DEFAULT '{}',
      owner_email text NOT NULL DEFAULT 'owner@example.org',
      org_id text DEFAULT 'org-1'
    );
  `);
}

interface SeedEventInput {
  id: string;
  eventName: string;
  userKey: string;
  timestamp: string;
  properties: Record<string, unknown>;
  userEmail?: string;
  app?: string;
  template?: string;
  hostname?: string;
  orgId?: string;
}

async function seedEvent(db: PGlite, event: SeedEventInput): Promise<void> {
  const email = event.userEmail ?? `${event.userKey}@customer.example`;
  await db.query(
    `INSERT INTO analytics_events (
      id, event_name, user_id, user_key, timestamp, event_date,
      hostname, app, template, properties, org_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      event.id,
      event.eventName,
      email,
      event.userKey,
      event.timestamp,
      event.timestamp.slice(0, 10),
      event.hostname ?? "design.agent-native.com",
      event.app ?? "design",
      event.template ?? "design",
      JSON.stringify({ auth_user_id: event.userKey, ...event.properties }),
      event.orgId ?? "org-1",
    ],
  );
}

async function seedControlTwoTurnReadyAndExport(db: PGlite): Promise<void> {
  await seedEvent(db, {
    id: "c1-exp",
    eventName: "agent_experiment_exposed",
    userKey: "ctrl-1",
    timestamp: "2026-11-01T10:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      telemetry_origin: "server",
      turn_id: "c1-t1",
    },
  });
  await seedEvent(db, {
    id: "c1-gen1",
    eventName: "$ai_generation",
    userKey: "ctrl-1",
    timestamp: "2026-11-01T10:00:01Z",
    properties: {
      experiment_ids: "hosted_model,design_no_questions",
      experiment_variants: "sonnet,control",
      telemetry_origin: "server",
      turn_id: "c1-t1",
      tools: ["show-design-questions"],
    },
  });
  await seedEvent(db, {
    id: "c1-exp-t2",
    eventName: "agent_experiment_exposed",
    userKey: "ctrl-1",
    timestamp: "2026-11-01T10:02:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      telemetry_origin: "server",
      turn_id: "c1-t2",
    },
  });
  await seedEvent(db, {
    id: "c1-gen2",
    eventName: "$ai_generation",
    userKey: "ctrl-1",
    timestamp: "2026-11-01T10:02:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c1-t2",
      tools: ["generate-design"],
    },
  });
  await seedEvent(db, {
    id: "c1-ready",
    eventName: "design_ready_viewed",
    userKey: "ctrl-1",
    timestamp: "2026-11-01T10:04:01Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c1-t2",
      output_id: "design-ctrl-1",
      is_owner: true,
      screen_count: 3,
    },
  });
  await seedEvent(db, {
    id: "c1-gen2-same-turn-continuation",
    eventName: "$ai_generation",
    userKey: "ctrl-1",
    timestamp: "2026-11-01T10:04:10Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c1-t2",
    },
  });
  await seedEvent(db, {
    id: "c1-export",
    eventName: "design_exported",
    userKey: "ctrl-1",
    timestamp: "2026-11-01T10:06:00Z",
    properties: {
      telemetry_origin: "server",
      output_id: "design-ctrl-1",
      status: "completed",
      render_location: "server",
      caller: "frontend",
    },
  });
}

async function seedControlPostReadyFollowUpAndSecondExport(
  db: PGlite,
): Promise<void> {
  await seedEvent(db, {
    id: "c2-exp",
    eventName: "agent_experiment_exposed",
    userKey: "ctrl-2",
    timestamp: "2026-11-01T11:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      telemetry_origin: "server",
      turn_id: "c2-t1",
    },
  });
  await seedEvent(db, {
    id: "c2-gen1",
    eventName: "$ai_generation",
    userKey: "ctrl-2",
    timestamp: "2026-11-01T11:00:01Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c2-t1",
      tools: ["show-design-questions"],
    },
  });
  await seedEvent(db, {
    id: "c2-gen2",
    eventName: "$ai_generation",
    userKey: "ctrl-2",
    timestamp: "2026-11-01T11:01:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c2-t2",
    },
  });
  await seedEvent(db, {
    id: "c2-ready1",
    eventName: "design_ready_viewed",
    userKey: "ctrl-2",
    timestamp: "2026-11-01T11:02:01Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c2-t2",
      output_id: "design-ctrl-2a",
      is_owner: true,
      screen_count: 2,
    },
  });
  await seedEvent(db, {
    id: "c2-gen3",
    eventName: "$ai_generation",
    userKey: "ctrl-2",
    timestamp: "2026-11-01T11:15:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c2-t3",
    },
  });
  await seedEvent(db, {
    id: "c2-ready2",
    eventName: "design_ready_viewed",
    userKey: "ctrl-2",
    timestamp: "2026-11-01T11:16:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c2-t3",
      output_id: "design-ctrl-2b",
      is_owner: true,
      screen_count: 4,
    },
  });
  await seedEvent(db, {
    id: "c2-export2",
    eventName: "design_exported",
    userKey: "ctrl-2",
    timestamp: "2026-11-01T11:20:00Z",
    properties: {
      telemetry_origin: "server",
      output_id: "design-ctrl-2b",
      status: "completed",
      render_location: "server",
      caller: "frontend",
    },
  });
}

async function seedControlFailedAnswerTurn(db: PGlite): Promise<void> {
  await seedEvent(db, {
    id: "c3-exp",
    eventName: "agent_experiment_exposed",
    userKey: "ctrl-3",
    timestamp: "2026-11-01T12:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      telemetry_origin: "server",
      turn_id: "c3-t1",
    },
  });
  await seedEvent(db, {
    id: "c3-gen1",
    eventName: "$ai_generation",
    userKey: "ctrl-3",
    timestamp: "2026-11-01T12:00:01Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c3-t1",
    },
  });
  await seedEvent(db, {
    id: "c3-gen2",
    eventName: "$ai_generation",
    userKey: "ctrl-3",
    timestamp: "2026-11-01T12:02:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c3-t2",
    },
  });
  await seedEvent(db, {
    id: "c3-export-unready",
    eventName: "design_exported",
    userKey: "ctrl-3",
    timestamp: "2026-11-01T12:05:00Z",
    properties: {
      telemetry_origin: "server",
      output_id: "design-ctrl-3-unready",
      status: "completed",
      render_location: "server",
      caller: "frontend",
    },
  });
}

async function seedControlIneligibleAndCross24hEvents(
  db: PGlite,
): Promise<void> {
  await seedEvent(db, {
    id: "c4-ready-before-anchor",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T12:55:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c4-t0",
      output_id: "design-ctrl-4-old",
      is_owner: true,
      screen_count: 2,
    },
  });
  await seedEvent(db, {
    id: "c4-exp",
    eventName: "agent_experiment_exposed",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      telemetry_origin: "server",
      turn_id: "c4-t1",
    },
  });
  await seedEvent(db, {
    id: "c4-gen1",
    eventName: "$ai_generation",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:00:01Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c4-t1",
    },
  });
  await seedEvent(db, {
    id: "c4-ready-non-owner",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:02:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c4-t2",
      output_id: "design-ctrl-4-bad",
      is_owner: false,
      screen_count: 2,
    },
  });
  await seedEvent(db, {
    id: "c4-ready-zero-screens",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:03:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c4-t2",
      output_id: "design-ctrl-4-bad",
      is_owner: true,
      screen_count: 0,
    },
  });
  await seedEvent(db, {
    id: "c4-ready-non-numeric-screens",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:03:30Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c4-t2",
      output_id: "design-ctrl-4-bad",
      is_owner: true,
      screen_count: "two",
    },
  });
  await seedEvent(db, {
    id: "c4-ready-empty-output",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:04:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c4-t2",
      output_id: "",
      is_owner: true,
      screen_count: 2,
    },
  });
  await seedEvent(db, {
    id: "c4-ready-server-origin",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:05:00Z",
    properties: {
      telemetry_origin: "server",
      turn_id: "c4-t2",
      output_id: "design-ctrl-4-bad",
      is_owner: true,
      screen_count: 2,
    },
  });
  await seedEvent(db, {
    id: "c4-ready-wrong-app",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    app: "slides",
    template: "slides",
    timestamp: "2026-11-01T13:06:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c4-t2",
      output_id: "design-ctrl-4-bad",
      is_owner: true,
      screen_count: 2,
    },
  });
  await seedEvent(db, {
    id: "c4-export-ineligible",
    eventName: "design_exported",
    userKey: "ctrl-4",
    timestamp: "2026-11-01T13:10:00Z",
    properties: {
      telemetry_origin: "server",
      output_id: "design-ctrl-4-bad",
      status: "completed",
      render_location: "server",
      caller: "frontend",
    },
  });
  await seedEvent(db, {
    id: "c4-ready-after-24h",
    eventName: "design_ready_viewed",
    userKey: "ctrl-4",
    timestamp: "2026-11-02T13:01:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c4-t2",
      output_id: "design-ctrl-4-late",
      is_owner: true,
      screen_count: 3,
    },
  });
  await seedEvent(db, {
    id: "c4-gen-after-24h",
    eventName: "$ai_generation",
    userKey: "ctrl-4",
    timestamp: "2026-11-02T13:05:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c4-t3",
    },
  });
  await seedEvent(db, {
    id: "c4-export-after-24h",
    eventName: "design_exported",
    userKey: "ctrl-4",
    timestamp: "2026-11-02T13:06:00Z",
    properties: {
      telemetry_origin: "server",
      output_id: "design-ctrl-4-late",
      status: "completed",
      render_location: "server",
      caller: "frontend",
    },
  });
}

async function seedForeignInternalAndImmatureUsers(db: PGlite): Promise<void> {
  await seedEvent(db, {
    id: "foreign-ready",
    eventName: "design_ready_viewed",
    userKey: "foreign-user",
    timestamp: "2026-11-01T12:03:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c3-t1",
      output_id: "design-ctrl-3-unready",
      is_owner: true,
      screen_count: 3,
    },
  });
  await seedEvent(db, {
    id: "foreign-export",
    eventName: "design_exported",
    userKey: "foreign-user",
    timestamp: "2026-11-01T12:04:00Z",
    properties: {
      telemetry_origin: "server",
      output_id: "design-ctrl-3-unready",
      status: "completed",
      render_location: "server",
      caller: "frontend",
    },
  });
  await seedEvent(db, {
    id: "foreign-gen",
    eventName: "$ai_generation",
    userKey: "foreign-user",
    timestamp: "2026-11-01T12:05:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "foreign-t2",
    },
  });
  await seedEvent(db, {
    id: "internal-exp",
    eventName: "agent_experiment_exposed",
    userKey: "employee-1",
    userEmail: "qa@builder.io",
    timestamp: "2026-11-01T10:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      telemetry_origin: "server",
      turn_id: "emp-t1",
    },
  });
  await seedEvent(db, {
    id: "c5-immature-exp",
    eventName: "agent_experiment_exposed",
    userKey: "ctrl-immature",
    timestamp: "2026-11-09T18:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "control",
      telemetry_origin: "server",
      turn_id: "c5-t1",
    },
  });
  await seedEvent(db, {
    id: "c5-immature-gen",
    eventName: "$ai_generation",
    userKey: "ctrl-immature",
    timestamp: "2026-11-09T18:00:01Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "control",
      telemetry_origin: "server",
      turn_id: "c5-t1",
    },
  });
  await seedEvent(db, {
    id: "c5-immature-ready",
    eventName: "design_ready_viewed",
    userKey: "ctrl-immature",
    timestamp: "2026-11-09T18:02:00Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "c5-t2",
      output_id: "design-ctrl-5",
      is_owner: true,
      screen_count: 2,
    },
  });
}

async function seedTreatmentUsersAndSignupFailure(db: PGlite): Promise<void> {
  await seedEvent(db, {
    id: "t1-exp",
    eventName: "agent_experiment_exposed",
    userKey: "treat-1",
    timestamp: "2026-11-01T10:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "no_questions",
      telemetry_origin: "server",
      turn_id: "t1-t1",
    },
  });
  await seedEvent(db, {
    id: "t1-gen1",
    eventName: "$ai_generation",
    userKey: "treat-1",
    timestamp: "2026-11-01T10:00:01Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "no_questions",
      telemetry_origin: "server",
      turn_id: "t1-t1",
    },
  });
  await seedEvent(db, {
    id: "t1-ready",
    eventName: "design_ready_viewed",
    userKey: "treat-1",
    timestamp: "2026-11-01T10:02:01Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "t1-t1",
      output_id: "design-treat-1",
      is_owner: true,
      screen_count: 3,
    },
  });
  await seedEvent(db, {
    id: "t1-export",
    eventName: "design_exported",
    userKey: "treat-1",
    timestamp: "2026-11-01T10:04:00Z",
    properties: {
      telemetry_origin: "server",
      output_id: "design-treat-1",
      status: "completed",
      render_location: "server",
      caller: "frontend",
    },
  });
  await seedEvent(db, {
    id: "t1-return",
    eventName: "pageview",
    userKey: "treat-1",
    timestamp: "2026-11-03T10:00:00Z",
    properties: {},
  });
  await seedEvent(db, {
    id: "t2-exp",
    eventName: "agent_experiment_exposed",
    userKey: "treat-2",
    timestamp: "2026-11-01T11:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "no_questions",
      telemetry_origin: "server",
      turn_id: "t2-t1",
    },
  });
  await seedEvent(db, {
    id: "t2-gen1",
    eventName: "$ai_generation",
    userKey: "treat-2",
    timestamp: "2026-11-01T11:00:01Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "no_questions",
      telemetry_origin: "server",
      turn_id: "t2-t1",
    },
  });
  await seedEvent(db, {
    id: "t2-ready",
    eventName: "design_ready_viewed",
    userKey: "treat-2",
    timestamp: "2026-11-01T11:04:01Z",
    properties: {
      telemetry_origin: "client",
      turn_id: "t2-t1",
      output_id: "design-treat-2",
      is_owner: true,
      screen_count: 2,
    },
  });
  await seedEvent(db, {
    id: "t2-gen2-followup",
    eventName: "$ai_generation",
    userKey: "treat-2",
    timestamp: "2026-11-01T11:15:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "no_questions",
      telemetry_origin: "server",
      turn_id: "t2-t2",
    },
  });
  await seedEvent(db, {
    id: "t2-export-browser",
    eventName: "design_exported",
    userKey: "treat-2",
    timestamp: "2026-11-01T11:16:00Z",
    properties: {
      telemetry_origin: "client",
      output_id: "design-treat-2",
      status: "completed",
      render_location: "browser",
      caller: "frontend",
    },
  });
  await seedEvent(db, {
    id: "t3-exp",
    eventName: "agent_experiment_exposed",
    userKey: "treat-3",
    timestamp: "2026-11-01T12:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      experiment_variant: "no_questions",
      telemetry_origin: "server",
      turn_id: "t3-t1",
    },
  });
  await seedEvent(db, {
    id: "t3-gen1",
    eventName: "$ai_generation",
    userKey: "treat-3",
    timestamp: "2026-11-01T12:00:01Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "no_questions",
      telemetry_origin: "server",
      turn_id: "t3-t1",
    },
  });
  await seedEvent(db, {
    id: "t3-ready-link",
    eventName: "design_ready_viewed",
    userKey: "treat-3",
    timestamp: "2026-11-01T12:03:01Z",
    properties: {
      telemetry_origin: "client",
      output_id: "design-treat-3",
      is_owner: true,
      screen_count: 1,
      generation_attempt_id: "attempt_1234567890abcdef",
    },
  });
  await seedEvent(db, {
    id: "t3-gen2-followup",
    eventName: "$ai_generation",
    userKey: "treat-3",
    timestamp: "2026-11-01T12:10:00Z",
    properties: {
      experiment_ids: "design_no_questions",
      experiment_variants: "no_questions",
      telemetry_origin: "server",
      turn_id: "t3-t2",
    },
  });
  await seedEvent(db, {
    id: "assign-fail-1",
    eventName: "agent_experiment_assignment_failed",
    userKey: "failed-signup-user",
    timestamp: "2026-11-01T14:00:00Z",
    properties: {
      experiment_id: "design_no_questions",
      failure_stage: "signup",
      telemetry_origin: "server",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMocks.resolveRadarOrganizationId.mockResolvedValue("org-1");
  queryMocks.resolveRadarFirstPartyBackend.mockResolvedValue({
    sink: "postgres",
    table: null,
  });
  queryMocks.resolveRadarBigQueryEventsTable.mockResolvedValue(
    "`project.analytics.events_query_range`",
  );
  queryMocks.runPostgresQuery.mockResolvedValue({
    rows: [
      {
        variant: "control",
        exposed: 10,
        prompt_joined: 10,
        mature_24h: 8,
        ready_24h: 5,
        first_turn_ready_24h: 1,
        time_p50_ms: 120000,
        time_p90_ms: 240000,
        post_ready_follow_up_24h: 2,
        completed_export_24h: 3,
        mature_1to7d: 5,
        return_1to7d: 1,
        signup_assignment_failures: 2,
      },
      {
        variant: "no_questions",
        exposed: 11,
        prompt_joined: 11,
        mature_24h: 9,
        ready_24h: 6,
        first_turn_ready_24h: 6,
        time_p50_ms: 90000,
        time_p90_ms: 180000,
        post_ready_follow_up_24h: 2,
        completed_export_24h: 3,
        mature_1to7d: 4,
        return_1to7d: 2,
      },
    ],
  });
});

describe("Design no-questions readout query", () => {
  it.each([
    {
      backendName: "PostgreSQL",
      sql: buildPostgresDesignNoQuestionsAbSql(),
      serverOriginFilter: "properties ->> 'telemetry_origin' = 'server'",
      readyClientOriginFilter: "properties ->> 'telemetry_origin' = 'client'",
      readyScreenCountFilter: "THEN (e.properties ->> 'screen_count')::int > 0",
      exportOutputJoin: "e.properties ->> 'output_id' = r.output_id",
      exportServerOriginFilter:
        "e.properties ->> 'telemetry_origin' = 'server'",
      forbiddenBrowserRender: "e.properties ->> 'render_location' = 'browser'",
      cutoffPredicate: "AND happened_at <= $4::timestamptz",
    },
    {
      backendName: "BigQuery",
      sql: buildBigQueryDesignNoQuestionsAbSql(
        "`project.analytics.events_query_range`",
      ),
      serverOriginFilter:
        "json_value(properties, '$.telemetry_origin') = 'server'",
      readyClientOriginFilter:
        "json_value(e.properties, '$.telemetry_origin') = 'client'",
      readyScreenCountFilter:
        "safe_cast(json_value(e.properties, '$.screen_count') AS INT64) > 0",
      exportOutputJoin: "json_value(e.properties, '$.output_id') = r.output_id",
      exportServerOriginFilter:
        "json_value(e.properties, '$.telemetry_origin') = 'server'",
      forbiddenBrowserRender:
        "json_value(e.properties, '$.render_location') = 'browser'",
      cutoffPredicate: "AND happened_at <= @as_of",
    },
  ])(
    "keeps both backends read-only and aligned on user-level ready, post-ready follow-up, and exports ($backendName)",
    ({
      sql,
      serverOriginFilter,
      readyClientOriginFilter,
      readyScreenCountFilter,
      exportOutputJoin,
      exportServerOriginFilter,
      forbiddenBrowserRender,
      cutoffPredicate,
    }) => {
      expect(isReadOnlySql(sql)).toBe(true);
      expect(sql).toContain("agent_experiment_exposed");
      expect(sql).not.toContain("design_prompt_submitted");
      expect(sql).toContain("design_ready_viewed");
      expect(sql).toContain("design_exported");
      expect(sql).toContain("telemetry_origin");
      expect(sql).toContain("output_id");
      const exposureRows =
        /exposure_rows AS \(([\s\S]*?)\),\s*exposures AS/.exec(sql)?.[1];
      const assignmentFailures =
        /assignment_failures AS \(([\s\S]*?)\),\s*prompts AS/.exec(sql)?.[1];
      const readyEvents = /ready_events AS \(([\s\S]*?)\),\s*ready AS/.exec(
        sql,
      )?.[1];
      const postReadyFollowUps =
        /post_ready_follow_ups AS \(([\s\S]*?)\),\s*exports AS/.exec(sql)?.[1];
      const exportsCte = /exports AS \(([\s\S]*?)\),\s*returns AS/.exec(
        sql,
      )?.[1];
      expect(exposureRows).toContain("agent_experiment_exposed");
      expect(exposureRows).toContain(serverOriginFilter);
      expect(assignmentFailures).toContain(
        "agent_experiment_assignment_failed",
      );
      expect(assignmentFailures).toContain(serverOriginFilter);
      expect(readyEvents).toContain(readyClientOriginFilter);
      expect(readyEvents).toContain(readyScreenCountFilter);
      expect(readyEvents).not.toContain("= a.exposed_turn_id");
      expect(readyEvents).not.toContain("telemetry_origin' = 'server'");
      expect(postReadyFollowUps).toContain("JOIN ready r");
      expect(postReadyFollowUps).toContain("p.happened_at > r.ready_at");
      expect(postReadyFollowUps).toContain("a.exposed_turn_id IS NOT NULL");
      expect(postReadyFollowUps).toContain("p.turn_id <> a.exposed_turn_id");
      expect(postReadyFollowUps).toContain("r.ready_turn_id IS NOT NULL");
      expect(postReadyFollowUps).toContain("p.turn_id <> r.ready_turn_id");
      expect(exportsCte).toContain("JOIN ready_outputs r");
      expect(exportsCte).toContain(exportOutputJoin);
      expect(exportsCte).toContain(exportServerOriginFilter);
      expect(sql).not.toContain(forbiddenBrowserRender);
      expect(sql).toContain("event_name = '$ai_generation'");
      expect(sql).toContain("first_turn_ready_24h");
      expect(sql).toContain("post_ready_follow_up_24h");
      expect(sql).toContain("experiment_ids");
      expect(sql).toContain("experiment_variants");
      expect(sql).toContain("render_location");
      expect(sql).toContain("agent_experiment_assignment_failed");
      expect(sql).toContain("signup_assignment_failures");
      expect(sql).toContain("caller");
      expect(sql).toContain("no_questions");
      expect(sql).toContain("mature_1to7d");
      expect(sql).toContain("mature_24h");
      expect(sql).toContain(cutoffPredicate);
    },
  );

  it("bounds exposures by the requested dates and outcomes by the data cutoff", () => {
    const postgresSql = buildPostgresDesignNoQuestionsAbSql();
    const bigQuerySql = buildBigQueryDesignNoQuestionsAbSql(
      "`project.analytics.events_query_range`",
    );

    expect(postgresSql).toContain(
      "e.event_date <= to_char($4::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')",
    );
    expect(postgresSql).toContain("AND event_date BETWEEN $1 AND $2");
    expect(postgresSql).toContain("AND e.happened_at <= $4::timestamptz");
    expect(bigQuerySql).toMatch(
      /events_query_range`?\(@start_date, DATE\(@as_of\)\)/,
    );
    expect(bigQuerySql).toContain(
      "AND event_date BETWEEN @start_date AND @end_date",
    );
    expect(bigQuerySql).toContain("AND e.happened_at <= @as_of");
  });

  it("reports all requested metrics with mature denominators and sample size", async () => {
    const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const asOf = new Date(Date.now() - 60 * 1000).toISOString();
    expect(asOf.slice(0, 10)).not.toBe(startDate);
    const result = await runDesignNoQuestionsReadout({
      startDate,
      endDate: startDate,
      asOf,
    });

    expect(result.dataCutoff).toBe(asOf);
    expect(result.sampleNeededPerArm).toBe(358);
    expect(result.sampleNeededTotal).toBe(716);
    expect(result.arms[0]).toMatchObject({
      variant: "control",
      exposed: 10,
      mature24h: 8,
      ready24h: { users: 5, rate: 5 / 8 },
      firstTurnReady24h: { users: 1, denominator: 8, rate: 1 / 8 },
      postReadyFollowUp24h: { users: 2, denominator: 8, rate: 0.25 },
      completedExport24h: { users: 3, denominator: 8, rate: 3 / 8 },
      return1to7d: { users: 1, denominator: 5 },
    });
    expect(result.signupAssignmentFailures).toBe(2);
    const formatted = formatDesignNoQuestionsReadout(result);
    expect(formatted).toContain("358 per arm (716 total)");
    expect(formatted).toContain("Signup assignment failures with no arm: 2");
    expect(formatted).toContain("Post-ready follow-up prompt within 24h");
    expect(formatted).toContain(
      "First-turn ready diagnostic (exposed turn only, not primary): control 1/8 (12.5%), no_questions 6/9 (66.7%).",
    );
    expect(formatted).toContain(
      "Design-ready is client-observed at the user level across any turn within 24 hours",
    );
    expect(formatted).toContain(
      "Completed UI exports use server-origin frontend export events within 24 hours matching any qualifying ready output ID",
    );
    expect(queryMocks.runPostgresQuery).toHaveBeenCalledWith(
      buildPostgresDesignNoQuestionsAbSql(),
      [startDate, startDate, "org-1", asOf],
      { fresh: true, cache: false },
    );
  });

  it("executes the BigQuery backend when configured as the first-party sink", async () => {
    queryMocks.resolveRadarFirstPartyBackend.mockResolvedValue({
      sink: "bigquery",
      table: "project.analytics.events",
    });
    queryMocks.runBigQuery.mockResolvedValue({
      rows: [
        {
          variant: "control",
          exposed: 4,
          prompt_joined: 4,
          mature_24h: 4,
          ready_24h: 3,
          first_turn_ready_24h: 1,
          time_p50_ms: 150000,
          time_p90_ms: 300000,
          post_ready_follow_up_24h: 1,
          completed_export_24h: 2,
          mature_1to7d: 4,
          return_1to7d: 1,
          signup_assignment_failures: 1,
        },
        {
          variant: "no_questions",
          exposed: 4,
          prompt_joined: 4,
          mature_24h: 4,
          ready_24h: 3,
          first_turn_ready_24h: 3,
          time_p50_ms: 60000,
          time_p90_ms: 120000,
          post_ready_follow_up_24h: 1,
          completed_export_24h: 2,
          mature_1to7d: 4,
          return_1to7d: 1,
          signup_assignment_failures: 1,
        },
      ],
    });

    const result = await runDesignNoQuestionsReadout({
      startDate: "2026-10-27",
      endDate: "2026-10-28",
      asOf: "2026-11-10T00:00:00.000Z",
    });

    expect(queryMocks.runBigQuery).toHaveBeenCalledWith(
      buildBigQueryDesignNoQuestionsAbSql(
        "`project.analytics.events_query_range`",
      ),
      {
        params: [
          { name: "start_date", type: "DATE", value: "2026-10-27" },
          { name: "end_date", type: "DATE", value: "2026-10-28" },
          { name: "org_id", type: "STRING", value: "org-1" },
          {
            name: "as_of",
            type: "TIMESTAMP",
            value: "2026-11-10T00:00:00.000Z",
          },
        ],
        fresh: true,
        cache: false,
      },
    );
    expect(result.arms[0]).toMatchObject({
      variant: "control",
      ready24h: { users: 3, rate: 0.75 },
      firstTurnReady24h: { users: 1, denominator: 4, rate: 0.25 },
      postReadyFollowUp24h: { users: 1, denominator: 4, rate: 0.25 },
      completedExport24h: { users: 2, denominator: 4, rate: 0.5 },
    });
  });

  it("requires full query maturity windows when readout arguments are valid", async () => {
    expect(sampleNeededPerArmForTenPointLift()).toBe(358);
    await expect(
      runDesignNoQuestionsReadout({
        startDate: "2026-02-30",
        endDate: "2026-03-01",
      }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("Design no-questions PostgreSQL execution regression fixture", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("counts multi-turn control ready/exports fairly, excludes intake answers from follow-ups, and enforces exclusions", async () => {
    const instance = await PGlite.create("memory://");
    db = instance;
    await createAnalyticsEventsTable(instance);
    queryMocks.runPostgresQuery.mockImplementation(
      async (sql: string, params: readonly unknown[] = []) => {
        const result = await instance.query(sql, [...params]);
        return {
          rows: result.rows as Record<string, unknown>[],
          bytesProcessed: null,
          actualBytesProcessed: null,
          cacheHit: false,
        };
      },
    );

    await seedControlTwoTurnReadyAndExport(instance);
    await seedControlPostReadyFollowUpAndSecondExport(instance);
    await seedControlFailedAnswerTurn(instance);
    await seedControlIneligibleAndCross24hEvents(instance);
    await seedForeignInternalAndImmatureUsers(instance);
    await seedTreatmentUsersAndSignupFailure(instance);

    const result = await runDesignNoQuestionsReadout({
      startDate: "2026-11-01",
      endDate: "2026-11-09",
      asOf: "2026-11-10T00:00:00.000Z",
    });

    const control = result.arms.find((arm) => arm.variant === "control");
    const treatment = result.arms.find((arm) => arm.variant === "no_questions");
    expect(result.signupAssignmentFailures).toBe(1);

    expect(control).toMatchObject({
      variant: "control",
      exposed: 5,
      promptJoined: 5,
      mature24h: 4,
      ready24h: { users: 2, rate: 0.5 },
      firstTurnReady24h: { users: 0, denominator: 4, rate: 0 },
      timeToReady24hMs: {
        users: 2,
        p50: 180000,
        p90: 228000,
      },
      postReadyFollowUp24h: { users: 1, denominator: 4, rate: 0.25 },
      completedExport24h: { users: 2, denominator: 4, rate: 0.5 },
      mature1to7d: 4,
      return1to7d: { users: 0, denominator: 4, rate: 0 },
    });

    expect(treatment).toMatchObject({
      variant: "no_questions",
      exposed: 3,
      promptJoined: 3,
      mature24h: 3,
      ready24h: { users: 3, rate: 1 },
      firstTurnReady24h: { users: 2, denominator: 3, rate: 2 / 3 },
      timeToReady24hMs: {
        users: 3,
        p50: 180000,
        p90: 228000,
      },
      postReadyFollowUp24h: { users: 1, denominator: 3, rate: 1 / 3 },
      completedExport24h: { users: 1, denominator: 3, rate: 1 / 3 },
      mature1to7d: 3,
      return1to7d: { users: 1, denominator: 3, rate: 1 / 3 },
    });

    const markdown = formatDesignNoQuestionsReadout(result);
    expect(markdown).toContain("| control | 5 | 5 | 4 | 2/4 (50.0%) |");
    expect(markdown).toContain("| no_questions | 3 | 3 | 3 | 3/3 (100.0%) |");
    expect(markdown).toContain(
      "First-turn ready diagnostic (exposed turn only, not primary): control 0/4 (0.0%), no_questions 2/3 (66.7%).",
    );
  });
});
