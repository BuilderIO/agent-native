import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  createEventStream,
} from "h3";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
  readBody,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  accessFilter,
  resolveAccess,
  assertAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
import { ASPECT_RATIO_VALUES } from "../../shared/aspect-ratios.js";

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

/**
 * Resolve the caller's auth context from the request and run `fn` inside a
 * `runWithRequestContext` scope so `accessFilter` / `resolveAccess` /
 * `assertAccess` can read it. ALL `/api/decks/*` handlers MUST go through
 * this — querying ownable tables without a request context is how data
 * leaks across users (see #SLI-2026-04-28).
 */
async function withAuth<T>(
  event: any,
  fn: (session: { email?: string; orgId?: string }) => Promise<T>,
): Promise<T> {
  const session = await getSession(event).catch(() => null);
  const ctx = {
    userEmail: session?.email,
    orgId: session?.orgId,
  };
  return runWithRequestContext(ctx, () =>
    fn({ email: ctx.userEmail, orgId: ctx.orgId }),
  );
}

function handleForbidden(event: any, err: unknown): { error: string } {
  if (err instanceof ForbiddenError) {
    setResponseStatus(event, err.statusCode);
    return { error: err.message };
  }
  throw err;
}

function validateDeckAspectRatio(
  event: any,
  deck: Record<string, any>,
): boolean {
  if (
    "aspectRatio" in deck &&
    !ASPECT_RATIO_VALUES.includes(deck.aspectRatio)
  ) {
    setResponseStatus(event, 400);
    return false;
  }
  return true;
}

// SSE endpoint — client subscribes for real-time change notifications.
// Per-deckId notifications carry only the id, no row contents, so we don't
// gate this — but we do require an authenticated session so anonymous
// callers can't tail the stream. (The agent path runs server-side and is
// not affected.)
export const deckEvents = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
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

// GET /api/decks — list decks the caller can see (own + shared + visibility match)
export const listDecks = defineEventHandler(async (event) => {
  return withAuth(event, async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.decks)
      .where(accessFilter(schema.decks, schema.deckShares))
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
});

// GET /api/decks/:id — get a specific deck (caller must have viewer+ access)
export const getDeck = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  return withAuth(event, async () => {
    try {
      const access = await assertAccess("deck", id, "viewer");
      const row = access.resource;
      const deck = JSON.parse(row.data);
      return {
        ...deck,
        id: row.id,
        title: row.title,
        visibility: row.visibility,
      };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        // Return 404 (not 403) so we don't leak the existence of decks
        // the caller has no access to.
        setResponseStatus(event, 404);
        return { error: "Deck not found" };
      }
      throw err;
    }
  });
});

// PUT /api/decks/:id — create or update a deck (must have editor+ access)
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
  if (!validateDeckAspectRatio(event, deck)) {
    return { error: "Invalid aspect ratio" };
  }

  return withAuth(event, async ({ email, orgId }) => {
    const db = getDb();
    const now = new Date().toISOString();

    deck.id = id;
    deck.updatedAt = now;
    const title = deck.title || "Untitled";

    // Resolve access first — this loads the row AND tells us the caller's
    // effective role in one pass, so we never run an unscoped existence
    // SELECT that would leak "this id exists" to non-owners.
    const access = await resolveAccess("deck", id);

    if (!access) {
      // Either the deck does not exist OR the caller cannot see it. In
      // both cases we treat this as a create-on-PUT for the caller. If
      // the row actually exists but is owned by someone else, the INSERT
      // below will fail on the primary key — we map that to a 404 so we
      // never reveal that the id is taken.
      if (!email) {
        return handleForbidden(
          event,
          new ForbiddenError("Sign in to create a deck"),
        );
      }
      try {
        await db.insert(schema.decks).values({
          id,
          title,
          data: JSON.stringify(deck),
          ownerEmail: email,
          orgId: orgId ?? null,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // Primary-key collision = the id is taken by a deck the caller
        // cannot see. Return 404 to match the read-side privacy contract.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          /unique|duplicate|primary key|UNIQUE constraint/i.test(msg) ||
          (err as { code?: string })?.code === "23505"
        ) {
          setResponseStatus(event, 404);
          return { error: "Deck not found" };
        }
        throw err;
      }
    } else if (
      access.role === "owner" ||
      access.role === "admin" ||
      access.role === "editor"
    ) {
      // Caller has editor+ access — perform the update. The access check
      // above already confirmed the row exists and the caller can write.
      await db
        .update(schema.decks)
        .set({
          title,
          data: JSON.stringify(deck),
          updatedAt: now,
        })
        .where(eq(schema.decks.id, id));
    } else {
      // Viewer-only access — same 404 as no-access to avoid leaking that
      // the deck exists with restricted permissions.
      setResponseStatus(event, 404);
      return { error: "Deck not found" };
    }

    notifyClients(id);
    return deck;
  });
});

// POST /api/decks — create a new deck owned by the caller
export const createDeck = defineEventHandler(async (event) => {
  const deck = await readBody(event);

  if (!deck || !deck.id) {
    setResponseStatus(event, 400);
    return { error: "Deck must have an id" };
  }
  if (!validateDeckAspectRatio(event, deck)) {
    return { error: "Invalid aspect ratio" };
  }

  return withAuth(event, async ({ email, orgId }) => {
    if (!email) {
      return handleForbidden(
        event,
        new ForbiddenError("Sign in to create a deck"),
      );
    }
    deck.createdAt = deck.createdAt || new Date().toISOString();
    deck.updatedAt = new Date().toISOString();

    const db = getDb();
    const now = new Date().toISOString();

    await db.insert(schema.decks).values({
      id: deck.id,
      title: deck.title || "Untitled",
      data: JSON.stringify(deck),
      ownerEmail: email,
      orgId: orgId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    setResponseStatus(event, 201);
    notifyClients(deck.id);
    return deck;
  });
});

// DELETE /api/decks/:id — delete a deck (admin or owner only)
export const deleteDeck = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  return withAuth(event, async () => {
    try {
      // assertAccess loads the row and verifies the caller has admin
      // role on this resource — it must run BEFORE the delete (and in
      // the same scope) so we don't leak existence to callers who lack
      // access.
      await assertAccess("deck", id, "admin");
      const db = getDb();
      const result = await db
        .delete(schema.decks)
        .where(eq(schema.decks.id, id))
        .returning();

      if (result.length > 0) {
        notifyClients(id, "deck-deleted");
        return { success: true };
      }
      setResponseStatus(event, 404);
      return { error: "Deck not found" };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        // 404 to avoid leaking existence
        setResponseStatus(event, 404);
        return { error: "Deck not found" };
      }
      throw err;
    }
  });
});
