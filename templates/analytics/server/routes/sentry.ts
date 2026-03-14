import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  listProjects,
  listIssues,
  getIssueEvents,
  getOrganizationStats,
} from "../lib/sentry";

export const handleSentryProjects: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "SENTRY_AUTH_TOKEN", "Sentry")) return;
  try {
    const projects = await listProjects();
    res.json({ projects, total: projects.length });
  } catch (err: any) {
    console.error("Sentry projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleSentryIssues: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SENTRY_AUTH_TOKEN", "Sentry")) return;
  try {
    const project = req.query.project as string | undefined;
    const query = req.query.query as string | undefined;
    const statsPeriod = req.query.statsPeriod as string | undefined;
    const issues = await listIssues(project, query, statsPeriod);
    res.json({ issues, total: issues.length });
  } catch (err: any) {
    console.error("Sentry issues error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleSentryIssueEvents: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SENTRY_AUTH_TOKEN", "Sentry")) return;
  try {
    const issueId = req.query.issueId as string;
    if (!issueId) {
      res.status(400).json({ error: "issueId query parameter is required" });
      return;
    }
    const events = await getIssueEvents(issueId);
    res.json({ events, total: events.length });
  } catch (err: any) {
    console.error("Sentry issue events error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleSentryStats: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SENTRY_AUTH_TOKEN", "Sentry")) return;
  try {
    const statsPeriod = req.query.statsPeriod as string | undefined;
    const category = req.query.category as string | undefined;
    const stats = await getOrganizationStats(statsPeriod, category);
    res.json(stats);
  } catch (err: any) {
    console.error("Sentry stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
