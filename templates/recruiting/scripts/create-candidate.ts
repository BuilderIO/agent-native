import { parseArgs, output, localFetch } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Create a new candidate in Greenhouse",
  parameters: {
    type: "object",
    properties: {
      firstName: { type: "string", description: "First name (required)" },
      lastName: { type: "string", description: "Last name (required)" },
      email: { type: "string", description: "Email address" },
      jobId: { type: "string", description: "Job ID to apply for" },
    },
    required: ["firstName", "lastName"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.firstName || !args.lastName) {
    return "Error: --firstName and --lastName are required";
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

  const candidate = await localFetch<any>("/api/candidates", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return `Created candidate ${candidate.first_name} ${candidate.last_name} (ID: ${candidate.id})`;
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
