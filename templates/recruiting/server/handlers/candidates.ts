import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  readBody,
  createError,
} from "h3";
import * as gh from "../lib/greenhouse-api.js";

export const listCandidatesHandler = defineEventHandler(async (event) => {
  const query = getQuery(event) as {
    job_id?: string;
    search?: string;
  };

  const candidates = await gh.listCandidates({
    job_id: query.job_id ? Number(query.job_id) : undefined,
  });

  // Client-side search filtering (Greenhouse API doesn't have a search param)
  if (query.search) {
    const term = query.search.toLowerCase();
    return candidates.filter(
      (c) =>
        c.first_name.toLowerCase().includes(term) ||
        c.last_name.toLowerCase().includes(term) ||
        (c.company && c.company.toLowerCase().includes(term)) ||
        c.emails.some((e) => e.value.toLowerCase().includes(term)),
    );
  }

  return candidates;
});

export const getCandidateHandler = defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id)
    throw createError({ statusCode: 400, message: "Candidate ID required" });
  return gh.getCandidate(id);
});

export const createCandidateHandler = defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (!body?.first_name || !body?.last_name) {
    throw createError({
      statusCode: 400,
      message: "first_name and last_name are required",
    });
  }
  return gh.createCandidate(body);
});
