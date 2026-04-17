import { defineAction } from "@agent-native/core";
import { getRequestOrgId } from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";

async function createCandidate(args: {
  firstName?: string;
  lastName?: string;
  email?: string;
  jobId?: number;
}) {
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
    data.applications = [{ job_id: args.jobId }];
  }

  const candidate = await gh.createCandidate(data);
  return candidate;
}

export default defineAction({
  description: "Create a new candidate in Greenhouse",
  schema: z.object({
    firstName: z.string().optional().describe("First name (required)"),
    lastName: z.string().optional().describe("Last name (required)"),
    email: z.string().optional().describe("Email address"),
    jobId: z.coerce.number().optional().describe("Job ID to apply for"),
  }),
  run: async (args) => {
    const orgId = getRequestOrgId();
    if (orgId) {
      return withOrgContext(orgId, () => createCandidate(args));
    }
    return createCandidate(args);
  },
});
