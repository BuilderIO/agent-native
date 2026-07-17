import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import pylonIssues from "../../../../actions/pylon-issues";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../../../lib/credentials";

export default defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "PYLON_API_KEY", "Pylon");
    if (missing) return missing;
    try {
      const { days } = getQuery(event);
      return await pylonIssues.run({
        days: days == null ? 371 : Number(days),
        pageSize: 500,
        maxPages: 20,
      });
    } catch (error) {
      setResponseStatus(event, 500);
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
);
