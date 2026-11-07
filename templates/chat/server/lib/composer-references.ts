import { getOrgContext } from "@agent-native/core/org";
import {
  listThreads,
  searchThreads,
  type AgentChatReference,
} from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { createError, type H3Event } from "h3";

import { composerReferenceMessages } from "./composer-reference-messages.js";

export async function searchConversationReferences(
  query: string,
  event?: H3Event,
) {
  if (!event)
    throw createError({
      statusCode: 401,
      statusMessage: (await composerReferenceMessages()).authentication,
    });
  const { email, orgId } = await getOrgContext(event);
  const options = { orgId, includeExternal: false, sourceAppId: "chat" };
  const search = query.trim().slice(0, 200);
  const rows = search
    ? await searchThreads(email, search, 20, options)
    : await listThreads(email, { ...options, limit: 20 });
  return rows.map((row) => ({
    id: `chat:${row.id}`,
    label: row.title || row.id,
    description: row.preview.slice(0, 500),
    refType: "chat",
    refId: row.id,
    refPath: `/chat/${encodeURIComponent(row.id)}`,
    icon: "message",
  }));
}

export async function validateConversationReferences(
  references: readonly AgentChatReference[],
) {
  for (const reference of references) {
    if (reference.type !== "mention" || reference.refType !== "chat") continue;
    if (!reference.refId)
      throw createError({
        statusCode: 400,
        statusMessage: (await composerReferenceMessages()).invalid,
      });
    try {
      await assertAccess("chat_thread", reference.refId, "viewer", undefined, {
        skipResourceBody: true,
      });
    } catch (error) {
      if (error instanceof ForbiddenError)
        throw new ForbiddenError(
          (await composerReferenceMessages()).unavailable,
        );
      throw error;
    }
  }
}
