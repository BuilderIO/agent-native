/**
 * Data program: Risk Meeting Pylon early-warning accounts.
 *
 * Stored program payload (see the comment at the top of
 * `risk-meeting-cohort.js` in this same directory for the full explanation
 * of why this is a `.js` seed file, not a build source file, and how the
 * generic provider-access pattern works).
 *
 * This program surfaces Pylon-only risk signal: enterprise accounts Pylon
 * already flags as at-risk (by support/CS sentiment) that have NOT yet shown
 * up as a HubSpot deal in the Risk Meeting cohort. That gap is exactly the
 * "early warning" — support signal outrunning CRM signal — that a
 * single-provider dashboard could never surface, because it requires
 * excluding one provider's cohort from another provider's cohort. Nothing
 * here is a hardcoded action: it is two `providerFetchAll` calls and a
 * domain-set subtraction.
 *
 * Params (all optional):
 *   riskStatuses  string[] — same HubSpot `risk_status` values used by
 *                 risk-meeting-cohort.js, so the "already in the HubSpot
 *                 cohort" exclusion set matches that program's definition.
 *                 Defaults to the same four canonical statuses.
 */

const DEFAULT_RISK_STATUSES = [
  "On the Radar",
  "Churn Risk",
  "Confirmed Churn",
  "No Save Attempted",
];

const riskStatuses =
  Array.isArray(params.riskStatuses) && params.riskStatuses.length > 0
    ? params.riskStatuses
    : DEFAULT_RISK_STATUSES;

const HIGH_RISK_SENTIMENTS = ["frustrated", "high_risk_detractor"];
const ENTERPRISE_PROFILE = "Enterprise Active Customer";

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Lighter variant of risk-meeting-cohort.js's HubSpot resolution: we only
 * need the set of domains already covered by the HubSpot cohort, not the
 * full deal detail, so we skip fetching deal-only properties we won't use.
 */
async function hubspotCohortDomains() {
  const dealSearch = await providerFetchAll(
    "hubspot",
    "/crm/v3/objects/deals/search",
    {
      method: "POST",
      body: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "risk_status",
                operator: "IN",
                values: riskStatuses,
              },
              {
                propertyName: "closedate",
                operator: "GT",
                value: String(Date.now()),
              },
            ],
          },
        ],
        properties: ["dealname"],
        limit: 100,
      },
      itemsPath: "results",
      pagination: {
        cursorBodyPath: "after",
        nextCursorPath: "paging.next.after",
        maxPages: 20,
      },
    },
  );

  const dealIds = (dealSearch.items || [])
    .map((deal) => deal && deal.id)
    .filter(Boolean);

  const companyByDeal = {};
  for (const batch of chunk(dealIds, 100)) {
    if (batch.length === 0) continue;
    const assoc = await providerFetch(
      "hubspot",
      "/crm/v3/associations/deals/companies/batch/read",
      { method: "POST", body: { inputs: batch.map((id) => ({ id })) } },
    );
    const results = (assoc && assoc.results) || [];
    for (const result of results) {
      const dealId = result && result.from && result.from.id;
      const companyId =
        result && Array.isArray(result.to) && result.to.length > 0
          ? result.to[0].id
          : null;
      if (dealId && companyId) companyByDeal[dealId] = companyId;
    }
  }

  const companyIds = Array.from(new Set(Object.values(companyByDeal))).filter(
    Boolean,
  );
  const domains = new Set();
  for (const batch of chunk(companyIds, 100)) {
    if (batch.length === 0) continue;
    const companies = await providerFetch(
      "hubspot",
      "/crm/v3/objects/companies/batch/read",
      {
        method: "POST",
        body: { inputs: batch.map((id) => ({ id })), properties: ["domain"] },
      },
    );
    const results = (companies && companies.results) || [];
    for (const result of results) {
      const domain =
        result && result.properties && result.properties.domain
          ? String(result.properties.domain).toLowerCase()
          : null;
      if (domain) domains.add(domain);
    }
  }
  return domains;
}

async function main() {
  const [pylonAccounts, coveredDomains] = await Promise.all([
    providerFetchAll("pylon", "/accounts", {
      itemsPath: "data",
      pagination: {
        cursorParam: "cursor",
        nextCursorPath: "pagination.cursor",
        maxPages: 20,
      },
    }),
    hubspotCohortDomains(),
  ]);

  const rows = [];
  for (const account of pylonAccounts.items || []) {
    if (!account) continue;
    const domain =
      typeof account.domain === "string" ? account.domain.toLowerCase() : null;
    const sentiment = account.general_sentiment || null;
    const profile = account.account_profile || null;

    const isEnterprise = profile === ENTERPRISE_PROFILE;
    const isHighRisk = Boolean(
      sentiment && HIGH_RISK_SENTIMENTS.includes(sentiment),
    );
    const alreadyInHubspotCohort = Boolean(
      domain && coveredDomains.has(domain),
    );

    if (!isEnterprise || !isHighRisk || alreadyInHubspotCohort) continue;

    rows.push({
      account_name: account.name || account.account_name || null,
      domain: domain || null,
      pylon_sentiment: sentiment,
      account_profile: profile,
    });
  }

  emit(rows, [
    { name: "account_name", type: "string" },
    { name: "domain", type: "string" },
    { name: "pylon_sentiment", type: "string" },
    { name: "account_profile", type: "string" },
  ]);
}

await main();
