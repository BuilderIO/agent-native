import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  searchOrgPRs,
  searchPRs,
  searchIssues,
  getPR,
  getIssue,
  listPRs,
  runGraphQL,
} from "../server/lib/github";

export default defineAction({
  description:
    "Query GitHub PRs and issues. Use --pr, --issue, --search, --repo, or --graphql for different modes. Default: search org PRs.",
  schema: z.object({
    pr: z.string().optional().describe("PR in format owner/repo/number"),
    issue: z.string().optional().describe("Issue in format owner/repo/number"),
    search: z.string().optional().describe("GitHub search query"),
    type: z
      .string()
      .optional()
      .describe("Search type: pr or issue (default pr)"),
    repo: z
      .string()
      .optional()
      .describe("List PRs for repo in format owner/repo"),
    graphql: z.string().optional().describe("Raw GraphQL query"),
    org: z.string().optional().describe("GitHub org name"),
    query: z.string().optional().describe("Query filter for org PR search"),
    state: z.string().optional().describe("Filter by state"),
    limit: z.coerce.number().optional().describe("Max results (default 30)"),
  }),
  http: false,
  run: async (args) => {
    if (args.pr) {
      const parts = args.pr.split("/");
      if (parts.length < 3)
        return { error: "--pr must be in format owner/repo/number" };
      const [owner, repo, num] = parts;
      return await getPR(owner, repo, parseInt(num));
    }

    if (args.issue) {
      const parts = args.issue.split("/");
      if (parts.length < 3)
        return { error: "--issue must be in format owner/repo/number" };
      const [owner, repo, num] = parts;
      return await getIssue(owner, repo, parseInt(num));
    }

    if (args.search) {
      const type = args.type === "issue" ? "issue" : "pr";
      const limit = args.limit ?? 30;
      if (type === "issue") {
        const issues = await searchIssues({ query: args.search, limit });
        return { issues, total: issues.length, query: args.search };
      } else {
        const prs = await searchPRs({ query: args.search, limit });
        return { prs, total: prs.length, query: args.search };
      }
    }

    if (args.repo) {
      const parts = args.repo.split("/");
      if (parts.length < 2)
        return { error: "--repo must be in format owner/repo" };
      const [owner, repo] = parts;
      const state = (args.state as "open" | "closed" | "all") ?? "open";
      const limit = args.limit ?? 30;
      const prs = await listPRs(owner, repo, { state, limit });
      return { prs, total: prs.length, repo: args.repo, state };
    }

    if (args.graphql) {
      const data = await runGraphQL(args.graphql);
      return { data };
    }

    // Default: search across configured org
    const org = args.org ?? (process.env.GITHUB_ORG || "your-org");
    const query = args.query ?? "";
    const state = args.state as "OPEN" | "CLOSED" | "MERGED" | undefined;
    const limit = args.limit ?? 30;

    const prs = await searchOrgPRs({ org, query, state, limit });
    return { prs, total: prs.length, org, query };
  },
});
