import { defineAction } from "@agent-native/core";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import {
  mapCandidateListItem,
  searchCandidates,
} from "../server/lib/candidate-search.js";
import * as gh from "../server/lib/greenhouse-api.js";
import { z } from "zod";

async function listCandidates(args: {
  search?: string;
  jobId?: number;
  compact?: boolean;
}) {
  const jobId = args.jobId;
  const limit = 100;

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const results = args.search?.trim()
    ? await searchCandidates({
        search: args.search,
        jobId,
        limit,
      })
    : await gh.listCandidates({
        job_id: jobId,
        updated_after: thirtyDaysAgo,
        per_page: limit,
        page: 1,
      });

  results.sort((a, b) => {
    const aDate = a.last_activity ? new Date(a.last_activity).getTime() : 0;
    const bDate = b.last_activity ? new Date(b.last_activity).getTime() : 0;
    return bDate - aDate;
  });

  const mapped = results.map(mapCandidateListItem);

  if (args.compact) {
    return mapped.map((c) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      email: c.emails?.[0]?.value,
      company: c.company,
      title: c.title,
      tags: c.tags,
    })) as any;
  }
  return mapped;
}

export default defineAction({
  description: "Search and list candidates from Greenhouse",
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe("Search term (name, email, company)"),
    jobId: z.coerce.number().optional().describe("Filter by job ID"),
    compact: z.coerce.boolean().optional().describe("Return compact output"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => listCandidates(args));
    }
    return listCandidates(args);
  },
});
