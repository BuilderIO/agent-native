import { getQuery, getRouterParam, readBody, createError } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import { defineOrgHandler } from "../lib/org-context.js";
import {
  mapCandidateListItem,
  searchCandidates,
} from "../lib/candidate-search.js";

export const listCandidatesHandler = defineOrgHandler(async (event) => {
  const query = getQuery(event) as {
    job_id?: string;
    search?: string;
    per_page?: string;
    page?: string;
    limit?: string;
  };

  // Default to recently-updated candidates for a useful default view.
  // Greenhouse API doesn't support native candidate search, so free-text search
  // is handled by a deeper server-side scan when a search term is provided.
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const jobId = query.job_id ? Number(query.job_id) : undefined;
  const perPage = Number(query.per_page) || 100;
  const limit = Number(query.limit) || perPage;

  const results = query.search?.trim()
    ? await searchCandidates({
        search: query.search,
        jobId,
        limit,
      })
    : await gh.listCandidates({
        job_id: jobId,
        updated_after: thirtyDaysAgo,
        per_page: perPage,
        page: Number(query.page) || 1,
      });

  // Sort by most recently active first
  results.sort((a, b) => {
    const aDate = a.last_activity ? new Date(a.last_activity).getTime() : 0;
    const bDate = b.last_activity ? new Date(b.last_activity).getTime() : 0;
    return bDate - aDate;
  });

  return results.map(mapCandidateListItem);
});

export const getCandidateHandler = defineOrgHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id)
    throw createError({ statusCode: 400, message: "Candidate ID required" });
  return gh.getCandidate(id);
});

export const createCandidateHandler = defineOrgHandler(async (event) => {
  const body = await readBody(event);
  if (!body?.first_name || !body?.last_name) {
    throw createError({
      statusCode: 400,
      message: "first_name and last_name are required",
    });
  }
  return gh.createCandidate(body);
});
