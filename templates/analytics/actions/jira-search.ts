#!/usr/bin/env tsx
import { parseArgs, output, fatal } from "./helpers";
import { searchIssues } from "../server/lib/jira";

const args = parseArgs();
if (!args.jql)
  fatal("--jql is required (e.g. --jql='project = ENG AND status = Open')");

const maxResults = parseInt(args.maxResults ?? "50");
const fields = args.fields
  ? args.fields.split(",").map((f) => f.trim())
  : undefined;

const result = await searchIssues(args.jql, fields, maxResults);

const simplified = result.issues.map((issue) => ({
  key: issue.key,
  summary: issue.fields.summary,
  status: issue.fields.status?.name,
  statusCategory: issue.fields.status?.statusCategory?.key,
  priority: issue.fields.priority?.name,
  assignee: issue.fields.assignee?.displayName ?? "Unassigned",
  reporter: issue.fields.reporter?.displayName,
  type: issue.fields.issuetype?.name,
  project: issue.fields.project?.key,
  created: issue.fields.created,
  updated: issue.fields.updated,
  resolved: issue.fields.resolutiondate,
  labels: issue.fields.labels,
}));

output({ issues: simplified, total: result.total });
