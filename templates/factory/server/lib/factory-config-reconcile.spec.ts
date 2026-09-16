import { describe, expect, it } from "vitest";

import {
  mergeFactoryConfigRows,
  planDefaultFactoryConfigReconciliation,
  planSlackChannelConflictClears,
  type FactoryConfigSqlRow,
} from "./factory-config-reconcile.js";

function row(
  overrides: Partial<FactoryConfigSqlRow> & Pick<FactoryConfigSqlRow, "id">,
): FactoryConfigSqlRow {
  return {
    org_id: "org-1",
    factory_id: "product-feedback",
    slack_workspace: "primary",
    slack_channel_id: null,
    slack_channel_name: null,
    builder_slack_user_id: null,
    polling_enabled: 0,
    last_slack_ts: null,
    slack_history_cursor: null,
    repository: null,
    github_polling_enabled: 0,
    sentry_polling_enabled: 0,
    sentry_org_slug: null,
    sentry_project_slug: null,
    sentry_environment: null,
    last_sentry_seen_at: null,
    automation_failure_alerts_enabled: 1,
    automation_failure_alert_email: null,
    last_automation_failure_alert_key: null,
    last_automation_failure_alert_at: null,
    owner_email: "owner@example.com",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("planDefaultFactoryConfigReconciliation", () => {
  it("merges leftover legacy settings into the scoped row before deleting", () => {
    const plans = planDefaultFactoryConfigReconciliation([
      row({
        id: "org-1:product-feedback",
        slack_channel_id: null,
        last_slack_ts: "100.1",
        polling_enabled: 0,
      }),
      row({
        id: "org-1",
        slack_channel_id: "C123",
        last_slack_ts: "200.2",
        polling_enabled: 1,
        slack_history_cursor: "cursor-1",
      }),
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.fromId).toBe("org-1:product-feedback");
    expect(plans[0]?.deleteIds).toEqual(["org-1"]);
    expect(plans[0]?.row).toMatchObject({
      id: "org-1:product-feedback",
      slack_channel_id: "C123",
      last_slack_ts: "200.2",
      polling_enabled: 1,
      slack_history_cursor: "cursor-1",
    });
  });

  it("rewrites a leftover unscoped id when no scoped row exists", () => {
    const plans = planDefaultFactoryConfigReconciliation([
      row({ id: "org-1", slack_channel_id: "C9" }),
    ]);

    expect(plans[0]).toMatchObject({
      fromId: "org-1",
      deleteIds: [],
      row: {
        id: "org-1:product-feedback",
        factory_id: "product-feedback",
        slack_channel_id: "C9",
      },
    });
  });
});

describe("mergeFactoryConfigRows", () => {
  it("keeps the later Slack cursor and turns polling on if either row is enabled", () => {
    const merged = mergeFactoryConfigRows(
      row({ id: "keep", last_slack_ts: "10.0", polling_enabled: 0 }),
      row({ id: "other", last_slack_ts: "9.0", polling_enabled: 1 }),
    );
    expect(merged.last_slack_ts).toBe("10.0");
    expect(merged.polling_enabled).toBe(1);
  });

  it("keeps checkpoints with the winning Slack channel", () => {
    const merged = mergeFactoryConfigRows(
      row({
        id: "keep",
        slack_channel_id: "C-A",
        last_slack_ts: "100.1",
        slack_history_cursor: "cursor-a",
      }),
      row({
        id: "other",
        slack_channel_id: "C-B",
        last_slack_ts: "999.9",
        slack_history_cursor: "cursor-b",
      }),
    );
    expect(merged.slack_channel_id).toBe("C-A");
    expect(merged.last_slack_ts).toBe("100.1");
    expect(merged.slack_history_cursor).toBe("cursor-a");
  });

  it("keeps the Slack workspace with the adopted channel", () => {
    const merged = mergeFactoryConfigRows(
      row({
        id: "keep",
        slack_workspace: "primary",
        slack_channel_id: null,
      }),
      row({
        id: "other",
        slack_workspace: "secondary",
        slack_channel_id: "C-SEC",
        last_slack_ts: "9.0",
        slack_history_cursor: "cursor-sec",
      }),
    );
    expect(merged.slack_workspace).toBe("secondary");
    expect(merged.slack_channel_id).toBe("C-SEC");
    expect(merged.last_slack_ts).toBe("9.0");
    expect(merged.slack_history_cursor).toBe("cursor-sec");
  });
});

describe("planSlackChannelConflictClears", () => {
  it("clears every extra factory sharing a Slack channel in the same org", () => {
    const clears = planSlackChannelConflictClears([
      row({
        id: "org-1:factory-a",
        factory_id: "factory-a",
        slack_channel_id: "C123",
        polling_enabled: 1,
        updated_at: "2026-08-21T00:00:00.000Z",
      }),
      row({
        id: "org-1:factory-b",
        factory_id: "factory-b",
        slack_channel_id: "C123",
        polling_enabled: 0,
        updated_at: "2026-08-22T00:00:00.000Z",
      }),
    ]);
    expect(clears).toEqual([{ id: "org-1:factory-b", org_id: "org-1" }]);
  });
});
