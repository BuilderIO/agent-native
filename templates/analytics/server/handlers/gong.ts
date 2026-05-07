import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import {
  DEFAULT_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
} from "../lib/gong-limits";
import { getCalls, getUsers, searchCalls } from "../lib/gong";

export const handleGongCalls = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing =
      (await requireCredential(event, "GONG_ACCESS_KEY", "Gong")) ||
      (await requireCredential(event, "GONG_ACCESS_SECRET", "Gong"));
    if (missing) return missing;
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
  return runApiHandlerWithContext(event, async () => {
    const missing =
      (await requireCredential(event, "GONG_ACCESS_KEY", "Gong")) ||
      (await requireCredential(event, "GONG_ACCESS_SECRET", "Gong"));
    if (missing) return missing;
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
