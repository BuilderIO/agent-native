import { parseArgs, output, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";
import type { FilterResponse } from "@shared/types";

export const tool: ActionTool = {
  description:
    "Filter candidates using AI. Evaluates resumes and profiles against a natural language prompt.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          'The filter criteria in natural language, e.g. "5+ years Python, strong ML background"',
      },
      jobId: {
        type: "string",
        description: "Optional job ID to filter candidates for a specific role",
      },
      limit: {
        type: "string",
        description: "Max candidates to evaluate (default 50, max 100)",
      },
    },
    required: ["prompt"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.prompt) {
    return "Error: --prompt is required";
  }

  const body: Record<string, any> = { prompt: args.prompt };
  if (args.jobId) body.jobId = Number(args.jobId);
  if (args.limit) body.limit = Number(args.limit);

  const result = await localFetch<FilterResponse>("/api/candidates/filter", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const matches = result.results.filter((r) => r.match);
  const nonMatches = result.results.filter((r) => !r.match);

  const lines: string[] = [
    `AI Filter: "${result.prompt}"`,
    `Evaluated: ${result.totalEvaluated} candidates`,
    `Matches: ${matches.length}`,
    "",
  ];

  if (matches.length > 0) {
    lines.push("## Matches\n");
    for (const r of matches) {
      lines.push(
        `- **${r.name}** (ID: ${r.candidateId}) [${r.confidence}]: ${r.reasoning}`,
      );
    }
  }

  if (nonMatches.length > 0) {
    lines.push("\n## Non-matches\n");
    for (const r of nonMatches) {
      lines.push(
        `- ${r.name} (ID: ${r.candidateId}) [${r.confidence}]: ${r.reasoning}`,
      );
    }
  }

  return lines.join("\n");
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
