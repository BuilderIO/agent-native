#!/usr/bin/env tsx
import "dotenv/config";
import { parseArgs, output } from "./helpers";
import { runQuery } from "../server/lib/bigquery";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const DEAL_ID = "39349139546"; // Macy's - New Deal - Fusion

async function hubspotGet(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

// Step 1: Deal -> Company
const companyAssoc = await hubspotGet(
  `/crm/v3/objects/deals/${DEAL_ID}/associations/companies`,
);
const companyIds = companyAssoc.results?.map((r: any) => r.id) ?? [];
console.error(`Company IDs: ${companyIds.join(", ")}`);

// Step 2: Company -> Contacts
const allContactIds: string[] = [];
for (const companyId of companyIds) {
  const contactAssoc = await hubspotGet(
    `/crm/v3/objects/companies/${companyId}/associations/contacts`,
  );
  const ids = contactAssoc.results?.map((r: any) => r.id) ?? [];
  allContactIds.push(...ids);
}
console.error(
  `Contact IDs (${allContactIds.length}): ${allContactIds.slice(0, 10).join(", ")}...`,
);

// Step 3: Contacts -> builder_user_id via dim_hs_contacts
const contactIdList = allContactIds.join(",");
const contactResult = await runQuery(`
  SELECT DISTINCT builder_user_id
  FROM dbt_mart.dim_hs_contacts
  WHERE contact_id IN (${contactIdList})
    AND builder_user_id IS NOT NULL
    AND builder_user_id != ''
`);
const builderUserIds = contactResult.rows.map((r: any) => r.builder_user_id);
console.error(
  `Builder user IDs (${builderUserIds.length}): ${builderUserIds.join(", ")}`,
);

// Step 4: builder_user_id -> root_organization_id via signups
let orgIds: string[] = [];
if (builderUserIds.length > 0) {
  const userIdList = builderUserIds.map((id: string) => `'${id}'`).join(",");
  const orgResult = await runQuery(`
    SELECT DISTINCT root_organization_id
    FROM dbt_staging_bigquery.signups
    WHERE user_id IN (${userIdList})
      AND root_organization_id IS NOT NULL
      AND root_organization_id != ''
  `);
  orgIds = orgResult.rows.map((r: any) => r.root_organization_id);
}
console.error(`Org IDs (${orgIds.length}): ${orgIds.join(", ")}`);

// Step 5: Also get space IDs from dim_subscriptions for fallback
let spaceIds: string[] = [];
if (orgIds.length > 0) {
  const orgIdList = orgIds.map((id: string) => `'${id}'`).join(",");
  const spaceResult = await runQuery(`
    SELECT DISTINCT space_id
    FROM dbt_mart.dim_subscriptions
    WHERE root_id IN (${orgIdList})
      AND space_id IS NOT NULL
      AND space_id != ''
  `);
  spaceIds = spaceResult.rows.map((r: any) => r.space_id);
}
console.error(
  `Space IDs (${spaceIds.length}): ${spaceIds.slice(0, 10).join(", ")}...`,
);

// Step 6: Query Amplitude for fusion messages in last 30 days
const args = parseArgs();
const days = parseInt(args.days || "30", 10);

// Try rootOrganizationId first
let messages: any[] = [];
if (orgIds.length > 0) {
  const orgIdList = orgIds.map((id: string) => `'${id}'`).join(",");
  const rootResult = await runQuery(`
    SELECT
      DATE(event_time) as date,
      COUNT(*) as message_count,
      COUNT(DISTINCT user_id) as unique_users
    FROM amplitude.EVENTS_182198
    WHERE event_type = 'fusion chat message submitted'
      AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList})
    GROUP BY date
    ORDER BY date
  `);
  messages = rootResult.rows;
}

// If no results, try organizationId (space-level)
if (messages.length === 0 && spaceIds.length > 0) {
  console.error(
    "No results with rootOrganizationId, trying organizationId (space IDs)...",
  );
  const spaceIdList = spaceIds.map((id: string) => `'${id}'`).join(",");
  const spaceResult2 = await runQuery(`
    SELECT
      DATE(event_time) as date,
      COUNT(*) as message_count,
      COUNT(DISTINCT user_id) as unique_users
    FROM amplitude.EVENTS_182198
    WHERE event_type = 'fusion chat message submitted'
      AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND JSON_VALUE(event_properties, '$.organizationId') IN (${spaceIdList})
    GROUP BY date
    ORDER BY date
  `);
  messages = spaceResult2.rows;
}

const totalMessages = messages.reduce(
  (sum: number, r: any) => sum + parseInt(r.message_count),
  0,
);
console.error(`Total fusion messages in last ${days} days: ${totalMessages}`);

output({
  orgIds,
  spaceIds: spaceIds.slice(0, 20),
  days,
  totalMessages,
  daily: messages,
});
