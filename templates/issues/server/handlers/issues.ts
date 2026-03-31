import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  createError,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import { getClient } from "../lib/jira-auth.js";
import {
  jiraSearchIssues,
  jiraGetIssue,
  jiraCreateIssue,
  jiraUpdateIssue,
  jiraGetTransitions,
  jiraDoTransition,
} from "../lib/jira-api.js";

async function requireClient(event: H3Event) {
  const session = await getSession(event);
  const client = await getClient(session?.email);
  if (!client) {
    throw createError({ statusCode: 401, statusMessage: "Jira not connected" });
  }
  return client;
}

const DEFAULT_FIELDS = [
  "summary",
  "status",
  "priority",
  "assignee",
  "reporter",
  "issuetype",
  "project",
  "labels",
  "created",
  "updated",
  "resolution",
  "resolutiondate",
  "parent",
  "subtasks",
  "issuelinks",
  "sprint",
  "comment",
];

export const listIssues = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const query = getQuery(event);
  const view = (query.view as string) || "my-issues";
  const projectKey = query.projectKey as string | undefined;
  const q = query.q as string | undefined;
  let jql = query.jql as string | undefined;
  const nextPageToken = query.nextPageToken as string | undefined;
  const maxResults = query.maxResults ? Number(query.maxResults) : 50;

  if (!jql) {
    switch (view) {
      case "my-issues":
        jql =
          "assignee = currentUser() AND resolution = Unresolved ORDER BY status ASC, updated DESC";
        break;
      case "project":
        if (!projectKey) {
          setResponseStatus(event, 400);
          return { error: "projectKey is required for project view" };
        }
        jql = `project = "${projectKey}" ORDER BY updated DESC`;
        break;
      case "recent":
        jql = "assignee = currentUser() ORDER BY updated DESC";
        break;
      default:
        jql =
          "assignee = currentUser() AND resolution = Unresolved ORDER BY status ASC, updated DESC";
    }

    if (q) {
      jql = `text ~ "${q}" AND (${jql.split("ORDER BY")[0].trim()}) ORDER BY ${jql.split("ORDER BY")[1]?.trim() || "updated DESC"}`;
    }
  }

  const result = await jiraSearchIssues(client.cloudId, client.accessToken, {
    jql,
    nextPageToken,
    maxResults,
    fields: DEFAULT_FIELDS,
  });

  return result;
});

export const getIssue = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  if (!issueKey) {
    setResponseStatus(event, 400);
    return { error: "issueKey is required" };
  }

  const issue = await jiraGetIssue(
    client.cloudId,
    client.accessToken,
    issueKey,
    {
      fields: [...DEFAULT_FIELDS, "description"],
      expand: ["changelog", "renderedFields"],
    },
  );

  return issue;
});

export const createIssue = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const body = await readBody(event);

  const result = await jiraCreateIssue(
    client.cloudId,
    client.accessToken,
    body,
  );
  return result;
});

export const updateIssue = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  if (!issueKey) {
    setResponseStatus(event, 400);
    return { error: "issueKey is required" };
  }

  const body = await readBody(event);
  await jiraUpdateIssue(client.cloudId, client.accessToken, issueKey, body);
  return { success: true };
});

export const getTransitions = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  if (!issueKey) {
    setResponseStatus(event, 400);
    return { error: "issueKey is required" };
  }

  const result = await jiraGetTransitions(
    client.cloudId,
    client.accessToken,
    issueKey,
  );
  return result;
});

export const doTransition = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  if (!issueKey) {
    setResponseStatus(event, 400);
    return { error: "issueKey is required" };
  }

  const body = await readBody(event);
  const transitionId = body?.transitionId;
  if (!transitionId) {
    setResponseStatus(event, 400);
    return { error: "transitionId is required" };
  }

  await jiraDoTransition(
    client.cloudId,
    client.accessToken,
    issueKey,
    transitionId,
  );
  return { success: true };
});
