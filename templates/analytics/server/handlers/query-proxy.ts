import { defineEventHandler, setResponseStatus } from "h3";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import { runQuery } from "../lib/bigquery";
import { readBody } from "@agent-native/core/server";

export const handleQuery = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(
      event,
      "BIGQUERY_PROJECT_ID",
      "BigQuery",
    );
    if (missing) return missing;
    const { query } = await readBody(event);

    if (!query || typeof query !== "string") {
      setResponseStatus(event, 400);
      return { error: "Missing or invalid query" };
    }

    try {
      const result = await runQuery(query);
      return result;
    } catch (error: any) {
      const message = error?.message || String(error);
      console.error("BigQuery error:", message);
      setResponseStatus(event, 400);
      return { error: message };
    }
  }),
);
