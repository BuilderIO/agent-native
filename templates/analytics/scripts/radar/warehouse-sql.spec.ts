import { describe, expect, it } from "vitest";

import {
  bigQueryIdentityExclusionSql,
  bigQueryFirstTouchEventsCte,
  buildBigQueryEventStatsSql,
  buildBigQueryFunnelDailySql,
  buildBigQueryPromptOutputSloSql,
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
      "HAVING timestamp_add(min(happened_at), INTERVAL 24 HOUR) <= @cutoff",
    );
  });

  it("uses the BigQuery event sink and the emitted upload failure reason", () => {
    const upload = buildBigQueryUploadRejectionSql(range);
    expect(upload).toContain("session_replay_upload_rejected");
    expect(upload).toContain("$.failure_reason");
    expect(upload).not.toContain("$.reason");
    expect(upload).toContain(
      "countif(session_id IS NULL OR session_id = '') AS unidentified_rejections",
    );
    expect(upload).toContain("@start_date");
    expect(upload).toContain("@end_date");
    expect(upload).toContain("@org_id");
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
