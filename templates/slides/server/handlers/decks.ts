import { readBody } from "@agent-native/core/server";
import {
  accessFilter,
  resolveAccess,
  assertAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
import { and, eq, desc } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  createEventStream,
} from "h3";

import { ASPECT_RATIO_VALUES } from "../../shared/aspect-ratios.js";
import { getDb, schema } from "../db";
import { createDeckVersionSnapshot } from "../lib/deck-versions.js";
import {
  resolveSlidesRequestAuthContext,
  withSlidesRequestContext,
} from "./request-auth-context.js";

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

function comparableDeckData(raw: unknown): string {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const clone = JSON.parse(JSON.stringify(data ?? {}));
    delete clone.updatedAt;
    return JSON.stringify(clone);
  } catch {
    return String(raw ?? "");
  }
}

function shouldSnapshotDeckWrite(
  current: { title?: string | null; data?: string | null },
  nextTitle: string,
  nextDeck: Record<string, unknown>,
): boolean {
  return (
    (current.title ?? "Untitled") !== nextTitle ||
    comparableDeckData(current.data ?? "") !== comparableDeckData(nextDeck)
  );
}

// SSE endpoint — client subscribes for real-time change notifications.
// Per-deckId notifications carry only the id, no row contents, so we don't
// gate this — but we do require an authenticated session so anonymous
// callers can't tail the stream. (The agent path runs server-side and is
// not affected.)
export const deckEvents = defineEventHandler(async (event) => {
  const session = await resolveSlidesRequestAuthContext(event);
  if (!session.email) {
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
  return withSlidesRequestContext(event, async ({ email }) => {
    // Without an authenticated email, `accessFilter` would short-circuit to
    // `1=0` and return a 200/[] response — indistinguishable to the client
    // from "this user genuinely has no decks." That fires the deck-list
    // fallback poll's wipe-on-empty path and bounces the user out of the
    // editor. Returning 401 lets the client preserve local state until the
    // session is restored.
    if (!email) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }
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
        createdByMe: row.ownerEmail === email,
        designSystemId: row.designSystemId ?? deck.designSystemId ?? null,
        updatedAt: row.updatedAt,
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

  return withSlidesRequestContext(event, async ({ email }) => {
    try {
      const access = await assertAccess("deck", id, "viewer");
      const row = access.resource;
      const deck = JSON.parse(row.data);
      return {
        ...deck,
        id: row.id,
        title: row.title,
        visibility: row.visibility,
        createdByMe: row.ownerEmail === email,
        designSystemId: row.designSystemId ?? deck.designSystemId ?? null,
        updatedAt: row.updatedAt,
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

  return withSlidesRequestContext(event, async ({ email, orgId }) => {
    const db = getDb();
    const now = new Date().toISOString();

    deck.id = id;
    deck.updatedAt = now;
    const title = deck.title || "Untitled";
    const nextDesignSystemId =
      typeof deck.designSystemId === "string" && deck.designSystemId
        ? deck.designSystemId
        : null;

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
      if (nextDesignSystemId) {
        try {
          await assertAccess("design-system", nextDesignSystemId, "viewer");
        } catch (err) {
          if (err instanceof ForbiddenError) {
            setResponseStatus(event, 400);
            return { error: "Design system not accessible" };
          }
          throw err;
        }
      }
      try {
        await db.insert(schema.decks).values({
          id,
          title,
          data: JSON.stringify(deck),
          designSystemId: nextDesignSystemId,
          ownerEmail: email,
          orgId: orgId ?? null,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // The common case is a primary-key collision with a deck the caller
        // cannot access. Some DB adapters wrap duplicate-key failures in a
        // generic query error that includes bound params, so never surface the
        // raw error here.
        setResponseStatus(event, 404);
        return { error: "Deck not found" };
      }
    } else if (
      access.role === "owner" ||
      access.role === "admin" ||
      access.role === "editor"
    ) {
      if (nextDesignSystemId) {
        try {
          await assertAccess("design-system", nextDesignSystemId, "viewer");
        } catch (err) {
          if (err instanceof ForbiddenError) {
            setResponseStatus(event, 400);
            return { error: "Design system not accessible" };
          }
          throw err;
        }
      }
      // Caller has editor+ access — perform the update. The access check
      // above already confirmed the row exists and the caller can write.
      if (shouldSnapshotDeckWrite(access.resource, title, deck)) {
        await createDeckVersionSnapshot(
          {
            id: access.resource.id,
            title: access.resource.title,
            data: access.resource.data,
            ownerEmail: access.resource.ownerEmail as string,
          },
          { label: "Before editor save" },
        );
      }
      await db
        .update(schema.decks)
        .set({
          title,
          data: JSON.stringify(deck),
          designSystemId: nextDesignSystemId ?? access.resource.designSystemId,
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

  return withSlidesRequestContext(event, async ({ email, orgId }) => {
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
    const designSystemId =
      typeof deck.designSystemId === "string" && deck.designSystemId
        ? deck.designSystemId
        : null;

    if (designSystemId) {
      try {
        await assertAccess("design-system", designSystemId, "viewer");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 400);
          return { error: "Design system not accessible" };
        }
        throw err;
      }
    }

    await db.insert(schema.decks).values({
      id: deck.id,
      title: deck.title || "Untitled",
      data: JSON.stringify(deck),
      designSystemId,
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

  return withSlidesRequestContext(event, async () => {
    try {
      // assertAccess loads the row and verifies the caller has admin
      // role on this resource — it must run BEFORE the delete (and in
      // the same scope) so we don't leak existence to callers who lack
      // access.
      const access = await assertAccess("deck", id, "admin");
      const db = getDb();
      await db
        .delete(schema.deckVersions)
        .where(
          and(
            eq(schema.deckVersions.deckId, id),
            eq(
              schema.deckVersions.ownerEmail,
              access.resource.ownerEmail as string,
            ),
          ),
        );
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
