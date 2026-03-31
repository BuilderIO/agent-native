import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import { getClient } from "../lib/jira-auth.js";
import {
  jiraGetComments,
  jiraAddComment,
  jiraUpdateComment,
  jiraDeleteComment,
} from "../lib/jira-api.js";
import { markdownToAdf } from "../lib/adf.js";

async function requireClient(event: H3Event) {
  const session = await getSession(event);
  const client = await getClient(session?.email);
  if (!client) {
    setResponseStatus(event, 401);
    throw new Error("Jira not connected");
  }
  return client;
}

export const getComments = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  if (!issueKey) {
    setResponseStatus(event, 400);
    return { error: "issueKey is required" };
  }

  const result = await jiraGetComments(
    client.cloudId,
    client.accessToken,
    issueKey,
    {
      orderBy: "-created",
      maxResults: 100,
    },
  );

  return result;
});

export const addComment = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  if (!issueKey) {
    setResponseStatus(event, 400);
    return { error: "issueKey is required" };
  }

  const body = await readBody(event);
  const text = body?.body || body?.text;
  if (!text) {
    setResponseStatus(event, 400);
    return { error: "body or text is required" };
  }

  // Convert markdown to ADF
  const adfBody = markdownToAdf(text);
  const result = await jiraAddComment(
    client.cloudId,
    client.accessToken,
    issueKey,
    adfBody,
  );
  return result;
});

export const updateComment = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  const commentId = getRouterParam(event, "commentId");
  if (!issueKey || !commentId) {
    setResponseStatus(event, 400);
    return { error: "issueKey and commentId are required" };
  }

  const body = await readBody(event);
  const text = body?.body || body?.text;
  if (!text) {
    setResponseStatus(event, 400);
    return { error: "body or text is required" };
  }

  const adfBody = markdownToAdf(text);
  const result = await jiraUpdateComment(
    client.cloudId,
    client.accessToken,
    issueKey,
    commentId,
    adfBody,
  );
  return result;
});

export const deleteComment = defineEventHandler(async (event: H3Event) => {
  const client = await requireClient(event);
  const issueKey = getRouterParam(event, "issueKey");
  const commentId = getRouterParam(event, "commentId");
  if (!issueKey || !commentId) {
    setResponseStatus(event, 400);
    return { error: "issueKey and commentId are required" };
  }

  await jiraDeleteComment(
    client.cloudId,
    client.accessToken,
    issueKey,
    commentId,
  );
  return { success: true };
});
