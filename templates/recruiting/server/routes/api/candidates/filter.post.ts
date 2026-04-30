import { defineEventHandler, createError } from "h3";
import { getOrgContext } from "@agent-native/core/org";
import { filterCandidates } from "../../../lib/resume-filter.js";
import { listRecentCandidates } from "../../../lib/candidate-search.js";
import * as gh from "../../../lib/greenhouse-api.js";
import { withCredentialContext } from "../../../lib/greenhouse-api.js";
import { readBody } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const prompt = body?.prompt?.trim();

  if (!prompt) {
    throw createError({
      statusCode: 400,
      message: "prompt is required",
    });
  }

  const jobId = body.jobId ? Number(body.jobId) : undefined;
  const limit = Math.min(Number(body.limit) || 50, 100);

  const ctx = await getOrgContext(event);
  if (!ctx.orgId && !ctx.email) {
    throw createError({
      statusCode: 401,
      message: "Sign in to filter candidates.",
    });
  }
  const run = async () => {
    // Fetch candidates to evaluate — either for a specific job or recent ones
    let candidates;
    if (jobId) {
      candidates = await gh.listCandidates({
        job_id: jobId,
        per_page: limit,
        page: 1,
      });
    } else {
      candidates = await listRecentCandidates({ limit });
    }

    if (candidates.length === 0) {
      return { prompt, results: [], totalEvaluated: 0 };
    }

    // For each candidate, we need full details (with attachments)
    // The list endpoint may not include attachments, so fetch individually
    const fullCandidates = await Promise.all(
      candidates.map((c) => gh.getCandidate(c.id).catch(() => c)),
    );

    return filterCandidates(fullCandidates, prompt);
  };

  return withCredentialContext(
    { email: ctx.email || null, orgId: ctx.orgId },
    run,
  );
});
