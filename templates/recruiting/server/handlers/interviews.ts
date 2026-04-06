import { getQuery } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import { defineOrgHandler } from "../lib/org-context.js";

export const listInterviewsHandler = defineOrgHandler(async (event) => {
  const query = getQuery(event) as { created_after?: string };

  // Default to interviews created in the last 60 days to avoid paginating
  // through thousands of old interviews. The frontend filters to upcoming only.
  const defaultAfter = new Date(
    Date.now() - 365 * 24 * 60 * 60 * 1000,
  ).toISOString();

  return gh.listScheduledInterviews({
    created_after: query.created_after || defaultAfter,
  });
});
