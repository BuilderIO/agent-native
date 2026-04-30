import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { appStateGet } from "@agent-native/core/application-state";
import { getSession, DEV_MODE_USER_EMAIL } from "@agent-native/core/server";

async function getSessionId(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session) return "local";
  if (session.email === DEV_MODE_USER_EMAIL) return "local";
  return session.email;
}

async function getHubSpotKey(event: H3Event): Promise<string | undefined> {
  const sessionId = await getSessionId(event);
  const data = await appStateGet(sessionId, "hubspot");
  return (data as any)?.apiKey || undefined;
}

// GET /api/hubspot/contact?email=...
export const hubspotContactLookup = defineEventHandler(
  async (event: H3Event) => {
    const { email } = getQuery(event);
    if (!email || typeof email !== "string") {
      setResponseStatus(event, 400);
      return { error: "email query param required" };
    }

    const apiKey = await getHubSpotKey(event);
    if (!apiKey) {
      setResponseStatus(event, 401);
      return { error: "HubSpot API key not configured" };
    }

    try {
      // Search for contact by email
      const searchRes = await fetch(
        "https://api.hubapi.com/crm/v3/objects/contacts/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  { propertyName: "email", operator: "EQ", value: email },
                ],
              },
            ],
            properties: [
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
            ],
          }),
        },
      );

      if (!searchRes.ok) {
        setResponseStatus(event, searchRes.status);
        return { error: `HubSpot API error: ${searchRes.status}` };
      }

      const searchData = await searchRes.json();
      const contact = searchData.results?.[0] || null;
      if (!contact) {
        return null;
      }

      // Fetch associated deals
      let deals: any[] = [];
      try {
        const dealsRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contact.id}/associations/deals`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );
        if (dealsRes.ok) {
          const dealsData = await dealsRes.json();
          const dealIds = (dealsData.results || [])
            .slice(0, 5)
            .map((d: any) => d.id);
          if (dealIds.length > 0) {
            const batchRes = await fetch(
              "https://api.hubapi.com/crm/v3/objects/deals/batch/read",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  inputs: dealIds.map((id: string) => ({ id })),
                  properties: [
                    "dealname",
                    "amount",
                    "dealstage",
                    "closedate",
                    "pipeline",
                  ],
                }),
              },
            );
            if (batchRes.ok) {
              const batchData = await batchRes.json();
              deals = (batchData.results || []).map((d: any) => ({
                id: d.id,
                name: d.properties?.dealname,
                amount: d.properties?.amount,
                stage: d.properties?.dealstage,
                closeDate: d.properties?.closedate,
              }));
            }
          }
        }
      } catch {}

      // Fetch associated tickets
      let tickets: any[] = [];
      try {
        const ticketsRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contact.id}/associations/tickets`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );
        if (ticketsRes.ok) {
          const ticketsData = await ticketsRes.json();
          const ticketIds = (ticketsData.results || [])
            .slice(0, 5)
            .map((t: any) => t.id);
          if (ticketIds.length > 0) {
            const batchRes = await fetch(
              "https://api.hubapi.com/crm/v3/objects/tickets/batch/read",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  inputs: ticketIds.map((id: string) => ({ id })),
                  properties: [
                    "subject",
                    "hs_pipeline_stage",
                    "hs_ticket_priority",
                    "createdate",
                  ],
                }),
              },
            );
            if (batchRes.ok) {
              const batchData = await batchRes.json();
              tickets = (batchData.results || []).map((t: any) => ({
                id: t.id,
                subject: t.properties?.subject,
                stage: t.properties?.hs_pipeline_stage,
                priority: t.properties?.hs_ticket_priority,
                created: t.properties?.createdate,
              }));
            }
          }
        }
      } catch {}

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
    } catch {
      setResponseStatus(event, 500);
      return { error: "Failed to reach HubSpot API" };
    }
  },
);
