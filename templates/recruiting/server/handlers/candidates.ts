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
    per_page?: string;
    page?: string;
  };

  const candidates = await gh.listCandidates({
    job_id: query.job_id ? Number(query.job_id) : undefined,
    per_page: Number(query.per_page) || 100,
    page: Number(query.page) || 1,
  });

  // Client-side search filtering (Greenhouse API doesn't have a search param)
  let results = candidates;
  if (query.search) {
    const term = query.search.toLowerCase();
    results = candidates.filter(
      (c) =>
        c.first_name?.toLowerCase().includes(term) ||
        c.last_name?.toLowerCase().includes(term) ||
        (c.company && c.company.toLowerCase().includes(term)) ||
        (c.emails || []).some((e) => e.value.toLowerCase().includes(term)),
    );
  }

  // Return only fields needed for the list view to reduce payload size
  return results.map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    title: c.title,
    company: c.company,
    emails: (c.emails || []).slice(0, 1),
    tags: c.tags || [],
    last_activity: c.last_activity,
    applications: (c.applications || []).map((a) => ({
      id: a.id,
      status: a.status,
      current_stage: a.current_stage,
      jobs: a.jobs,
    })),
  }));
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
