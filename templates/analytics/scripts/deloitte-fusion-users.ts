#!/usr/bin/env tsx
import "dotenv/config";
import { parseArgs, output } from "./helpers";
import { runQuery } from "../server/lib/bigquery";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

async function hubspotGet(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

async function hubspotSearch(objectType: string, filters: any) {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/${objectType}/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(filters),
    },
  );
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

// Step 1: Search for Deloitte companies in HubSpot
console.error("Searching for Deloitte companies in HubSpot...");
const companySearch = await hubspotSearch("companies", {
  filterGroups: [
    {
      filters: [
        {
          propertyName: "name",
          operator: "CONTAINS_TOKEN",
          value: "Deloitte",
        },
      ],
    },
  ],
  properties: ["name", "domain"],
  limit: 100,
});

const companyIds = companySearch.results?.map((r: any) => r.id) ?? [];
console.error(
  `Found ${companyIds.length} Deloitte companies: ${companySearch.results?.map((r: any) => r.properties.name).join(", ")}`,
);

if (companyIds.length === 0) {
  output({ error: "No Deloitte companies found in HubSpot" });
  process.exit(0);
}

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
  `Found ${allContactIds.length} contacts associated with Deloitte companies`,
);

if (allContactIds.length === 0) {
  output({ error: "No contacts found for Deloitte companies" });
  process.exit(0);
}

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
console.error(`Found ${builderUserIds.length} Builder user IDs`);

if (builderUserIds.length === 0) {
  output({ error: "No Builder users found for Deloitte contacts" });
  process.exit(0);
}

// Step 4: builder_user_id -> root_organization_id via signups
const userIdList = builderUserIds.map((id: string) => `'${id}'`).join(",");
const orgResult = await runQuery(`
  SELECT DISTINCT root_organization_id
  FROM dbt_staging_bigquery.signups
  WHERE user_id IN (${userIdList})
    AND root_organization_id IS NOT NULL
    AND root_organization_id != ''
`);
const orgIds = orgResult.rows.map((r: any) => r.root_organization_id);
console.error(`Found ${orgIds.length} organization IDs`);

// Step 5: Query Amplitude for per-user Fusion messages in last 90 days
const args = parseArgs();
const days = parseInt(args.days || "90", 10);

if (orgIds.length === 0) {
  output({ error: "No organization IDs found for Deloitte users" });
  process.exit(0);
}

const orgIdList = orgIds.map((id: string) => `'${id}'`).join(",");
const messagesResult = await runQuery(`
  SELECT
    JSON_VALUE(user_properties, '$.email') as email,
    COUNT(*) as message_count,
    COUNT(DISTINCT DATE(event_time)) as active_days,
    MIN(DATE(event_time)) as first_message_date,
    MAX(DATE(event_time)) as last_message_date
  FROM amplitude.EVENTS_182198
  WHERE event_type = 'fusion chat message submitted'
    AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
    AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList})
    AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@builder.io'
  GROUP BY email
  ORDER BY message_count DESC
`);

const users = messagesResult.rows;
const totalMessages = users.reduce(
  (sum: number, r: any) => sum + parseInt(r.message_count),
  0,
);

console.error(
  `\nFound ${users.length} Deloitte users with Fusion activity (${totalMessages} total messages)`,
);

output({
  days,
  totalUsers: users.length,
  totalMessages,
  users,
});
