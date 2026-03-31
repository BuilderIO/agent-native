import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import { getClient } from "../lib/jira-auth.js";
import {
  jiraListProjects,
  jiraGetProject,
  jiraGetProjectStatuses,
} from "../lib/jira-api.js";

async function requireClient(event: H3Event) {
  const session = await getSession(event);
  const client = await getClient(session?.email);
  if (!client) {
    setResponseStatus(event, 401);
    throw new Error("Jira not connected");
  }
  return client;
}

export const listProjects = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const query = getQuery(event);
  const startAt = query.startAt ? Number(query.startAt) : 0;
  const maxResults = query.maxResults ? Number(query.maxResults) : 50;

  const result = await jiraListProjects(client.cloudId, client.accessToken, {
    startAt,
    maxResults,
  });

  return result;
});

export const getProject = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const projectKey = getRouterParam(event, "projectKey");
  if (!projectKey) {
    setResponseStatus(event, 400);
    return { error: "projectKey is required" };
  }

  const [project, statuses] = await Promise.all([
    jiraGetProject(client.cloudId, client.accessToken, projectKey),
    jiraGetProjectStatuses(client.cloudId, client.accessToken, projectKey),
  ]);

  return { ...project, statuses };
});
