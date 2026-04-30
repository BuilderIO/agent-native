import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import { readBody } from "@agent-native/core/server";
import {
  searchPRs,
  searchIssues,
  getPR,
  getIssue,
  listPRs,
  searchOrgPRs,
  runGraphQL,
} from "../lib/github";

/** GET /api/github/search?q=...&type=pr|issue&limit=30 */
export const handleGitHubSearch = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GITHUB_TOKEN", "GitHub");
    if (missing) return missing;
    try {
      const { q, type: typeParam, limit: limitParam } = getQuery(event);
      if (!q) {
        setResponseStatus(event, 400);
        return { error: "q parameter is required" };
      }

      const type = (typeParam as string) === "issue" ? "issue" : "pr";
      const limit = limitParam ? parseInt(limitParam as string) : 30;

      if (type === "issue") {
        const issues = await searchIssues({ query: q as string, limit });
        return { issues, total: issues.length };
      } else {
        const prs = await searchPRs({ query: q as string, limit });
        return { prs, total: prs.length };
      }
    } catch (err: any) {
      console.error("GitHub search error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

/** GET /api/github/pr?owner=...&repo=...&number=... */
export const handleGitHubPR = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GITHUB_TOKEN", "GitHub");
    if (missing) return missing;
    try {
      const { owner, repo, number: numberParam } = getQuery(event);
      const number = parseInt(numberParam as string);

      if (!owner || !repo || isNaN(number)) {
        setResponseStatus(event, 400);
        return { error: "owner, repo, and number are required" };
      }

      const pr = await getPR(owner as string, repo as string, number);
      return pr;
    } catch (err: any) {
      console.error("GitHub PR error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

/** GET /api/github/issue?owner=...&repo=...&number=... */
export const handleGitHubIssue = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GITHUB_TOKEN", "GitHub");
    if (missing) return missing;
    try {
      const { owner, repo, number: numberParam } = getQuery(event);
      const number = parseInt(numberParam as string);

      if (!owner || !repo || isNaN(number)) {
        setResponseStatus(event, 400);
        return { error: "owner, repo, and number are required" };
      }

      const issue = await getIssue(owner as string, repo as string, number);
      return issue;
    } catch (err: any) {
      console.error("GitHub issue error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

/** GET /api/github/prs?owner=...&repo=...&state=open|closed|all&limit=30 */
export const handleGitHubPRList = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GITHUB_TOKEN", "GitHub");
    if (missing) return missing;
    try {
      const {
        owner,
        repo,
        state: stateParam,
        limit: limitParam,
      } = getQuery(event);

      if (!owner || !repo) {
        setResponseStatus(event, 400);
        return { error: "owner and repo are required" };
      }

      const state = (stateParam as "open" | "closed" | "all") ?? "open";
      const limit = limitParam ? parseInt(limitParam as string) : 30;

      const prs = await listPRs(owner as string, repo as string, {
        state,
        limit,
      });
      return { prs, total: prs.length };
    } catch (err: any) {
      console.error("GitHub PR list error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

/** GET /api/github/org-prs?org=...&q=...&state=OPEN|CLOSED|MERGED&limit=30 */
export const handleGitHubOrgPRs = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GITHUB_TOKEN", "GitHub");
    if (missing) return missing;
    try {
      const {
        org: orgParam,
        q: queryParam,
        state: stateParam,
        limit: limitParam,
      } = getQuery(event);
      const org =
        (orgParam as string) ?? (process.env.GITHUB_ORG || "your-org");
      const query = queryParam as string | undefined;
      const state = stateParam as "OPEN" | "CLOSED" | "MERGED" | undefined;
      const limit = limitParam ? parseInt(limitParam as string) : 30;

      const prs = await searchOrgPRs({ org, query, state, limit });
      return { prs, total: prs.length };
    } catch (err: any) {
      console.error("GitHub org PRs error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});

/** POST /api/github/graphql  body: { query, variables? } */
export const handleGitHubGraphQL = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "GITHUB_TOKEN", "GitHub");
    if (missing) return missing;
    try {
      const { query, variables } = await readBody(event);
      if (!query) {
        setResponseStatus(event, 400);
        return { error: "query is required" };
      }

      const data = await runGraphQL(query, variables);
      return { data };
    } catch (err: any) {
      console.error("GitHub GraphQL error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  });
});
