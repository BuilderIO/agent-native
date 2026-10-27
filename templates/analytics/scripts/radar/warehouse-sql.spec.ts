import { describe, expect, it } from "vitest";

import {
  bigQueryIdentityExclusionSql,
  bigQueryFirstTouchEventsCte,
  buildBigQueryEventStatsSql,
  buildBigQueryCampaignFollowupSql,
  buildBigQueryFunnelDailySql,
  buildBigQueryPromptOutputSloSql,
  buildBigQueryPromptOutputSloByDateSql,
  buildBigQueryTriageEventsSql,
  buildBigQueryUploadRejectionSql,
} from "./warehouse-sql.ts";

const range = "`project_id.analytics.events_raw_query_range`";

describe("first-party BigQuery radar SQL", () => {
  it("applies the shared internal identity and hostname exclusions", () => {
    const sql = bigQueryIdentityExclusionSql({
      emailExpression: "email",
      identityExpression: "person_key",
      hostnameExpression: "hostname",
    });
    for (const value of [
      "builder\\.io",
      "agent-native\\.com",
      "mailosaur\\.net",
      "yopmail",
      "emalupe\\.com",
      "westcast-systems\\.com",
      "svc-[^@]*@service",
      "dev@local.test",
      "'local' || '@localhost'",
      "@test.local",
      "@agent-native.test",
      "qa.*@example",
      "+autoz",
      "__organization__:",
    ]) {
      expect(sql).toContain(value);
    }
    expect(sql).toContain(
      "starts_with(lower(coalesce(hostname, '')), 'beta.')",
    );
    expect(sql).toContain(
      "lower(coalesce(hostname, '')) NOT IN ('localhost', '127.0.0.1', '::1')",
    );
  });

  it("matches campaign recipients by hash and aggregates only event counts", () => {
    const sql = buildBigQueryCampaignFollowupSql(range);
    expect(sql).toContain(
      "FROM `project_id.analytics.events_raw_query_range`(@start_date, @end_date)",
    );
    expect(sql).toContain("e.event_date >= @start_date");
    expect(sql).toContain("e.event_date <= @end_date");
    expect(sql).toContain(
      "lower(to_hex(sha256(cast(lower(trim(e.identity_email)) AS bytes)))) = r.email_hash",
    );
    expect(sql).toContain("JSON_QUERY_ARRAY(@recipients_json)");
    expect(sql).toContain("'prior_7_days'");
    expect(sql).toContain("outage_recovery_20261026");
    expect(sql).toContain("'deck_created'");
    expect(sql).toContain("'design_ready_viewed'");
    expect(sql).toContain("'recording_ready'");
    expect(sql).not.toContain("identity_email, email_hash");
  });

  it("bounds first-party reads to the partitioned table function and org", () => {
    const sql = bigQueryFirstTouchEventsCte(range);
    expect(sql).toContain(
      "FROM `project_id.analytics.events_raw_query_range`(@start_date, @end_date)",
    );
    expect(sql).toContain("e.event_date >= @start_date");
    expect(sql).toContain("e.event_date <= @end_date");
    expect(sql).toContain("e.org_id = @org_id");
    expect(sql).toContain("e.url");
    expect(sql).toContain("$.user_email");
    expect(sql).toContain("$.traits.email");
    expect(sql).not.toContain(
      "strpos(coalesce(json_value(e.properties, '$.auth_user_id'), ''), '@')",
    );
    expect(sql).toContain(`'${String.fromCharCode(0x200b)}'`);
  });

  it("aggregates event checks, funnel stages, and weekly SLOs in SQL", () => {
    const events = buildBigQueryEventStatsSql(range, "HOUR");
    const funnel = buildBigQueryFunnelDailySql(range);
    const slo = buildBigQueryPromptOutputSloSql(range);
    expect(events).toContain("timestamp_trunc(happened_at, HOUR, 'UTC')");
    expect(events).toContain("new_user_env_events");
    expect(events).toContain("chat_setup_exposures");
    expect(events).toContain("action_success_weight");
    expect(funnel).toContain("AS completed_at");
    expect(funnel).toContain("design_ready_viewed");
    expect(funnel).toContain("prompt_output_p90_seconds");
    expect(slo).toContain("percentile_cont(seconds, 0.9)");
  });

  it("can narrow historical event checks to their needed event names", () => {
    const sql = buildBigQueryEventStatsSql(range, "HOUR", [
      "signup",
      "generation_started",
    ]);
    expect(sql).toContain("e.event_name IN ('signup', 'generation_started')");
  });

  it("splits Design web and MCP signups and measures Clips 24-hour activation", () => {
    const funnel = buildBigQueryFunnelDailySql(range);
    expect(funnel).toContain("first_touch_path NOT LIKE '/mcp/oauth%'");
    expect(funnel).toContain("'design_web'");
    expect(funnel).toContain("'design_mcp'");
    expect(funnel).toContain("'$mcp_tool_call'");
    expect(funnel).toContain("'design_created'");
    expect(funnel).toContain("clips_activated_24h");
    expect(funnel).toContain("INTERVAL 24 HOUR");
    expect(funnel).toContain(
      "HAVING DATE_ADD(event_date, INTERVAL 2 DAY) <= DATE(@cutoff, 'UTC')",
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
      mcp.match(
        /e\.happened_at < timestamp_add\(c\.signup_at, INTERVAL 24 HOUR\)/g,
      ),
    ).toHaveLength(3);
  });

  it("uses the BigQuery event sink and the emitted upload failure reason", () => {
    const upload = buildBigQueryUploadRejectionSql(range);
    expect(upload).toContain("session_replay_upload_rejected");
    expect(upload).toContain("$.failure_reason");
    expect(upload).not.toContain("$.reason");
    expect(upload).toContain(
      "countif(session_id IS NULL OR session_id = '') AS unidentified_rejections",
    );
    expect(upload).toContain("AS rejected_session_ids");
    expect(upload).toContain(
      "SELECT event_date, app, reason, status, rejected_recorders, unidentified_rejections",
    );
    expect(upload).toContain("GROUP BY event_date, app, reason, status");
    expect(upload).toContain("@start_date");
    expect(upload).toContain("@end_date");
    expect(upload).toContain("@org_id");
  });

  it("batches daily prompt/output SLOs across a bounded partition range", () => {
    const slo = buildBigQueryPromptOutputSloByDateSql(range);
    expect(slo).toContain("@source_start_date");
    expect(slo).toContain("@source_end_date");
    expect(slo).toContain("@target_start_date");
    expect(slo).toContain("@target_end_date");
    expect(slo).toContain("DATE_SUB(d.target_date, INTERVAL 6 DAY)");
    expect(slo).toContain("DATE(o.happened_at, 'UTC') <= p.target_date");
  });

  it("bounds selected BigQuery triage sessions and excludes their identity fields", () => {
    const triage = buildBigQueryTriageEventsSql(range);
    expect(triage).toContain("@window_start");
    expect(triage).toContain("LIMIT 500");
    expect(triage).toContain("LIMIT 18");
    expect(triage).toContain("ELSE 'unreviewed_event' END");
    const triageOutput = triage.slice(
      triage.lastIndexOf("SELECT session_id, app, signup_at"),
    );
    expect(triageOutput).not.toContain("identity_email");
    expect(triageOutput).not.toContain("email");
    expect(triageOutput).not.toContain("url");
  });
});
