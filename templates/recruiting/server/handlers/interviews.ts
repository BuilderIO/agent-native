import { defineEventHandler, getQuery } from "h3";
import * as gh from "../lib/greenhouse-api.js";

export const listInterviewsHandler = defineEventHandler(async (event) => {
  const query = getQuery(event) as { created_after?: string };
  return gh.listScheduledInterviews({
    created_after: query.created_after,
  });
});
