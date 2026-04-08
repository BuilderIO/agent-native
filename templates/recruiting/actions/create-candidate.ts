import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";

async function createCandidate(args: Record<string, string>) {
  if (!args.firstName || !args.lastName) {
    throw new Error("--firstName and --lastName are required");
  }

  const data: any = {
    first_name: args.firstName,
    last_name: args.lastName,
  };
  if (args.email) {
    data.emails = [{ value: args.email, type: "personal" }];
  }
  if (args.jobId) {
    data.applications = [{ job_id: Number(args.jobId) }];
  }

  const candidate = await gh.createCandidate(data);
  return candidate;
}

export default defineAction({
  description: "Create a new candidate in Greenhouse",
  parameters: {
    firstName: { type: "string", description: "First name (required)" },
    lastName: { type: "string", description: "Last name (required)" },
    email: { type: "string", description: "Email address" },
    jobId: { type: "string", description: "Job ID to apply for" },
  },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => createCandidate(args));
    }
    return createCandidate(args);
  },
});
