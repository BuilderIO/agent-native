import { recordChange } from "@agent-native/core/server/poll";
import { eq } from "drizzle-orm";
import { defineEventHandler, setResponseStatus, createEventStream } from "h3";

import { getDb, schema } from "../db/index.js";
import { resolveSlidesRequestAuth } from "./request-auth-context.js";

// --- SSE for change notifications ---
type SSEPush = (data: string) => void;

// CRITICAL: pin the client registry to globalThis.
//
// In Nitro dev mode, server route files (events.get.ts) are loaded by
// vite-node/Rollup, while action files are loaded by autoDiscoverActions via
// plain `await import(absolutePath)`. These two loaders produce SEPARATE
// module instances of this file — a module-level `new Set()` would give the
// SSE route and the actions two different Sets, so broadcasts from actions
// would never reach connected clients. Pinning to globalThis forces a single
// shared registry regardless of how this module was loaded.
const GLOBAL_KEY = "__slidesSSEClients" as const;
type GlobalWithClients = typeof globalThis & {
  [GLOBAL_KEY]?: Set<SSEPush>;
};
const globalRef = globalThis as GlobalWithClients;
if (!globalRef[GLOBAL_KEY]) {
  globalRef[GLOBAL_KEY] = new Set<SSEPush>();
}
const sseClients: Set<SSEPush> = globalRef[GLOBAL_KEY]!;

/**
 * Options for a deck-change broadcast. All fields are optional and additive so
 * existing consumers that only read `{ type, deckId }` keep working.
 */
export interface NotifyClientsOptions {
  /** SSE event type — defaults to "deck-changed". */
  type?: string;
  /** The specific slide that changed, when known (agent slide edits). */
  slideId?: string;
  /** Who made the change: "agent" for AI writes, "human" otherwise. */
  actor?: "agent" | "human";
  /** Groups multiple notifications emitted by one agent turn. */
  agentChangeId?: string;
  /** Per-user scope for access-aware events whose resource may be gone. */
  owner?: string;
  orgId?: string;
  /** Public-resource scope for events whose resource may be gone. */
  visibility?: "public";
}

/**
 * Look up the deck's owner/org/visibility for the poll service's owned/org
 * fast path (see `canSeeChangeForUser` in packages/core/src/server/poll.ts).
 * Without these, an unowned "deck" change only carries resourceType +
 * resourceId, so the access-aware branch treats every viewer — including the
 * deck's own owner — as a cache miss on their first event: it returns
 * "pending" and holds the cursor back until the next 60s fallback poll.
 * Best-effort: on any DB error (or a since-deleted deck) fall back to an
 * unscoped event rather than blocking or failing the broadcast.
 */
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

/**
 * Broadcast a deck change to all connected UI clients. Exported so agent
 * actions (add-slide, update-slide, create-deck) can notify the frontend
 * after a direct DB write — otherwise the UI has no way to know the deck
 * was modified until the next 3-second poll, and won't notice content
 * changes to slides inside an existing deck at all.
 *
 * The second argument accepts either a legacy `type` string (backwards compat
 * with callers like `notifyClients(id, "deck-deleted")`) or an options object
 * carrying `slideId` / `actor` so the client can attribute agent edits to a
 * specific slide. The wire payload always includes `type` and `deckId`; extra
 * fields are only present when supplied.
 *
 * Callers that already know the event's owner/org/visibility scope (e.g.
 * `delete-deck`'s per-recipient fanout) should keep passing it explicitly —
 * that skips the lookup below entirely. Every other caller only knows the
 * deckId, so this resolves the scope from the deck row itself (one query,
 * one place) instead of requiring all 14+ call sites to look it up.
 */
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
  // Publish the same notification through Core's shared sync stream so the
  // client does not need a second deck-specific SSE connection. Keep the
  // legacy in-process stream below for older clients and external consumers.
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

// SSE endpoint — client subscribes for real-time change notifications.
// Per-deckId notifications carry only the id, no row contents, so we don't
// gate this — but we do require an authenticated session so anonymous
// callers can't tail the stream. (The agent path runs server-side and is
// not affected.)
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

  // Send initial connected event
  void eventStream.push(JSON.stringify({ type: "connected" }));

  // Register this client's push function
  const push: SSEPush = (data: string) => {
    void eventStream.push(data);
  };
  sseClients.add(push);

  eventStream.onClosed(() => {
    sseClients.delete(push);
  });

  return eventStream.send();
});
