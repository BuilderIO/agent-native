import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { runApiHandlerWithContext } from "../lib/credentials";
import { getCalls, getUsers, searchCalls } from "../lib/gong";
import {
  DEFAULT_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
} from "../lib/gong-limits";
import { resolveAnalyticsGongCredentials } from "../lib/provider-credentials";

function missingGongCredentials() {
  return {
    error: "missing_api_key",
    key: "GONG_ACCESS_KEY",
    label: "Gong",
    message:
      "Connect Gong with GONG_ACCESS_KEY and GONG_ACCESS_SECRET, or sync a legacy GONG_API_KEY value from Dispatch Vault.",
    settingsPath: "/data-sources",
  };
}

export const handleGongCalls = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async (ctx) => {
    const credentials = await resolveAnalyticsGongCredentials({ ctx });
    if (!credentials) return missingGongCredentials();
    try {
      const { company, days: daysParam, limit: limitParam } = getQuery(event);
      const limit = normalizeGongCallLimit(
        limitParam
          ? parseInt(limitParam as string, 10)
          : DEFAULT_GONG_CALL_LIMIT,
      );
      if (company) {
        const days = daysParam ? parseInt(daysParam as string, 10) : 90;
        const result = await searchCalls(company as string, days, limit);
        return { ...result, total: result.calls.length };
      } else {
        const days = daysParam ? parseInt(daysParam as string, 10) : 30;
        const fromDateTime = new Date(
          Date.now() - days * 24 * 60 * 60 * 1000,
        ).toISOString();
        const result = await getCalls({ fromDateTime });
        const limited = limitGongCalls(result.calls, limit);
        return { ...limited, total: limited.calls.length };
      }
    } catch (err: any) {
      console.error("Gong calls error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handleGongUsers = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async (ctx) => {
    const credentials = await resolveAnalyticsGongCredentials({ ctx });
    if (!credentials) return missingGongCredentials();
    try {
      const users = await getUsers();
      return { users, total: users.length };
    } catch (err: any) {
      console.error("Gong users error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});
