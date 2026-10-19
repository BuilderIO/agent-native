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
if (!globalRef[GLOBAL_KEY]) {
  globalRef[GLOBAL_KEY] = new Set<SSEClient>();
}
const sseClients: Set<SSEClient> = globalRef[GLOBAL_KEY]!;

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
): Promise<Pick<
  NotifyClientsOptions,
  "owner" | "orgId" | "visibility"
> | null> {
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
    if (!row || typeof row.ownerEmail !== "string" || !row.ownerEmail.trim()) {
      return null;
    }
    return {
      owner: row.ownerEmail.trim(),
      ...(row.orgId ? { orgId: row.orgId } : {}),
      ...(row.visibility === "public" ? { visibility: "public" as const } : {}),
    };
  } catch (err) {
    console.error(
      `[slides] notifyClients: failed to resolve owner scope for deck ${deckId}`,
      err,
    );
    return null;
  }
}

function hasExplicitScope(options: NotifyClientsOptions): boolean {
  return (
    options.owner !== undefined ||
    options.orgId !== undefined ||
    options.visibility !== undefined
  );
}

function explicitScope(
  options: NotifyClientsOptions,
): Pick<NotifyClientsOptions, "owner" | "orgId" | "visibility"> | null {
  const scope = {
    ...(options.owner?.trim() ? { owner: options.owner.trim() } : {}),
    ...(options.orgId?.trim() ? { orgId: options.orgId.trim() } : {}),
    ...(options.visibility === "public"
      ? { visibility: "public" as const }
      : {}),
  };
  return Object.keys(scope).length > 0 ? scope : null;
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
  const hasScopeOverride = hasExplicitScope(options);
  const scope = hasScopeOverride
    ? explicitScope(options)
    : await resolveDeckChangeScope(deckId);
  if (!scope) return;

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
  const isDeletedTombstone = type === "deck-deleted" && hasScopeOverride;
  await Promise.all(
    [...sseClients].map(async (client) => {
      try {
        const canReceive = isDeletedTombstone
          ? matchesDeletedAudience(client, scope)
          : Boolean(
              await resolveAccess("deck", deckId, {
                userEmail: client.email,
                orgId: client.orgId,
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
