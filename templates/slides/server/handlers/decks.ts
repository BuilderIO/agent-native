import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  createEventStream,
} from "h3";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db";
import { readBody } from "@agent-native/core/server";

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
 * Broadcast a deck change to all connected UI clients. Exported so agent
 * actions (add-slide, update-slide, create-deck) can notify the frontend
 * after a direct DB write — otherwise the UI has no way to know the deck
 * was modified until the next 3-second poll, and won't notice content
 * changes to slides inside an existing deck at all.
 */
export function notifyClients(deckId: string, type = "deck-changed") {
  const message = JSON.stringify({ type, deckId });
  if (process.env.DEBUG_SLIDES_SSE) {
    console.log(
      `[slides-sse] notifyClients deck=${deckId} type=${type} clients=${sseClients.size}`,
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

// SSE endpoint — client subscribes for real-time change notifications
export const deckEvents = defineEventHandler((event) => {
  const eventStream = createEventStream(event);

  // Send initial connected event
  eventStream.push(JSON.stringify({ type: "connected" }));

  // Register this client's push function
  const push: SSEPush = (data: string) => {
    eventStream.push(data);
  };
  sseClients.add(push);

  eventStream.onClosed(() => {
    sseClients.delete(push);
  });

  return eventStream.send();
});

// GET /api/decks — list all decks
export const listDecks = defineEventHandler(async (_event) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.decks)
    .orderBy(desc(schema.decks.updatedAt));

  return rows.map((row) => {
    let deck: Record<string, unknown> = {};
    try {
      if (row.data) deck = JSON.parse(row.data);
    } catch {}
    return {
      ...deck,
      id: row.id,
      title: row.title,
      visibility: row.visibility,
      slides: deck.slides || [],
    };
  });
});

// GET /api/decks/:id — get a specific deck
export const getDeck = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.decks)
    .where(eq(schema.decks.id, id))
    .limit(1);

  if (rows.length > 0) {
    const deck = JSON.parse(rows[0].data);
    return {
      ...deck,
      id: rows[0].id,
      title: rows[0].title,
      visibility: rows[0].visibility,
    };
  }

  setResponseStatus(event, 404);
  return { error: "Deck not found" };
});

// PUT /api/decks/:id — create or update a deck
export const updateDeck = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }
  const deck = await readBody(event);

  if (!deck || typeof deck !== "object") {
    setResponseStatus(event, 400);
    return { error: "Invalid deck data" };
  }

  deck.id = id;
  deck.updatedAt = new Date().toISOString();

  const db = getDb();
  const title = deck.title || "Untitled";
  const now = new Date().toISOString();

  await db
    .insert(schema.decks)
    .values({
      id,
      title,
      data: JSON.stringify(deck),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.decks.id,
      set: {
        title,
        data: JSON.stringify(deck),
        updatedAt: now,
      },
    });

  notifyClients(id);
  return deck;
});

// POST /api/decks — create a new deck
export const createDeck = defineEventHandler(async (event) => {
  const deck = await readBody(event);

  if (!deck || !deck.id) {
    setResponseStatus(event, 400);
    return { error: "Deck must have an id" };
  }

  deck.createdAt = deck.createdAt || new Date().toISOString();
  deck.updatedAt = new Date().toISOString();

  const db = getDb();
  const now = new Date().toISOString();

  await db.insert(schema.decks).values({
    id: deck.id,
    title: deck.title || "Untitled",
    data: JSON.stringify(deck),
    createdAt: now,
    updatedAt: now,
  });

  setResponseStatus(event, 201);
  notifyClients(deck.id);
  return deck;
});

// DELETE /api/decks/:id — delete a deck
export const deleteDeck = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  const db = getDb();
  const result = await db
    .delete(schema.decks)
    .where(eq(schema.decks.id, id))
    .returning();

  if (result.length > 0) {
    notifyClients(id, "deck-deleted");
    return { success: true };
  } else {
    setResponseStatus(event, 404);
    return { error: "Deck not found" };
  }
});
