import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
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
export const handleGitHubSearch: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GITHUB_TOKEN", "GitHub")) return;
  try {
    const q = req.query.q as string;
    if (!q)
      return void res.status(400).json({ error: "q parameter is required" });

    const type = (req.query.type as string) === "issue" ? "issue" : "pr";
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;

    if (type === "issue") {
      const issues = await searchIssues({ query: q, limit });
      res.json({ issues, total: issues.length });
    } else {
      const prs = await searchPRs({ query: q, limit });
      res.json({ prs, total: prs.length });
    }
  } catch (err: any) {
    console.error("GitHub search error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/github/pr?owner=...&repo=...&number=... */
export const handleGitHubPR: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GITHUB_TOKEN", "GitHub")) return;
  try {
    const owner = req.query.owner as string;
    const repo = req.query.repo as string;
    const number = parseInt(req.query.number as string);

    if (!owner || !repo || isNaN(number)) {
      return void res
        .status(400)
        .json({ error: "owner, repo, and number are required" });
    }

    const pr = await getPR(owner, repo, number);
    res.json(pr);
  } catch (err: any) {
    console.error("GitHub PR error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/github/issue?owner=...&repo=...&number=... */
export const handleGitHubIssue: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GITHUB_TOKEN", "GitHub")) return;
  try {
    const owner = req.query.owner as string;
    const repo = req.query.repo as string;
    const number = parseInt(req.query.number as string);

    if (!owner || !repo || isNaN(number)) {
      return void res
        .status(400)
        .json({ error: "owner, repo, and number are required" });
    }

    const issue = await getIssue(owner, repo, number);
    res.json(issue);
  } catch (err: any) {
    console.error("GitHub issue error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/github/prs?owner=...&repo=...&state=open|closed|all&limit=30 */
export const handleGitHubPRList: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GITHUB_TOKEN", "GitHub")) return;
  try {
    const owner = req.query.owner as string;
    const repo = req.query.repo as string;

    if (!owner || !repo) {
      return void res
        .status(400)
        .json({ error: "owner and repo are required" });
    }

    const state = (req.query.state as "open" | "closed" | "all") ?? "open";
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;

    const prs = await listPRs(owner, repo, { state, limit });
    res.json({ prs, total: prs.length });
  } catch (err: any) {
    console.error("GitHub PR list error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/github/org-prs?org=...&q=...&state=OPEN|CLOSED|MERGED&limit=30 */
export const handleGitHubOrgPRs: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GITHUB_TOKEN", "GitHub")) return;
  try {
    const org = (req.query.org as string) ?? "BuilderIO";
    const query = req.query.q as string | undefined;
    const state = req.query.state as "OPEN" | "CLOSED" | "MERGED" | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;

    const prs = await searchOrgPRs({ org, query, state, limit });
    res.json({ prs, total: prs.length });
  } catch (err: any) {
    console.error("GitHub org PRs error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/** POST /api/github/graphql  body: { query, variables? } */
export const handleGitHubGraphQL: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GITHUB_TOKEN", "GitHub")) return;
  try {
    const { query, variables } = req.body;
    if (!query)
      return void res.status(400).json({ error: "query is required" });

    const data = await runGraphQL(query, variables);
    res.json({ data });
  } catch (err: any) {
    console.error("GitHub GraphQL error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
