#!/usr/bin/env tsx
/**
 * Query GitHub PRs and issues across the BuilderIO org.
 *
 * Usage:
 *   pnpm script github-prs
 *   pnpm script github-prs --org=BuilderIO --query="is:open label:bug"
 *   pnpm script github-prs --repo=BuilderIO/qwik --state=open
 *   pnpm script github-prs --pr=BuilderIO/qwik/1234          (PR detail)
 *   pnpm script github-prs --issue=BuilderIO/qwik/567        (issue detail)
 *   pnpm script github-prs --search="fix authentication is:pr is:merged"
 *   pnpm script github-prs --search="memory leak" --type=issue
 *   pnpm script github-prs --graphql='{ viewer { login } }'  (raw GraphQL)
 *
 * Supports --grep and --fields for filtering output (built-in to output()).
 */
import { parseArgs, output, fatal } from "./helpers";
import {
  searchOrgPRs,
  searchPRs,
  searchIssues,
  getPR,
  getIssue,
  listPRs,
  runGraphQL,
} from "../server/lib/github";

const args = parseArgs();

// --pr=owner/repo/number  →  PR detail
if (args.pr) {
  const parts = (args.pr as string).split("/");
  if (parts.length < 3) fatal("--pr must be in format owner/repo/number");
  const [owner, repo, num] = parts;
  const pr = await getPR(owner, repo, parseInt(num));
  output(pr);
}

// --issue=owner/repo/number  →  Issue detail
else if (args.issue) {
  const parts = (args.issue as string).split("/");
  if (parts.length < 3) fatal("--issue must be in format owner/repo/number");
  const [owner, repo, num] = parts;
  const issue = await getIssue(owner, repo, parseInt(num));
  output(issue);
}

// --search="..."  →  full GitHub search syntax (all orgs/repos)
else if (args.search) {
  const type = args.type === "issue" ? "issue" : "pr";
  const limit = args.limit ? parseInt(args.limit as string) : 30;
  const q = args.search as string;

  if (type === "issue") {
    const issues = await searchIssues({ query: q, limit });
    output({ issues, total: issues.length, query: q });
  } else {
    const prs = await searchPRs({ query: q, limit });
    output({ prs, total: prs.length, query: q });
  }
}

// --repo=owner/repo  →  list PRs for a specific repo
else if (args.repo) {
  const parts = (args.repo as string).split("/");
  if (parts.length < 2) fatal("--repo must be in format owner/repo");
  const [owner, repo] = parts;
  const state = (args.state as "open" | "closed" | "all") ?? "open";
  const limit = args.limit ? parseInt(args.limit as string) : 30;
  const prs = await listPRs(owner, repo, { state, limit });
  output({ prs, total: prs.length, repo: args.repo, state });
}

// --graphql="..."  →  run raw GraphQL query
else if (args.graphql) {
  const data = await runGraphQL(args.graphql as string);
  output({ data });
}

// default: search across BuilderIO org
else {
  const org = (args.org as string) ?? "BuilderIO";
  const query = (args.query as string) ?? "";
  const state = args.state as "OPEN" | "CLOSED" | "MERGED" | undefined;
  const limit = args.limit ? parseInt(args.limit as string) : 30;

  const prs = await searchOrgPRs({ org, query, state, limit });
  output({ prs, total: prs.length, org, query });
}
