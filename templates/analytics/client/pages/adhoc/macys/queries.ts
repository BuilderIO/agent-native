// ─── BigQuery table references ─────────────────────────────────────────
const AMPLITUDE = "`builder-3b0a2.amplitude.EVENTS_182198`";
const SUBS = "`builder-3b0a2.dbt_mart.dim_subscriptions`";
const SIGNUPS = "`builder-3b0a2.dbt_staging_bigquery.signups`";
const DIM_HS_CONTACTS = "`builder-3b0a2.dbt_mart.dim_hs_contacts`";

// Macy's root org IDs (discovered via HubSpot deal → company → contacts → signups)
const MACYS_ORG_IDS = [
  "ceb199b063d34a47ad2b03c9d1e019df",
  "9060c246119d414a97029d535e99b322",
  "42edb541a73f4cb6ba52c70092534a64",
];

function orgIdList(): string {
  return MACYS_ORG_IDS.map((id) => `'${id}'`).join(",");
}

// ─── Agent Chat Messages Over Time ────────────────────────────────────

export function agentChatMessagesByDayQuery(dateStart: string, dateEnd: string): string {
  return `SELECT
  DATE(event_time) AS period,
  COUNT(*) AS messages,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE event_type = 'fusion chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList()})
GROUP BY period
ORDER BY period`;
}

// ─── Messages by User ──────────────────────────────────────────────────

export function agentChatMessagesByUserQuery(dateStart: string, dateEnd: string): string {
  return `SELECT
  COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) AS user_email,
  COUNT(*) AS messages,
  MIN(DATE(event_time)) AS first_active,
  MAX(DATE(event_time)) AS last_active,
  COUNT(DISTINCT DATE(event_time)) AS active_days
FROM ${AMPLITUDE}
WHERE event_type = 'fusion chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList()})
GROUP BY user_email
ORDER BY messages DESC`;
}

// ─── All Agent Chat Events (not just messages) ─────────────────────────

export function agentChatEventsByTypeQuery(dateStart: string, dateEnd: string): string {
  return `SELECT
  event_type,
  COUNT(*) AS event_count,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList()})
  AND event_type LIKE '%fusion%'
GROUP BY event_type
ORDER BY event_count DESC`;
}

// ─── All Builder Events by Day ─────────────────────────────────────────

export function allEventsByDayQuery(dateStart: string, dateEnd: string): string {
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

export function macysSubscriptionsQuery(): string {
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

// ─── Known Macy's Users ────────────────────────────────────────────────

export function macysUsersQuery(): string {
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
