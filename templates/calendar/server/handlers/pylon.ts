import { readBody } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getIntegrationKey,
  saveIntegrationKey,
  deleteIntegrationKey,
} from "../lib/integration-credentials.js";

export const pylonStatus = defineEventHandler(async (event: H3Event) => {
  return { connected: !!(await getIntegrationKey(event, "pylon")) };
});

export const pylonSaveKey = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { apiKey } = body;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { error: "apiKey is required" };
  }
  const ok = await saveIntegrationKey(event, "pylon", apiKey);
  if (!ok) {
    setResponseStatus(event, 401);
    return { error: "Sign in to connect Pylon" };
  }
  return { connected: true };
});

export const pylonDeleteKey = defineEventHandler(async (event: H3Event) => {
  const ok = await deleteIntegrationKey(event, "pylon");
  if (!ok) {
    setResponseStatus(event, 401);
    return { error: "Sign in to disconnect Pylon" };
  }
  return { connected: false };
});

export const pylonContactLookup = defineEventHandler(async (event: H3Event) => {
  const { email } = getQuery(event);
  if (!email || typeof email !== "string") {
    setResponseStatus(event, 400);
    return { error: "email query param required" };
  }

  const apiKey = await getIntegrationKey(event, "pylon");
  if (!apiKey) {
    setResponseStatus(event, 401);
    return { error: "Pylon API key not configured" };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    const contactRes = await fetch("https://api.usepylon.com/contacts/search", {
      method: "POST",
      headers,
      body: JSON.stringify({
        filters: { email: { eq: email } },
      }),
    });

    let account: any = null;
    let issues: any[] = [];

    if (contactRes.ok) {
      const contactData = await contactRes.json();
      const contact = contactData.data?.[0];

      if (contact?.account_id) {
        try {
          const accountRes = await fetch(
            `https://api.usepylon.com/accounts/${contact.account_id}`,
            { headers },
          );
          if (accountRes.ok) {
            const accountData = await accountRes.json();
            account = accountData.data;
          }
        } catch {}

        try {
          const issuesRes = await fetch(
            "https://api.usepylon.com/issues/search",
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                filters: { account_id: { eq: contact.account_id } },
                sort: { field: "created_at", direction: "desc" },
                limit: 10,
              }),
            },
          );
          if (issuesRes.ok) {
            const issuesData = await issuesRes.json();
            issues = (issuesData.data || []).map((issue: any) => ({
              id: issue.id,
              number: issue.number,
              title: issue.title,
              state: issue.state,
              created: issue.created_at,
              updated: issue.updated_at,
              assignee: issue.assignee?.name,
              tags: issue.tags || [],
            }));
          }
        } catch {}
      }
    }

    return {
      account: account
        ? {
            id: account.id,
            name: account.name,
            domain: account.domains?.[0],
            type: account.type,
            tags: account.tags || [],
            latestActivity: account.latest_customer_activity_time,
          }
        : null,
      issues,
    };
  } catch {
    setResponseStatus(event, 500);
    return { error: "Failed to reach Pylon API" };
  }
});
