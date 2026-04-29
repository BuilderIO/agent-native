import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import crypto from "crypto";
import { readBody } from "@agent-native/core/server";
import type {
  ShareDeckRequest,
  ShareDeckResponse,
  SharedDeckResponse,
} from "@shared/api";

// In-memory store for shared decks (persists as long as server runs)
// In production, this would use a database
const sharedDecks = new Map<
  string,
  {
    title: string;
    slides: any[];
    createdAt: number;
    aspectRatio?: SharedDeckResponse["aspectRatio"];
  }
>();

// Clean up old shared decks (older than 30 days)
function cleanupOldShares() {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [token, data] of sharedDecks.entries()) {
    if (now - data.createdAt > thirtyDaysMs) {
      sharedDecks.delete(token);
    }
  }
}

/**
 * POST /api/share
 * Store a deck snapshot and return a share token
 */
export const shareDeck = defineEventHandler(async (event) => {
  const body = await readBody<ShareDeckRequest>(event);
  const { deck } = body;

  if (!deck || !deck.slides?.length) {
    setResponseStatus(event, 400);
    return { error: "Deck with slides is required" };
  }

  cleanupOldShares();

  // Generate a unique share token
  const shareToken = crypto.randomBytes(12).toString("base64url");

  // Store a snapshot of the deck (without sensitive data)
  sharedDecks.set(shareToken, {
    title: deck.title,
    slides: deck.slides.map((s) => ({
      id: s.id,
      content: s.content,
      notes: "", // Don't share speaker notes
      layout: s.layout,
      background: s.background,
    })),
    createdAt: Date.now(),
    aspectRatio: (deck as any).aspectRatio,
  });

  const response: ShareDeckResponse = { shareToken };
  return response;
});

/**
 * GET /api/share/:token
 * Retrieve a shared deck by token
 */
export const getSharedDeck = defineEventHandler((event) => {
  const token = getRouterParam(event, "token");
  if (!token) {
    setResponseStatus(event, 400);
    return { error: "Token is required" };
  }
  const shared = sharedDecks.get(token);

  if (!shared) {
    setResponseStatus(event, 404);
    return { error: "Shared presentation not found or has expired" };
  }

  const response: SharedDeckResponse = {
    title: shared.title,
    slides: shared.slides,
    aspectRatio: shared.aspectRatio,
  };
  return response;
});
