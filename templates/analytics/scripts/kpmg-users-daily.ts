#!/usr/bin/env tsx
import "dotenv/config";
import { parseArgs, output } from "./helpers";
import { runQuery } from "../server/lib/bigquery";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
// KPMG - New Deal (Closed Won)
const DEAL_ID = "39349139546";

async function hubspotGet(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

// We need to search for KPMG deal specifically
// First search HubSpot for KPMG deals
const searchRes = await fetch(
  "https://api.hubapi.com/crm/v3/objects/deals/search",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "dealname",
              operator: "CONTAINS_TOKEN",
              value: "KPMG",
            },
          ],
        },
      ],
      properties: ["dealname", "dealstage", "amount"],
      limit: 10,
    }),
  },
);
const searchData = await searchRes.json();
const kpmgDeals = searchData.results || [];
console.error(`Found ${kpmgDeals.length} KPMG deals`);
const kpmgDealIds = kpmgDeals.map((d: any) => d.id);
console.error(`Deal IDs: ${kpmgDealIds.join(", ")}`);

// Get companies from all KPMG deals
const allCompanyIds: string[] = [];
for (const dealId of kpmgDealIds) {
  try {
    const companyAssoc = await hubspotGet(
      `/crm/v3/objects/deals/${dealId}/associations/companies`,
    );
    const ids = companyAssoc.results?.map((r: any) => r.id) ?? [];
    allCompanyIds.push(...ids);
  } catch {}
}
const uniqueCompanyIds = [...new Set(allCompanyIds)];
console.error(`Company IDs: ${uniqueCompanyIds.join(", ")}`);

// Company -> Contacts
const allContactIds: string[] = [];
for (const companyId of uniqueCompanyIds) {
  try {
    const contactAssoc = await hubspotGet(
      `/crm/v3/objects/companies/${companyId}/associations/contacts`,
    );
    const ids = contactAssoc.results?.map((r: any) => r.id) ?? [];
    allContactIds.push(...ids);
  } catch {}
}
const uniqueContactIds = [...new Set(allContactIds)];
console.error(
  `Contact IDs (${uniqueContactIds.length}): ${uniqueContactIds.slice(0, 10).join(", ")}...`,
);

// Contacts -> builder_user_id
const contactIdList = uniqueContactIds.join(",");
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

// builder_user_id -> root_organization_id
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

// Query Amplitude for per-user daily fusion messages
const args = parseArgs();
const days = parseInt(args.days || "30", 10);

let userDaily: any[] = [];
if (orgIds.length > 0) {
  const orgIdList = orgIds.map((id: string) => `'${id}'`).join(",");
  const result = await runQuery(`
    SELECT
      DATE(event_time) as date,
      COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) as email,
      COUNT(*) as message_count
    FROM amplitude.EVENTS_182198
    WHERE event_type = 'fusion chat message submitted'
      AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
      AND event_time <= CURRENT_TIMESTAMP()
      AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList})
      AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@builder.io'
    GROUP BY date, email
    ORDER BY date, message_count DESC
  `);
  userDaily = result.rows;
}

// Also compute totals per user
const userTotals: Record<string, number> = {};
for (const row of userDaily) {
  const email = row.email;
  userTotals[email] = (userTotals[email] || 0) + parseInt(row.message_count);
}
const topUsers = Object.entries(userTotals)
  .sort((a, b) => b[1] - a[1])
  .map(([email, count]) => ({ email, total_messages: count }));

const totalMessages = userDaily.reduce(
  (sum: number, r: any) => sum + parseInt(r.message_count),
  0,
);

output({
  orgIds,
  days,
  totalMessages,
  topUsers,
  daily: userDaily,
});
