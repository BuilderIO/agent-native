import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import {
  requireCredential,
  runApiHandlerWithContext,
} from "../../../lib/credentials";
import { executeProviderApiRequest } from "../../../lib/provider-api";

export default defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "PYLON_API_KEY", "Pylon");
    if (missing) return missing;
    try {
      const query = getQuery(event);
      const search =
        typeof query.query === "string" && query.query.trim()
          ? query.query
          : undefined;
      const result = (await executeProviderApiRequest({
        provider: "pylon",
        method: "GET",
        path: "/accounts",
        ...(search ? { query: { query: search } } : {}),
      })) as { response?: { json?: unknown } };
      const body = result.response?.json;
      const accounts =
        Array.isArray(body) || !body || typeof body !== "object"
          ? Array.isArray(body)
            ? body
            : []
          : Array.isArray((body as { data?: unknown }).data)
            ? (body as { data: unknown[] }).data
            : [];
      return { accounts, total: accounts.length };
    } catch (error) {
      setResponseStatus(event, 500);
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
);
