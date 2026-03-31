import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import { getClient } from "../../../lib/jira-auth.js";
import { jiraSearchUsers } from "../../../lib/jira-api.js";

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  const client = await getClient(session?.email);
  if (!client) {
    setResponseStatus(event, 401);
    return { error: "Jira not connected" };
  }

  const query = getQuery(event);
  const q = (query.query as string) || "";
  const users = await jiraSearchUsers(client.cloudId, client.accessToken, q);
  return users;
});
