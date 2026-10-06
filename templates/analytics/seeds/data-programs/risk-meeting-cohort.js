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
const enterpriseOnly = Boolean(params.enterpriseOnly);

const HIGH_RISK_SENTIMENTS = ["frustrated", "high_risk_detractor"];

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main() {
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
        properties: [
          "dealname",
          "risk_status",
          "risk_summary",
          "risk_category",
          "hs_next_step",
          "churn_notes",
          "total_contract_value",
          "customer_success_owner",
          "dealstage",
          "closedate",
        ],
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

  const deals = dealSearch.items || [];
  const dealIds = deals.map((deal) => deal && deal.id).filter(Boolean);

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
  const domainByCompany = {};
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
      const companyId = result && result.id;
      const domain =
        result && result.properties && result.properties.domain
          ? String(result.properties.domain).toLowerCase()
          : null;
      if (companyId && domain) domainByCompany[companyId] = domain;
    }
  }

  const pylonAccounts = await providerFetchAll("pylon", "/accounts", {
    itemsPath: "data",
    pagination: {
      cursorParam: "cursor",
      nextCursorPath: "pagination.cursor",
      maxPages: 20,
    },
  });

  const sentimentByDomain = {};
  for (const account of pylonAccounts.items || []) {
    if (!account) continue;
    const domain =
      typeof account.domain === "string" ? account.domain.toLowerCase() : null;
    if (!domain) continue;
    if (
      enterpriseOnly &&
      account.account_profile !== "Enterprise Active Customer"
    ) {
      continue;
    }
    if (account.general_sentiment) {
      sentimentByDomain[domain] = account.general_sentiment;
    }
  }

  const rows = deals.map((deal) => {
    const props = (deal && deal.properties) || {};
    const dealId = deal && deal.id;
    const companyId = dealId ? companyByDeal[dealId] : null;
    const domain = companyId ? domainByCompany[companyId] : null;
    const sentiment = domain ? sentimentByDomain[domain] || null : null;

    return {
      deal_id: dealId || null,
      deal_name: props.dealname || null,
      risk_status: props.risk_status || null,
      risk_summary: props.risk_summary || null,
      risk_category: props.risk_category || null,
      next_step: props.hs_next_step || null,
      churn_notes: props.churn_notes || null,
      arr: Number(props.total_contract_value || 0),
      csm_name: props.customer_success_owner || null,
      dealstage: props.dealstage || null,
      closedate: props.closedate || null,
      domain: domain || null,
      pylon_sentiment: sentiment,
      cross_source_flag: Boolean(
        domain && HIGH_RISK_SENTIMENTS.includes(sentiment),
      ),
    };
  });

  emit(rows, [
    { name: "deal_id", type: "string" },
    { name: "deal_name", type: "string" },
    { name: "risk_status", type: "string" },
    { name: "risk_summary", type: "string" },
    { name: "risk_category", type: "string" },
    { name: "next_step", type: "string" },
    { name: "churn_notes", type: "string" },
    { name: "arr", type: "number" },
    { name: "csm_name", type: "string" },
    { name: "dealstage", type: "string" },
    { name: "closedate", type: "string" },
    { name: "domain", type: "string" },
    { name: "pylon_sentiment", type: "string" },
    { name: "cross_source_flag", type: "boolean" },
  ]);
}

await main();
