import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { requireCredential } from "../lib/credentials";
import { getCalls, searchCalls, getUsers } from "../lib/gong";

export const handleGongCalls = defineEventHandler(async (event) => {
  const missing =
    (await requireCredential(event, "GONG_ACCESS_KEY", "Gong")) ||
    (await requireCredential(event, "GONG_ACCESS_SECRET", "Gong"));
  if (missing) return missing;
  try {
    const { company, days: daysParam } = getQuery(event);
    if (company) {
      const days = daysParam ? parseInt(daysParam as string) : 90;
      const calls = await searchCalls(company as string, days);
      return { calls, total: calls.length };
    } else {
      const days = daysParam ? parseInt(daysParam as string) : 30;
      const fromDateTime = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      const result = await getCalls({ fromDateTime });
      return { calls: result.calls, total: result.calls.length };
    }
  } catch (err: any) {
    console.error("Gong calls error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const handleGongUsers = defineEventHandler(async (event) => {
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
