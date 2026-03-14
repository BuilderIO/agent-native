import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  searchIssues,
  getIssue,
  getProjects,
  getStatuses,
  getBoards,
  getSprints,
  getAnalytics,
} from "../lib/jira";

export const handleJiraSearch: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "JIRA_EMAIL", "Jira")) return;
  try {
    const jql = req.query.jql as string;
    if (!jql) {
      res.status(400).json({ error: "jql query parameter is required" });
      return;
    }
    const maxResults = parseInt(req.query.maxResults as string) || 50;
    const result = await searchIssues(jql, undefined, maxResults);
    res.json(result);
  } catch (err: any) {
    console.error("Jira search error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleJiraIssue: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "JIRA_EMAIL", "Jira")) return;
  try {
    const key = req.query.key as string;
    if (!key) {
      res.status(400).json({ error: "key query parameter is required" });
      return;
    }
    const issue = await getIssue(key);
    res.json({ issue });
  } catch (err: any) {
    console.error("Jira issue error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleJiraProjects: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "JIRA_EMAIL", "Jira")) return;
  try {
    const projects = await getProjects();
    res.json({ projects, total: projects.length });
  } catch (err: any) {
    console.error("Jira projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleJiraStatuses: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "JIRA_EMAIL", "Jira")) return;
  try {
    const project = req.query.project as string | undefined;
    const statuses = await getStatuses(project);
    res.json({ statuses, total: statuses.length });
  } catch (err: any) {
    console.error("Jira statuses error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleJiraBoards: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "JIRA_EMAIL", "Jira")) return;
  try {
    const boards = await getBoards();
    res.json({ boards, total: boards.length });
  } catch (err: any) {
    console.error("Jira boards error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleJiraSprints: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "JIRA_EMAIL", "Jira")) return;
  try {
    const boardId = parseInt(req.query.boardId as string);
    if (!boardId) {
      res.status(400).json({ error: "boardId query parameter is required" });
      return;
    }
    const sprints = await getSprints(boardId);
    res.json({ sprints, total: sprints.length });
  } catch (err: any) {
    console.error("Jira sprints error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleJiraAnalytics: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "JIRA_EMAIL", "Jira")) return;
  try {
    const projectsParam = req.query.projects as string | undefined;
    const projects = projectsParam
      ? projectsParam.split(",").map((p) => p.trim())
      : [];
    const days = parseInt(req.query.days as string) || 30;
    const analytics = await getAnalytics(projects, days);
    res.json(analytics);
  } catch (err: any) {
    console.error("Jira analytics error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
