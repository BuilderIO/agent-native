import { describe, expect, it } from "vitest";

import {
  buildCampaignFollowupSql,
  buildFirstTouchEventsCte,
  buildFunnelDailySql,
  buildTriageSql,
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
    expect(eventSql).not.toContain(
      "properties::jsonb ->> 'auth_user_id', '') LIKE",
    );
    expect(eventSql).toContain(
      referralSourceSql("e.properties::jsonb ->> 'referral_source'"),
    );
    expect(eventSql).toContain("lower(coalesce(e.hostname, ''))");
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
