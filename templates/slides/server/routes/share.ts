import { RequestHandler } from "express";
import crypto from "crypto";
import type {
  ShareDeckRequest,
  ShareDeckResponse,
  SharedDeckResponse,
} from "@shared/api";

// In-memory store for shared decks (persists as long as server runs)
// In production, this would use a database
const sharedDecks = new Map<
  string,
  { title: string; slides: any[]; createdAt: number }
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
export const shareDeck: RequestHandler = (req, res) => {
  const body = req.body as ShareDeckRequest;
  const { deck } = body;

  if (!deck || !deck.slides?.length) {
    res.status(400).json({ error: "Deck with slides is required" });
    return;
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
  });

  const response: ShareDeckResponse = { shareToken };
  res.json(response);
};

/**
 * GET /api/share/:token
 * Retrieve a shared deck by token
 */
export const getSharedDeck: RequestHandler = (req, res) => {
  const { token } = req.params;
  const shared = sharedDecks.get(token);

  if (!shared) {
    res
      .status(404)
      .json({ error: "Shared presentation not found or has expired" });
    return;
  }

  const response: SharedDeckResponse = {
    title: shared.title,
    slides: shared.slides,
  };
  res.json(response);
};
