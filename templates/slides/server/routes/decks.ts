import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  createEventStream,
} from "h3";
import fs from "fs";
import path from "path";

const DECKS_DIR = path.join(process.cwd(), "data", "decks");

// Ensure the directory exists
function ensureDecksDir() {
  if (!fs.existsSync(DECKS_DIR)) {
    fs.mkdirSync(DECKS_DIR, { recursive: true });
  }
}

ensureDecksDir();

function getDeckFilePath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DECKS_DIR, `${safeId}.json`);
}

function readDeckFile(id: string): any | null {
  const filePath = getDeckFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeDeckFile(id: string, deck: any): void {
  ensureDecksDir();
  const filePath = getDeckFilePath(id);
  fs.writeFileSync(filePath, JSON.stringify(deck, null, 2), "utf-8");
}

function deleteDeckFile(id: string): boolean {
  const filePath = getDeckFilePath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function listAllDecks(): any[] {
  ensureDecksDir();
  const files = fs.readdirSync(DECKS_DIR).filter((f) => f.endsWith(".json"));
  const decks: any[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(DECKS_DIR, file), "utf-8");
      decks.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }
  return decks;
}

// --- SSE for file change notifications ---
// When the agent edits a JSON file directly, the frontend gets notified
type SSEPush = (data: string) => void;
const sseClients = new Set<SSEPush>();

// Watch the decks directory for changes
let fsWatcher: fs.FSWatcher | null = null;
function startWatching() {
  ensureDecksDir();
  try {
    fsWatcher = fs.watch(DECKS_DIR, (eventType, filename) => {
      if (!filename || !filename.endsWith(".json")) return;
      const deckId = filename.replace(".json", "");
      // Skip SSE notification if this write came from the API (frontend save)
      if (recentAPISaves.has(deckId)) return;
      // Notify all SSE clients (external/agent file edits only)
      const message = JSON.stringify({ type: "deck-changed", deckId });
      for (const push of sseClients) {
        try {
          push(message);
        } catch {
          sseClients.delete(push);
        }
      }
    });
  } catch (err) {
    console.error("[decks] Failed to watch directory:", err);
  }
}
startWatching();

// Track which saves came from the API (to avoid notifying the client that just saved)
const recentAPISaves = new Map<string, number>();

// SSE endpoint — client subscribes for real-time file change notifications
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
export const listDecks = defineEventHandler((_event) => {
  const decks = listAllDecks();
  // Sort by updatedAt desc
  decks.sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return decks;
});

// GET /api/decks/:id — get a specific deck
export const getDeck = defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }
  const deck = readDeckFile(id);
  if (deck) {
    return deck;
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

  // Mark this as an API save so the file watcher doesn't echo it back
  recentAPISaves.set(id, Date.now());
  setTimeout(() => recentAPISaves.delete(id), 2000);

  writeDeckFile(id, deck);
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

  writeDeckFile(deck.id, deck);
  setResponseStatus(event, 201);
  return deck;
});

// DELETE /api/decks/:id — delete a deck
export const deleteDeck = defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Deck id is required" };
  }

  const deleted = deleteDeckFile(id);
  if (deleted) {
    return { success: true };
  } else {
    setResponseStatus(event, 404);
    return { error: "Deck not found" };
  }
});
