import { appStateGet } from "@agent-native/core/application-state";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "company",
  "jobtitle",
  "lifecyclestage",
  "hs_lead_status",
  "lastmodifieddate",
  "createdate",
  "hubspot_owner_id",
];

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "dealstage",
  "closedate",
  "pipeline",
];

const TICKET_PROPERTIES = [
  "subject",
  "hs_pipeline_stage",
  "hs_ticket_priority",
  "createdate",
];

type HubSpotRecord = {
  id: string;
  properties?: Record<string, string | undefined>;
};

type HubSpotSearchResponse = {
  results?: HubSpotRecord[];
};

type HubSpotAssociationsResponse = {
  results?: Array<{ id: string }>;
};

export type HubSpotDeal = {
  id: string;
  name?: string;
  amount?: string;
  stage?: string;
  closeDate?: string;
};

export type HubSpotTicket = {
  id: string;
  subject?: string;
  stage?: string;
  priority?: string;
  created?: string;
};

export type HubSpotContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  lifecycleStage?: string;
  leadStatus?: string;
  lastModified?: string;
  created?: string;
  deals: HubSpotDeal[];
  tickets: HubSpotTicket[];
};

export class HubSpotLookupError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "HubSpotLookupError";
  }
}

export async function getHubSpotApiKey(
  sessionId: string,
): Promise<string | undefined> {
  const data = await appStateGet(sessionId, "hubspot");
  const apiKey = (data as { apiKey?: unknown } | undefined)?.apiKey;
  return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined;
}

function hubSpotHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function readAssociatedObjectIds(
  apiKey: string,
  contactId: string,
  objectType: "deals" | "tickets",
): Promise<string[]> {
  const response = await fetch(
    `${HUBSPOT_BASE_URL}/crm/v3/objects/contacts/${contactId}/associations/${objectType}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );

  if (!response.ok) return [];

  const data = await readJson<HubSpotAssociationsResponse>(response);
  return (data.results || []).slice(0, 5).map((item) => item.id);
}

async function readAssociatedDeals(
  apiKey: string,
  contactId: string,
): Promise<HubSpotDeal[]> {
  try {
    const dealIds = await readAssociatedObjectIds(apiKey, contactId, "deals");
    if (dealIds.length === 0) return [];

    const response = await fetch(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/deals/batch/read`,
      {
        method: "POST",
        headers: hubSpotHeaders(apiKey),
        body: JSON.stringify({
          inputs: dealIds.map((id) => ({ id })),
          properties: DEAL_PROPERTIES,
        }),
      },
    );

    if (!response.ok) return [];

    const data = await readJson<HubSpotSearchResponse>(response);
    return (data.results || []).map((deal) => ({
      id: deal.id,
      name: deal.properties?.dealname,
      amount: deal.properties?.amount,
      stage: deal.properties?.dealstage,
      closeDate: deal.properties?.closedate,
    }));
  } catch {
    return [];
  }
}

async function readAssociatedTickets(
  apiKey: string,
  contactId: string,
): Promise<HubSpotTicket[]> {
  try {
    const ticketIds = await readAssociatedObjectIds(
      apiKey,
      contactId,
      "tickets",
    );
    if (ticketIds.length === 0) return [];

    const response = await fetch(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/tickets/batch/read`,
      {
        method: "POST",
        headers: hubSpotHeaders(apiKey),
        body: JSON.stringify({
          inputs: ticketIds.map((id) => ({ id })),
          properties: TICKET_PROPERTIES,
        }),
      },
    );

    if (!response.ok) return [];

    const data = await readJson<HubSpotSearchResponse>(response);
    return (data.results || []).map((ticket) => ({
      id: ticket.id,
      subject: ticket.properties?.subject,
      stage: ticket.properties?.hs_pipeline_stage,
      priority: ticket.properties?.hs_ticket_priority,
      created: ticket.properties?.createdate,
    }));
  } catch {
    return [];
  }
}

export async function lookupHubSpotContact(
  apiKey: string,
  email: string,
): Promise<HubSpotContact | null> {
  const searchResponse = await fetch(
    `${HUBSPOT_BASE_URL}/crm/v3/objects/contacts/search`,
    {
      method: "POST",
      headers: hubSpotHeaders(apiKey),
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: "email", operator: "EQ", value: email }],
          },
        ],
        properties: CONTACT_PROPERTIES,
      }),
    },
  );

  if (!searchResponse.ok) {
    throw new HubSpotLookupError(
      `HubSpot API error: ${searchResponse.status}`,
      searchResponse.status,
    );
  }

  const searchData = await readJson<HubSpotSearchResponse>(searchResponse);
  const contact = searchData.results?.[0] || null;
  if (!contact) return null;

  const [deals, tickets] = await Promise.all([
    readAssociatedDeals(apiKey, contact.id),
    readAssociatedTickets(apiKey, contact.id),
  ]);

  return {
    id: contact.id,
    firstName: contact.properties?.firstname,
    lastName: contact.properties?.lastname,
    email: contact.properties?.email,
    phone: contact.properties?.phone,
    company: contact.properties?.company,
    title: contact.properties?.jobtitle,
    lifecycleStage: contact.properties?.lifecyclestage,
    leadStatus: contact.properties?.hs_lead_status,
    lastModified: contact.properties?.lastmodifieddate,
    created: contact.properties?.createdate,
    deals,
    tickets,
  };
}
