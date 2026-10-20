import { DEFAULT_FACTORY_ID } from "../factory-graph/store.js";
import { factoryConfigRowId } from "./factory-scope.js";

export type FactoryConfigSqlRow = {
  id: string;
  org_id: string | null;
  factory_id: string | null;
  slack_workspace: string | null;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
  builder_slack_user_id: string | null;
  polling_enabled: number | null;
  last_slack_ts: string | null;
  slack_history_cursor: string | null;
  repository: string | null;
  github_polling_enabled: number | null;
  sentry_polling_enabled: number | null;
  sentry_org_slug: string | null;
  sentry_project_slug: string | null;
  sentry_environment: string | null;
  last_sentry_seen_at: string | null;
  automation_failure_alerts_enabled: number | null;
  automation_failure_alert_email: string | null;
  last_automation_failure_alert_key: string | null;
  last_automation_failure_alert_at: string | null;
  owner_email: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type FactoryConfigReconcilePlan = {
  fromId: string;
  row: FactoryConfigSqlRow;
  deleteIds: string[];
};

function rowText(row: Record<string, unknown>, key: string): string | null {
  return asText(row[key]);
}

function rowFlag(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  return Number(value) === 1 ? 1 : 0;
}

export function factoryConfigSqlRowFromQuery(
  row: Record<string, unknown>,
): FactoryConfigSqlRow | null {
  const id = rowText(row, "id");
  if (!id) return null;
  return {
    id,
    org_id: rowText(row, "org_id"),
    factory_id: rowText(row, "factory_id"),
    slack_workspace: rowText(row, "slack_workspace"),
    slack_channel_id: rowText(row, "slack_channel_id"),
    slack_channel_name: rowText(row, "slack_channel_name"),
    builder_slack_user_id: rowText(row, "builder_slack_user_id"),
    polling_enabled: rowFlag(row, "polling_enabled"),
    last_slack_ts: rowText(row, "last_slack_ts"),
    slack_history_cursor: rowText(row, "slack_history_cursor"),
    repository: rowText(row, "repository"),
    github_polling_enabled: rowFlag(row, "github_polling_enabled"),
    sentry_polling_enabled: rowFlag(row, "sentry_polling_enabled"),
    sentry_org_slug: rowText(row, "sentry_org_slug"),
    sentry_project_slug: rowText(row, "sentry_project_slug"),
    sentry_environment: rowText(row, "sentry_environment"),
    last_sentry_seen_at: rowText(row, "last_sentry_seen_at"),
    automation_failure_alerts_enabled: rowFlag(
      row,
      "automation_failure_alerts_enabled",
    ),
    automation_failure_alert_email: rowText(
      row,
      "automation_failure_alert_email",
    ),
    last_automation_failure_alert_key: rowText(
      row,
      "last_automation_failure_alert_key",
    ),
    last_automation_failure_alert_at: rowText(
      row,
      "last_automation_failure_alert_at",
    ),
    owner_email: rowText(row, "owner_email"),
    created_at: rowText(row, "created_at"),
    updated_at: rowText(row, "updated_at"),
  };
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asFlag(value: unknown): number {
  return Number(value) === 1 ? 1 : 0;
}

function pickText(
  keep: string | null | undefined,
  other: string | null | undefined,
): string | null {
  return asText(keep) ?? asText(other);
}

function pickLater(
  keep: string | null | undefined,
  other: string | null | undefined,
): string | null {
  const left = asText(keep);
  const right = asText(other);
  if (!left) return right;
  if (!right) return left;
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return leftNum >= rightNum ? left : right;
  }
  return left >= right ? left : right;
}

export function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed|duplicate key|primary key/i.test(message);
}

export function mergeFactoryConfigRows(
  keep: FactoryConfigSqlRow,
  other: FactoryConfigSqlRow,
): FactoryConfigSqlRow {
  const slackIdentity = mergeSlackIdentity(keep, other);
  return {
    ...keep,
    slack_workspace: slackIdentity.slack_workspace,
    slack_channel_id: slackIdentity.slack_channel_id,
    slack_channel_name: slackIdentity.slack_channel_name,
    builder_slack_user_id: pickText(
      keep.builder_slack_user_id,
      other.builder_slack_user_id,
    ),
    polling_enabled: Math.max(
      asFlag(keep.polling_enabled),
      asFlag(other.polling_enabled),
    ),
    last_slack_ts: slackIdentity.last_slack_ts,
    slack_history_cursor: slackIdentity.slack_history_cursor,
    repository: pickText(keep.repository, other.repository),
    github_polling_enabled: Math.max(
      asFlag(keep.github_polling_enabled),
      asFlag(other.github_polling_enabled),
    ),
    sentry_polling_enabled: Math.max(
      asFlag(keep.sentry_polling_enabled),
      asFlag(other.sentry_polling_enabled),
    ),
    sentry_org_slug: pickText(keep.sentry_org_slug, other.sentry_org_slug),
    sentry_project_slug: pickText(
      keep.sentry_project_slug,
      other.sentry_project_slug,
    ),
    sentry_environment: pickText(
      keep.sentry_environment,
      other.sentry_environment,
    ),
    last_sentry_seen_at: pickLater(
      keep.last_sentry_seen_at,
      other.last_sentry_seen_at,
    ),
    automation_failure_alerts_enabled: Math.max(
      asFlag(keep.automation_failure_alerts_enabled),
      asFlag(other.automation_failure_alerts_enabled),
    ),
    automation_failure_alert_email: pickText(
      keep.automation_failure_alert_email,
      other.automation_failure_alert_email,
    ),
    last_automation_failure_alert_key: pickText(
      keep.last_automation_failure_alert_key,
      other.last_automation_failure_alert_key,
    ),
    last_automation_failure_alert_at: pickLater(
      keep.last_automation_failure_alert_at,
      other.last_automation_failure_alert_at,
    ),
    owner_email: pickText(keep.owner_email, other.owner_email),
    created_at: pickText(keep.created_at, other.created_at) ?? keep.created_at,
    updated_at: pickLater(keep.updated_at, other.updated_at),
    org_id: keep.org_id || other.org_id,
  };
}

