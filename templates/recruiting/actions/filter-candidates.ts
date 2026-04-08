import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import { listRecentCandidates } from "../server/lib/candidate-search.js";
import { filterCandidates } from "../server/lib/resume-filter.js";
import type { FilterResponse } from "@shared/types";

async function doFilter(args: Record<string, string>) {
  if (!args.prompt) {
    return { error: "--prompt is required" };
  }

  const jobId = args.jobId ? Number(args.jobId) : undefined;
  const limit = Math.min(Number(args.limit) || 50, 100);

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
    return { prompt: args.prompt, results: [], totalEvaluated: 0 };
  }

  // Fetch full details with attachments
  const fullCandidates = await Promise.all(
    candidates.map((c) => gh.getCandidate(c.id).catch(() => c)),
  );

  const result: FilterResponse = await filterCandidates(
    fullCandidates,
    args.prompt,
  );

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

export default defineAction({
  description:
    "Filter candidates using AI. Evaluates resumes and profiles against a natural language prompt.",
  parameters: {
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
  http: false,
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => doFilter(args));
    }
    return doFilter(args);
  },
});
