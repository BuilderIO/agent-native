import { Router, Request, Response } from "express";
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
const sseClients = new Set<Response>();

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
      for (const client of sseClients) {
        try {
          client.write(`data: ${JSON.stringify({ type: "deck-changed", deckId })}\n\n`);
        } catch {
          sseClients.delete(client);
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

export const decksRouter = Router();

// SSE endpoint — client subscribes for real-time file change notifications
decksRouter.get("/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");

  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
});

// GET /api/decks — list all decks
decksRouter.get("/", (_req: Request, res: Response) => {
  const decks = listAllDecks();
  // Sort by updatedAt desc
  decks.sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  res.json(decks);
});

// GET /api/decks/:id — get a specific deck
decksRouter.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const deck = readDeckFile(id);
  if (deck) {
    res.json(deck);
    return;
  }
  res.status(404).json({ error: "Deck not found" });
});

// PUT /api/decks/:id — create or update a deck
decksRouter.put("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const deck = req.body;

  if (!deck || typeof deck !== "object") {
    res.status(400).json({ error: "Invalid deck data" });
    return;
  }

  deck.id = id;
  deck.updatedAt = new Date().toISOString();

  // Mark this as an API save so the file watcher doesn't echo it back
  recentAPISaves.set(id, Date.now());
  setTimeout(() => recentAPISaves.delete(id), 2000);

  writeDeckFile(id, deck);
  res.json(deck);
});

// POST /api/decks — create a new deck
decksRouter.post("/", (req: Request, res: Response) => {
  const deck = req.body;

  if (!deck || !deck.id) {
    res.status(400).json({ error: "Deck must have an id" });
    return;
  }

  deck.createdAt = deck.createdAt || new Date().toISOString();
  deck.updatedAt = new Date().toISOString();

  writeDeckFile(deck.id, deck);
  res.status(201).json(deck);
});

// DELETE /api/decks/:id — delete a deck
decksRouter.delete("/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  const deleted = deleteDeckFile(id);
  if (deleted) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Deck not found" });
  }
});
