import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";

async function listJobs(args: Record<string, string>) {
  const jobs = await gh.listJobs({
    status: args.status,
    per_page: 100,
    page: 1,
  });

  if (args.compact === "true") {
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
  parameters: {
    status: {
      type: "string",
      description: "Filter by status",
      enum: ["open", "closed", "draft"],
    },
    compact: {
      type: "string",
      description: "Return compact output with fewer fields",
      enum: ["true", "false"],
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => listJobs(args));
    }
    return listJobs(args);
  },
});
