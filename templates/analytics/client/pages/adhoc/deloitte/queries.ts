const AMPLITUDE = "`your-gcp-project-id.amplitude.EVENTS_182198`";
const SIGNUPS = "`your-gcp-project-id.dbt_staging_bigquery.signups`";
const DIM_HS_CONTACTS = "`your-gcp-project-id.dbt_mart.dim_hs_contacts`";
const SUBS = "`your-gcp-project-id.dbt_mart.dim_subscriptions`";

// Customer root org IDs (discovered via HubSpot companies -> contacts -> signups)
// Replace '%example-company%' with your customer's company name pattern.
const CUSTOMER_ORG_IDS_SQL = `
  SELECT DISTINCT s.root_organization_id
  FROM ${SIGNUPS} s
  JOIN ${DIM_HS_CONTACTS} c ON c.builder_user_id = s.user_id
  WHERE LOWER(c.company) LIKE '%example-company%'
    AND s.root_organization_id IS NOT NULL
    AND s.root_organization_id != ''
`;

export function agentChatUsersByMessageCount(
  dateStart: string,
  dateEnd: string,
): string {
  return `WITH customer_orgs AS (${CUSTOMER_ORG_IDS_SQL})
SELECT
  COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) AS email,
  COUNT(*) AS messages,
  COUNT(DISTINCT DATE(event_time)) AS active_days,
  MIN(DATE(event_time)) AS first_message,
  MAX(DATE(event_time)) AS last_message
FROM ${AMPLITUDE}
WHERE event_type = 'agent chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (SELECT root_organization_id FROM customer_orgs)
  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@your-company.com'
GROUP BY email
ORDER BY messages DESC`;
}

export function agentChatMessagesByDay(
  dateStart: string,
  dateEnd: string,
): string {
  return `WITH customer_orgs AS (${CUSTOMER_ORG_IDS_SQL})
SELECT
  DATE(event_time) AS period,
  COUNT(*) AS messages,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE event_type = 'agent chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (SELECT root_organization_id FROM customer_orgs)
  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@your-company.com'
GROUP BY period
ORDER BY period`;
}

export function customerUsersQuery(): string {
  return `SELECT
  sg.user_id,
  sg.root_organization_id AS org_id,
  DATE(sg.created_date) AS signup_date,
  c.email,
  c.firstname,
  c.lastname
FROM ${SIGNUPS} sg
JOIN ${DIM_HS_CONTACTS} c ON c.builder_user_id = sg.user_id
WHERE LOWER(c.company) LIKE '%example-company%'
ORDER BY sg.created_date DESC`;
}

export function customerSubscriptionsQuery(): string {
  return `WITH customer_orgs AS (${CUSTOMER_ORG_IDS_SQL})
SELECT
  root_id,
  space_id,
  plan,
  status,
  subscription_arr,
  start_date
FROM ${SUBS}
WHERE root_id IN (SELECT root_organization_id FROM customer_orgs)
ORDER BY start_date DESC`;
}
