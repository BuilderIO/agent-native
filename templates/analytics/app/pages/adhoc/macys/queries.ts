// ─── BigQuery table references ─────────────────────────────────────────
const AMPLITUDE = "`your-gcp-project-id.amplitude.EVENTS_182198`";
const SUBS = "`your-gcp-project-id.dbt_mart.dim_subscriptions`";
const SIGNUPS = "`your-gcp-project-id.dbt_staging_bigquery.signups`";
const DIM_HS_CONTACTS = "`your-gcp-project-id.dbt_mart.dim_hs_contacts`";

// Customer root org IDs (discovered via HubSpot deal -> company -> contacts -> signups)
// Replace these with your customer's org IDs
const CUSTOMER_ORG_IDS = [
  "example-org-id-1",
  "example-org-id-2",
  "example-org-id-3",
];

function orgIdList(): string {
  return CUSTOMER_ORG_IDS.map((id) => `'${id}'`).join(",");
}

// ─── Agent Chat Messages Over Time ────────────────────────────────────

export function agentChatMessagesByDayQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `SELECT
  DATE(event_time) AS period,
  COUNT(*) AS messages,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE event_type = 'agent chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList()})
GROUP BY period
ORDER BY period`;
}

// ─── Messages by User ──────────────────────────────────────────────────

export function agentChatMessagesByUserQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `SELECT
  COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) AS user_email,
  COUNT(*) AS messages,
  MIN(DATE(event_time)) AS first_active,
  MAX(DATE(event_time)) AS last_active,
  COUNT(DISTINCT DATE(event_time)) AS active_days
FROM ${AMPLITUDE}
WHERE event_type = 'agent chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList()})
GROUP BY user_email
ORDER BY messages DESC`;
}

// ─── All Agent Chat Events (not just messages) ─────────────────────────

export function agentChatEventsByTypeQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `SELECT
  event_type,
  COUNT(*) AS event_count,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList()})
  AND event_type LIKE '%agent chat%'
GROUP BY event_type
ORDER BY event_count DESC`;
}

// ─── All Builder Events by Day ─────────────────────────────────────────

export function allEventsByDayQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `SELECT
  DATE(event_time) AS period,
  COUNT(*) AS events,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList()})
GROUP BY period
ORDER BY period`;
}

// ─── Spaces / Subscriptions ────────────────────────────────────────────

export function customerSubscriptionsQuery(): string {
  return `SELECT
  root_id,
  space_id,
  plan,
  status,
  subscription_arr,
  start_date
FROM ${SUBS}
WHERE root_id IN (${orgIdList()})
ORDER BY start_date DESC`;
}

// ─── Known Customer Users ──────────────────────────────────────────────

export function customerUsersQuery(): string {
  return `SELECT
  sg.user_id,
  sg.root_organization_id AS org_id,
  DATE(sg.created_date) AS signup_date,
  c.email,
  c.firstname,
  c.lastname
FROM ${SIGNUPS} sg
LEFT JOIN ${DIM_HS_CONTACTS} c ON c.builder_user_id = sg.user_id
WHERE sg.root_organization_id IN (${orgIdList()})
ORDER BY sg.created_date DESC`;
}
