import { recordChange } from "@agent-native/core/server/poll";
import { getRequestRunContext } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { defineEventHandler, setResponseStatus, createEventStream } from "h3";

import { getDb, schema } from "../db/index.js";
import { resolveSlidesRequestAuth } from "./request-auth-context.js";

type SSEPush = (data: string) => void;
type SSEClient = {
  push: SSEPush;
  email: string;
  orgId?: string;
};

const GLOBAL_KEY = "__slidesSSEClients" as const;
type GlobalWithClients = typeof globalThis & {
  [GLOBAL_KEY]?: Set<SSEClient>;
};
const globalRef = globalThis as GlobalWithClients;
const sseClients: Set<SSEClient> = (globalRef[GLOBAL_KEY] ??= new Set());

export interface NotifyClientsOptions {
  type?: string;
  slideId?: string;
  actor?: "agent" | "human";
  agentChangeId?: string;
  owner?: string;
  orgId?: string;
  visibility?: "public";
}

async function resolveDeckChangeScope(
  deckId: string,
): Promise<Pick<NotifyClientsOptions, "owner" | "orgId" | "visibility">> {
  try {
    const rows = await getDb()
      .select({
        ownerEmail: schema.decks.ownerEmail,
        orgId: schema.decks.orgId,
        visibility: schema.decks.visibility,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId));
    const row = rows[0];
    if (!row) return {};
    return {
      owner: row.ownerEmail,
      ...(row.orgId ? { orgId: row.orgId } : {}),
      ...(row.visibility === "public" ? { visibility: "public" as const } : {}),
    };
  } catch (err) {
    console.error(
      `[slides] notifyClients: failed to resolve owner scope for deck ${deckId}`,
      err,
    );
    return {};
  }
}

function matchesDeletedAudience(
  client: SSEClient,
  scope: Pick<NotifyClientsOptions, "owner" | "orgId" | "visibility">,
): boolean {
  return (
    scope.visibility === "public" ||
    (typeof scope.owner === "string" &&
      client.email.trim().toLowerCase() === scope.owner.trim().toLowerCase()) ||
    (typeof scope.orgId === "string" && client.orgId === scope.orgId)
  );
}

export async function notifyClients(
  deckId: string,
  typeOrOptions: string | NotifyClientsOptions = "deck-changed",
): Promise<void> {
  const options: NotifyClientsOptions =
    typeof typeOrOptions === "string" ? { type: typeOrOptions } : typeOrOptions;
  const type = options.type ?? "deck-changed";
  const payload: Record<string, unknown> = { type, deckId };
  if (options.slideId) payload.slideId = options.slideId;
  if (options.actor) payload.actor = options.actor;
  if (options.agentChangeId) payload.agentChangeId = options.agentChangeId;
  const message = JSON.stringify(payload);
  const hasExplicitScope = Boolean(
    options.owner || options.orgId || options.visibility,
  );
  const scope = hasExplicitScope
    ? {
        ...(options.owner ? { owner: options.owner } : {}),
        ...(options.orgId ? { orgId: options.orgId } : {}),
        ...(options.visibility ? { visibility: options.visibility } : {}),
      }
    : await resolveDeckChangeScope(deckId);
  // The writing tab's id lets other viewers tell a collaborator's save or
  // deletion from their own echo; clients wake on the former only.
  const requestSource = getRequestRunContext()?.browserTabId;
  recordChange({
    source: "deck",
    type,
    key: deckId,
    resourceType: "deck",
    resourceId: deckId,
    ...(requestSource ? { requestSource } : {}),
    ...scope,
    ...payload,
  });
  if (process.env.DEBUG_SLIDES_SSE) {
    console.log(
      `[slides-sse] notifyClients deck=${deckId} type=${type} slide=${options.slideId ?? "-"} actor=${options.actor ?? "-"} clients=${sseClients.size}`,
    );
  }
  // A deleted deck has no row to check access against, so tombstones go to the
  // audience captured before the delete.
  const isDeletedTombstone = type === "deck-deleted" && hasExplicitScope;
  await Promise.all(
    [...sseClients].map(async (client) => {
      try {
        const canReceive = isDeletedTombstone
          ? matchesDeletedAudience(client, scope)
          : Boolean(
              await resolveAccess("deck", deckId, {
                userEmail: client.email,
                ...(client.orgId ? { orgId: client.orgId } : {}),
              }),
            );
        if (canReceive) client.push(message);
      } catch (err) {
        console.error(
          `[slides] notifyClients: failed to resolve deck access for deck ${deckId}`,
          err,
        );
      }
    }),
  );
}

export const deckEvents = defineEventHandler(async (event) => {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  if (!auth.context.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  const eventStream = createEventStream(event);

  void eventStream.push(JSON.stringify({ type: "connected" }));

  const client: SSEClient = {
    email: auth.context.email,
    ...(auth.context.orgId ? { orgId: auth.context.orgId } : {}),
    push: (data: string) => {
      void eventStream.push(data);
    },
  };
  sseClients.add(client);

  eventStream.onClosed(() => {
    sseClients.delete(client);
  });

  return eventStream.send();
});
