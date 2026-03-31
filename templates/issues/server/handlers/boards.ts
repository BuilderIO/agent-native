import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseStatus,
  createError,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import { getClient } from "../lib/jira-auth.js";
import {
  agileListBoards,
  agileGetBoardConfig,
  agileListSprints,
  agileGetSprintIssues,
  AtlassianApiError,
} from "../lib/jira-api.js";

async function requireClient(event: H3Event) {
  const session = await getSession(event);
  const client = await getClient(session?.email);
  if (!client) {
    throw createError({ statusCode: 401, statusMessage: "Jira not connected" });
  }
  return client;
}

export const listBoards = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const query = getQuery(event);
  const startAt = query.startAt ? Number(query.startAt) : 0;
  const maxResults = query.maxResults ? Number(query.maxResults) : 50;
  const projectKeyOrId = query.projectKeyOrId as string | undefined;

  try {
    const result = await agileListBoards(client.cloudId, client.accessToken, {
      startAt,
      maxResults,
      projectKeyOrId,
    });
    return result;
  } catch (err) {
    if (
      err instanceof AtlassianApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      return { values: [], total: 0 };
    }
    throw err;
  }
});

export const getBoardConfig = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const boardId = getRouterParam(event, "boardId");
  if (!boardId) {
    setResponseStatus(event, 400);
    return { error: "boardId is required" };
  }

  try {
    const config = await agileGetBoardConfig(
      client.cloudId,
      client.accessToken,
      boardId,
    );
    return config;
  } catch (err) {
    if (
      err instanceof AtlassianApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      setResponseStatus(event, err.status);
      return { error: err.message };
    }
    throw err;
  }
});

export const listSprints = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const boardId = getRouterParam(event, "boardId");
  if (!boardId) {
    setResponseStatus(event, 400);
    return { error: "boardId is required" };
  }

  const query = getQuery(event);
  const state = query.state as string | undefined;

  try {
    const result = await agileListSprints(
      client.cloudId,
      client.accessToken,
      boardId,
      {
        state,
        maxResults: 50,
      },
    );
    return result;
  } catch (err) {
    if (
      err instanceof AtlassianApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      return { values: [], total: 0 };
    }
    throw err;
  }
});

export const getSprintIssues = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const sprintId = getRouterParam(event, "sprintId");
  if (!sprintId) {
    setResponseStatus(event, 400);
    return { error: "sprintId is required" };
  }

  const query = getQuery(event);
  const startAt = query.startAt ? Number(query.startAt) : 0;
  const maxResults = query.maxResults ? Number(query.maxResults) : 50;

  try {
    const result = await agileGetSprintIssues(
      client.cloudId,
      client.accessToken,
      sprintId,
      {
        startAt,
        maxResults,
      },
    );
    return result;
  } catch (err) {
    if (
      err instanceof AtlassianApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      return { startAt: 0, maxResults: 0, total: 0, issues: [] };
    }
    throw err;
  }
});
