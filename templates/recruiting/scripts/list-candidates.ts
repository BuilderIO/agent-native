import { parseArgs, output, localFetch } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Search and list candidates from Greenhouse",
  parameters: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description: "Search term (name, email, company)",
      },
      jobId: { type: "string", description: "Filter by job ID" },
      compact: {
        type: "string",
        description: "Return compact output",
        enum: ["true", "false"],
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const params = new URLSearchParams();
  if (args.search) params.set("search", args.search);
  if (args.jobId) params.set("job_id", args.jobId);
  const candidates = await localFetch<any[]>(`/api/candidates?${params}`);

  if (args.compact === "true") {
    return JSON.stringify(
      candidates.map((c) => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        email: c.emails?.[0]?.value,
        company: c.company,
        title: c.title,
        tags: c.tags,
      })),
      null,
      2,
    );
  }
  return JSON.stringify(candidates, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
