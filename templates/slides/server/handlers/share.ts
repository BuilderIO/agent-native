import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import crypto from "crypto";
import { eq, lt } from "drizzle-orm";
import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { getDb, schema } from "../db";
import type {
  ShareDeckRequest,
  ShareDeckResponse,
  SharedDeckResponse,
} from "@shared/api";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * POST /api/share
 * Persist a deck snapshot with a random token.
 */
export const shareDeck = defineEventHandler(async (event) => {
  const body = await readBody<ShareDeckRequest>(event);
  const { deck } = body;

  if (!deck?.id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => createShareLink(event, deck.id),
  );
});

async function createShareLink(event: any, deckId: string) {
  const db = getDb();
  let storedDeck: any;
  let title = "Untitled";

  try {
    const access = await assertAccess("deck", deckId, "admin");
    title = access.resource.title ?? "Untitled";
    storedDeck = JSON.parse(access.resource.data);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.message };
    }
    throw err;
  }

  if (!Array.isArray(storedDeck?.slides) || storedDeck.slides.length === 0) {
    setResponseStatus(event, 400);
    return { error: "Deck with slides is required" };
  }

  const token = crypto.randomBytes(12).toString("base64url");
  const now = new Date().toISOString();

  const slides = storedDeck.slides.map((s: any) => ({
    id: s.id,
    content: s.content,
    notes: "", // never share speaker notes
    layout: s.layout,
    background: s.background,
  }));

  await db.insert(schema.deckShareLinks).values({
    token,
    title: title || storedDeck.title || "Untitled",
    slides: JSON.stringify(slides),
    aspectRatio: storedDeck.aspectRatio ?? null,
    createdAt: now,
  });

  // Prune expired rows opportunistically (no await — background)
  db.delete(schema.deckShareLinks)
    .where(
      lt(
        schema.deckShareLinks.createdAt,
        new Date(Date.now() - THIRTY_DAYS_MS).toISOString(),
      ),
    )
    .catch(() => {});

  const response: ShareDeckResponse = { shareToken: token };
  return response;
}

/**
 * GET /api/share/:token
 * Retrieve a shared deck by token.
 */
export const getSharedDeck = defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token");
  if (!token) {
    setResponseStatus(event, 400);
    return { error: "Token is required" };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.deckShareLinks)
    .where(eq(schema.deckShareLinks.token, token))
    .limit(1);

  const shared = rows[0];
  if (!shared) {
    setResponseStatus(event, 404);
    return { error: "Shared presentation not found or has expired" };
  }

  // Check expiry
  const age = Date.now() - new Date(shared.createdAt).getTime();
  if (age > THIRTY_DAYS_MS) {
    setResponseStatus(event, 404);
    return { error: "Shared presentation not found or has expired" };
  }

  const response: SharedDeckResponse = {
    title: shared.title,
    slides: JSON.parse(shared.slides),
    aspectRatio: shared.aspectRatio as SharedDeckResponse["aspectRatio"],
  };
  return response;
});
