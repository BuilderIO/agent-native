import { recordChange } from "@agent-native/core/server/poll";
import { eq } from "drizzle-orm";
import { defineEventHandler, setResponseStatus, createEventStream } from "h3";

import { getDb, schema } from "../db/index.js";
import { resolveSlidesRequestAuth } from "./request-auth-context.js";

type SSEPush = (data: string) => void;

const GLOBAL_KEY = "__slidesSSEClients" as const;
type GlobalWithClients = typeof globalThis & {
  [GLOBAL_KEY]?: Set<SSEPush>;
};
const globalRef = globalThis as GlobalWithClients;
if (!globalRef[GLOBAL_KEY]) {
  globalRef[GLOBAL_KEY] = new Set<SSEPush>();
}
const sseClients: Set<SSEPush> = globalRef[GLOBAL_KEY]!;

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
  const scope =
    options.owner || options.orgId || options.visibility
      ? {
          ...(options.owner ? { owner: options.owner } : {}),
          ...(options.orgId ? { orgId: options.orgId } : {}),
          ...(options.visibility ? { visibility: options.visibility } : {}),
        }
      : await resolveDeckChangeScope(deckId);
  recordChange({
    source: "deck",
    type,
    key: deckId,
    resourceType: "deck",
    resourceId: deckId,
    ...scope,
    ...payload,
  });
  if (process.env.DEBUG_SLIDES_SSE) {
    console.log(
      `[slides-sse] notifyClients deck=${deckId} type=${type} slide=${options.slideId ?? "-"} actor=${options.actor ?? "-"} clients=${sseClients.size}`,
    );
  }
  for (const push of sseClients) {
    try {
      push(message);
    } catch {
      sseClients.delete(push);
    }
  }
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

  const push: SSEPush = (data: string) => {
    void eventStream.push(data);
  };
  sseClients.add(push);

  eventStream.onClosed(() => {
    sseClients.delete(push);
  });

  return eventStream.send();
});
