import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import { getAccounts, getIssues } from "../lib/pylon";

export const handlePylonIssues = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "PYLON_API_KEY", "Pylon");
    if (missing) return missing;
    try {
      const { account_id, state, query } = getQuery(event);
      const issues = await getIssues({
        account_id: account_id as string | undefined,
        state: state as string | undefined,
        query: query as string | undefined,
      });
      return { issues, total: issues.length };
    } catch (err: any) {
      console.error("Pylon issues error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

export const handlePylonAccounts = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "PYLON_API_KEY", "Pylon");
    if (missing) return missing;
    try {
      const { query } = getQuery(event);
      const accounts = await getAccounts(query as string | undefined);
      return { accounts, total: accounts.length };
    } catch (err: any) {
      console.error("Pylon accounts error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});
