import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";

async function listJobs(args: { status?: string; compact?: boolean }) {
  const jobs = await gh.listJobs({
    status: args.status,
    per_page: 100,
    page: 1,
  });

  if (args.compact) {
    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      department: j.departments?.[0]?.name,
      openings: j.openings?.length ?? 0,
    }));
  }
  return jobs;
}

export default defineAction({
  description: "List all jobs from Greenhouse with optional status filter",
  schema: z.object({
    status: z
      .enum(["open", "closed", "draft"])
      .optional()
      .describe("Filter by status"),
    compact: z.coerce
      .boolean()
      .optional()
      .describe("Return compact output with fewer fields"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => listJobs(args));
    }
    return listJobs(args);
  },
});