export function planDefaultFactoryConfigReconciliation(
  rows: FactoryConfigSqlRow[],
  defaultFactoryId = DEFAULT_FACTORY_ID,
): FactoryConfigReconcilePlan[] {
  const byOrg = new Map<string, FactoryConfigSqlRow[]>();
  for (const row of rows) {
    const orgId = asText(row.org_id);
    const id = asText(row.id);
    if (!orgId || !id) continue;
    const group = byOrg.get(orgId) ?? [];
    group.push({ ...row, id, org_id: orgId });
    byOrg.set(orgId, group);
  }

  const plans: FactoryConfigReconcilePlan[] = [];
  for (const [orgId, group] of byOrg) {
    const canonicalId = factoryConfigRowId(orgId, defaultFactoryId);
    const keepSource = group.find((row) => row.id === canonicalId) ?? group[0]!;
    let merged: FactoryConfigSqlRow = {
      ...keepSource,
      id: canonicalId,
      org_id: orgId,
      factory_id: defaultFactoryId,
    };
    const deleteIds: string[] = [];
    for (const row of group) {
      if (row.id === keepSource.id) continue;
      merged = mergeFactoryConfigRows(merged, row);
      deleteIds.push(row.id);
    }
    plans.push({
      fromId: keepSource.id,
      row: merged,
      deleteIds,
    });
  }
  return plans;
}

export type SlackChannelConflictClear = {
  id: string;
  org_id: string;
};

function mergeSlackIdentity(
  keep: FactoryConfigSqlRow,
  other: FactoryConfigSqlRow,
): Pick<
  FactoryConfigSqlRow,
  | "slack_workspace"
  | "slack_channel_id"
  | "slack_channel_name"
  | "last_slack_ts"
  | "slack_history_cursor"
> {
  const keepChannel = asText(keep.slack_channel_id);
  const otherChannel = asText(other.slack_channel_id);
  if (!otherChannel || keepChannel === otherChannel) {
    return {
      slack_workspace: pickText(keep.slack_workspace, other.slack_workspace),
      slack_channel_id: keepChannel ?? otherChannel,
      slack_channel_name: pickText(
        keep.slack_channel_name,
        other.slack_channel_name,
      ),
      last_slack_ts: pickLater(keep.last_slack_ts, other.last_slack_ts),
      slack_history_cursor: pickText(
        keep.slack_history_cursor,
        other.slack_history_cursor,
      ),
    };
  }
  if (!keepChannel) {
    return {
      slack_workspace: other.slack_workspace,
      slack_channel_id: other.slack_channel_id,
      slack_channel_name: other.slack_channel_name,
      last_slack_ts: other.last_slack_ts,
      slack_history_cursor: other.slack_history_cursor,
    };
  }
  return {
    slack_workspace: keep.slack_workspace,
    slack_channel_id: keep.slack_channel_id,
    slack_channel_name: keep.slack_channel_name,
    last_slack_ts: keep.last_slack_ts,
    slack_history_cursor: keep.slack_history_cursor,
  };
}

export function planSlackChannelConflictClears(
  rows: FactoryConfigSqlRow[],
): SlackChannelConflictClear[] {
  const groups = new Map<string, FactoryConfigSqlRow[]>();
  for (const row of rows) {
    const orgId = asText(row.org_id);
    const channelId = asText(row.slack_channel_id);
    const id = asText(row.id);
    if (!orgId || !channelId || !id) continue;
    const key = `${orgId}\0${channelId}`;
    const group = groups.get(key) ?? [];
    group.push({ ...row, id, org_id: orgId });
    groups.set(key, group);
  }

  const clears: SlackChannelConflictClear[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((left, right) => {
      const polling =
        asFlag(right.polling_enabled) - asFlag(left.polling_enabled);
      if (polling !== 0) return polling;
      const updated = (right.updated_at ?? "").localeCompare(
        left.updated_at ?? "",
      );
      if (updated !== 0) return updated;
      return left.id.localeCompare(right.id);
    });
    for (const row of ranked.slice(1)) {
      clears.push({ id: row.id, org_id: row.org_id! });
    }
  }
  return clears;
}
