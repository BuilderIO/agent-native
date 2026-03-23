const AMPLITUDE = "`your-gcp-project-id.amplitude.EVENTS_182198`";
const SIGNUPS = "`your-gcp-project-id.dbt_staging_bigquery.signups`";
const DIM_HS_CONTACTS = "`your-gcp-project-id.dbt_mart.dim_hs_contacts`";
const SUBS = "`your-gcp-project-id.dbt_mart.dim_subscriptions`";

function companyOrgsCte(companyName: string): string {
  const escaped = companyName.replace(/'/g, "\\'");
  return `SELECT DISTINCT s.root_organization_id
  FROM ${SIGNUPS} s
  JOIN ${DIM_HS_CONTACTS} c ON c.builder_user_id = s.user_id
  WHERE LOWER(c.company) LIKE '%${escaped.toLowerCase()}%'
    AND s.root_organization_id IS NOT NULL
    AND s.root_organization_id != ''`;
}

export function searchCompaniesQuery(search: string): string {
  const escaped = search.replace(/'/g, "\\'").toLowerCase();
  return `SELECT DISTINCT c.company, COUNT(DISTINCT c.builder_user_id) AS user_count
FROM ${DIM_HS_CONTACTS} c
WHERE LOWER(c.company) LIKE '%${escaped}%'
  AND c.company IS NOT NULL
  AND c.company != ''
  AND c.builder_user_id IS NOT NULL
GROUP BY c.company
ORDER BY user_count DESC
LIMIT 20`;
}

export function summaryMetricsQuery(companyName: string): string {
  const orgsCte = companyOrgsCte(companyName);
  return `WITH company_orgs AS (${orgsCte})
SELECT
  (SELECT COUNT(DISTINCT c.builder_user_id)
   FROM ${DIM_HS_CONTACTS} c
   WHERE LOWER(c.company) LIKE '%${companyName.replace(/'/g, "\\'").toLowerCase()}%'
     AND c.builder_user_id IS NOT NULL) AS total_users,
  (SELECT COUNT(DISTINCT space_id)
   FROM ${SUBS}
   WHERE root_id IN (SELECT root_organization_id FROM company_orgs)
     AND status = 'active') AS active_spaces,
  (SELECT COALESCE(SUM(subscription_arr), 0)
   FROM ${SUBS}
   WHERE root_id IN (SELECT root_organization_id FROM company_orgs)
     AND status = 'active') AS total_arr,
  (SELECT STRING_AGG(DISTINCT plan, ', ')
   FROM ${SUBS}
   WHERE root_id IN (SELECT root_organization_id FROM company_orgs)
     AND status = 'active') AS plans`;
}

export function agentChatMetrics30dQuery(companyName: string): string {
  const orgsCte = companyOrgsCte(companyName);
  return `WITH company_orgs AS (${orgsCte})
SELECT
  COUNT(*) AS total_messages,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE event_type = 'agent chat message submitted'
  AND DATE(event_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (SELECT root_organization_id FROM company_orgs)
  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@your-company.com'`;
}

export function agentChatMessagesByDayQuery(
  companyName: string,
  dateStart: string,
  dateEnd: string,
): string {
  const orgsCte = companyOrgsCte(companyName);
  return `WITH company_orgs AS (${orgsCte})
SELECT
  DATE(event_time) AS period,
  COUNT(*) AS messages,
  COUNT(DISTINCT user_id) AS unique_users
FROM ${AMPLITUDE}
WHERE event_type = 'agent chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (SELECT root_organization_id FROM company_orgs)
  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@your-company.com'
GROUP BY period
ORDER BY period`;
}

export function topAgentChatUsersQuery(
  companyName: string,
  dateStart: string,
  dateEnd: string,
): string {
  const orgsCte = companyOrgsCte(companyName);
  return `WITH company_orgs AS (${orgsCte})
SELECT
  COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) AS email,
  COUNT(*) AS messages,
  COUNT(DISTINCT DATE(event_time)) AS active_days,
  MIN(DATE(event_time)) AS first_message,
  MAX(DATE(event_time)) AS last_message
FROM ${AMPLITUDE}
WHERE event_type = 'agent chat message submitted'
  AND DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (SELECT root_organization_id FROM company_orgs)
  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@your-company.com'
GROUP BY email
ORDER BY messages DESC
LIMIT 50`;
}

export function subscriptionsQuery(companyName: string): string {
  const orgsCte = companyOrgsCte(companyName);
  return `WITH company_orgs AS (${orgsCte})
SELECT
  root_id,
  space_id,
  plan,
  status,
  subscription_arr,
  start_date
FROM ${SUBS}
WHERE root_id IN (SELECT root_organization_id FROM company_orgs)
ORDER BY status ASC, start_date DESC`;
}

export function renewalDateQuery(companyName: string): string {
  const escaped = companyName.replace(/'/g, "\\'").toLowerCase();
  return `SELECT
  hc.upcoming_renewal_date,
  hc.customer_stage,
  hc.hs_csm_sentiment AS health_status,
  hc.company_owner_name
FROM \`your-gcp-project-id.dbt_staging.hubspot_companies\` hc
WHERE LOWER(hc.company_name) LIKE '%${escaped}%'
  AND hc.upcoming_renewal_date IS NOT NULL
ORDER BY hc.upcoming_renewal_date ASC
LIMIT 1`;
}

export function npsQuery(companyName: string): string {
  const orgsCte = companyOrgsCte(companyName);
  return `WITH company_orgs AS (${orgsCte})
SELECT
  score,
  feedback,
  created_at
FROM \`your-gcp-project-id.metrics.nps\`
WHERE org_id IN (SELECT root_organization_id FROM company_orgs)
ORDER BY created_at DESC
LIMIT 10`;
}
