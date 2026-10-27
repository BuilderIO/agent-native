import { describe, expect, it } from "vitest";

import {
  buildCampaignFollowupSql,
  buildEventStatsSql,
  buildFirstTouchEventsCte,
  buildFunnelDailySql,
  buildTriageSql,
  buildUploadRejectionAttributionSql,
  buildUploadRejectionSql,
  identityExclusionSql,
  normalizedAppSql,
  referralSourceSql,
} from "./sql.ts";

describe("first-touch SQL helpers", () => {
  it("keeps the external identity and hostname exclusions together", () => {
    const sql = identityExclusionSql({
      emailExpression: "email",
      identityExpression: "person_key",
      hostnameExpression: "hostname",
    });
    for (const value of [
      "@builder.io",
      "@agent-native.com",
      "@mailosaur.net",
      "@yopmail",
      "@emalupe.com",
      "@westcast-systems.com",
      "svc-%@service.%",
      "dev@local.test",
      "'local' || '@localhost'",
      "@test.local",
      "@agent-native.test",
      "qa%@example.com",
      "+autoz",
      "__organization__:",
    ]) {
      expect(sql).toContain(value);
    }
    expect(sql).toContain("lower(coalesce(hostname, ''))");
    expect(sql).toContain("NOT LIKE 'beta.%'");
    expect(sql).toContain("NOT IN ('localhost', '127.0.0.1', '::1')");
  });

  it("folds beta templates and removes the invisible referral character", () => {
    const appSql = normalizedAppSql({
      templateExpression: "template",
      appExpression: "app",
    });
    const eventSql = buildFirstTouchEventsCte({
      startDate: "$1",
      endDate: "$2",
      orgId: "$3",
    });
    expect(appSql).toContain("WHEN lower(coalesce(");
    expect(appSql).toContain("THEN 'design'");
    expect(appSql).toContain("THEN 'slides'");
    expect(appSql).toContain("THEN 'clips'");
    expect(eventSql).toContain("e.event_date >= $1");
    expect(eventSql).toContain("e.event_date <= $2");
    expect(eventSql).toContain("e.org_id = $3");
    expect(eventSql).toContain("e.url");
    expect(eventSql).toContain("properties::jsonb ->> 'user_email'");
    expect(eventSql).toContain(
      "jsonb_typeof(e.properties::jsonb -> 'auth_user_id') IN ('string', 'number', 'boolean')",
    );
    expect(eventSql).not.toContain(
      "properties::jsonb ->> 'auth_user_id', '') LIKE",
    );
    expect(eventSql).toContain(
      referralSourceSql("e.properties::jsonb ->> 'referral_source'"),
    );
    expect(eventSql).toContain("lower(coalesce(e.hostname, ''))");
  });

  it("counts only non-null scalar connection source properties", () => {
    const sql = buildEventStatsSql();
    const scalarSource =
      "jsonb_typeof(properties -> 'llm_connection_source') IN ('string', 'number', 'boolean')";
    const scalarEnvVar =
      "jsonb_typeof(properties -> 'llm_connection_env_var') IN ('string', 'number', 'boolean')";
    const scalarEnvVarPresent = `${scalarEnvVar}\n        AND nullif(properties ->> 'llm_connection_env_var', '') IS NOT NULL`;

    expect(sql).toContain(`${scalarSource}\n        OR ${scalarEnvVar}`);
    expect(sql).toContain("date_trunc($4, happened_at, 'UTC') AS period_start");
    expect(sql.split(scalarSource).length - 1).toBe(2);
    expect(sql.split(scalarEnvVar).length - 1).toBe(4);
    expect(sql.split(scalarEnvVarPresent).length - 1).toBe(2);
    expect(sql).toContain("AS new_user_source_events");
    expect(sql).toContain("AS source_property_events");
    expect(sql).not.toContain("properties ? 'llm_connection_source'");
    expect(sql).not.toContain("properties ? 'llm_connection_env_var'");
  });

  it("guards PostgreSQL action weights from malformed JSON numbers", () => {
    const sql = buildEventStatsSql();

    expect(sql).toContain("length((properties ->> 'sample_weight')) <= 128");
    expect(sql).toContain("(properties ->> 'sample_weight') ~ '^[+-]?");
    expect(sql).toContain("(properties ->> 'duration_ms') ~ '^[+-]?");
    expect(sql).toContain("(properties ->> 'status_code') ~ '^[+-]?[0-9]+$'");
    expect(sql).toContain("BETWEEN -2147483648 AND 2147483647");
  });

  it("returns recipient campaign counts without selecting recipient identities", () => {
    const sql = buildCampaignFollowupSql();
    expect(sql).toContain("outage_recovery_20261026");
    expect(sql).toContain("e.properties ->> 'utm_campaign'");
    expect(sql).toContain("ELSE 'other'");
    expect(sql).toContain("'analytics', 'assets', 'brain'");
    expect(sql).toContain("e.happened_at >= r.sent_at - interval '7 days'");
    expect(sql).toContain("builder_connect_succeeded");
    expect(sql).toContain("'deck_created'");
    expect(sql).toContain("'design_ready_viewed'");
    expect(sql).toContain("'recording_ready'");
    expect(sql).toContain(
      "count(DISTINCT email)::int AS recipients_with_activity",
    );
    expect(sql.trimEnd()).not.toMatch(/^SELECT\s+email/im);
    expect(sql).toContain("e.event_date >= $2");
    expect(sql).toContain("e.org_id = $4");
  });

  it("splits Design web and MCP signups and measures Clips 24-hour activation", () => {
    const funnel = buildFunnelDailySql();
    expect(funnel).toContain("first_touch_path NOT LIKE '/mcp/oauth%'");
    expect(funnel).toContain(
      "THEN 'design_web' ELSE 'first_touch' END AS journey_type",
    );
    expect(funnel).toContain("'design_mcp' AS journey_type");
    expect(funnel).toContain("'$mcp_tool_call'");
    expect(funnel).toContain("'design_created'");
    expect(funnel).toContain("clips_activated_24h");
    expect(funnel).toContain("interval '24 hours'");
    expect(funnel).toContain(
      "HAVING event_date::date + 2 <= ($4::timestamptz AT TIME ZONE 'UTC')::date",
    );
    expect(funnel).not.toContain(
      "min(happened_at) + interval '24 hours' <= $4::timestamptz",
    );

    const entered = funnel.slice(
      funnel.indexOf("entered_stages AS ("),
      funnel.indexOf("prompt_stages AS ("),
    );
    expect(entered).toContain(
      "event_name IN ('app_entered', 'onboarding_app_entered')",
    );

    const mcp = funnel.slice(
      funnel.indexOf("design_mcp_connected AS ("),
      funnel.indexOf("design_mcp_daily AS ("),
    );
    expect(
      mcp.match(/e\.happened_at < c\.signup_at \+ interval '24 hours'/g),
    ).toHaveLength(3);
  });

  it("groups upload rejections by the emitted failure reason", () => {
    const upload = buildUploadRejectionSql();
    expect(upload).toContain("properties ->> 'failure_reason'");
    expect(upload).not.toContain("properties ->> 'reason'");
    expect(upload).toContain(
      "SELECT app, session_id FROM rejected_events WHERE session_id IS NOT NULL",
    );
    expect(upload).toContain(
      "count(*) FILTER (WHERE session_id IS NULL)::int AS unidentified_rejections",
    );
    const recorderCounts = buildUploadRejectionAttributionSql();
    expect(recorderCounts).toContain("session_recordings r");
    expect(recorderCounts).toContain("analytics_session_events i");
    expect(recorderCounts).toContain("jsonb_array_elements($4::jsonb)");
    expect(recorderCounts).toContain(
      "(group_data.value ->> 'event_date')::date AS event_date",
    );
    expect(recorderCounts).toContain(
      "GROUP BY event_date, app, reason, status",
    );
    expect(recorderCounts).toContain(
      "SELECT k.event_date, k.app, k.reason, k.status",
    );
    expect(recorderCounts).toContain(
      "jsonb_array_elements_text(g.session_ids)",
    );
    expect(recorderCounts).toContain("AS rejected_recorders");
    expect(recorderCounts).toContain("AS unidentified_rejections");
    expect(recorderCounts).toContain("AS recorders");
  });

  it("uses the session event, trouble, friction, and performance indexes without user content", () => {
    const sql = buildTriageSql();
    expect(sql).toContain("analytics_session_events");
    expect(sql).toContain("analytics_session_trouble");
    expect(sql).toContain("session_recording_friction");
    expect(sql).toContain("analytics_session_performance");
    expect(
      sql.match(/session_id IN \(SELECT session_id FROM signup_sessions\)/g),
    ).toHaveLength(3);
    expect(sql).toContain("prompted_no_output");
    expect(sql).toContain("recording_started_no_ready_clip");
    expect(sql).toContain("ELSE 'unreviewed_event' END");
    const output = sql.slice(sql.lastIndexOf("SELECT s.session_id"));
    expect(output).not.toContain("identity_email");
    expect(output).not.toContain("user_id");
    expect(output).not.toContain("url");
  });
});
