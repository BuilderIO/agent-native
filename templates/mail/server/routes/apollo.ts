import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

// Store Apollo API key in application-state/ (gitignored), NOT in data/settings.json
const STATE_DIR = path.join(process.cwd(), "application-state");
const APOLLO_FILE = path.join(STATE_DIR, "apollo.json");

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function getApolloKey(): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(APOLLO_FILE, "utf-8"));
    return data.apiKey || undefined;
  } catch {
    return undefined;
  }
}

// GET /api/apollo/status — check if key is configured (never returns the key itself)
export function apolloStatus(_req: Request, res: Response) {
  res.json({ connected: !!getApolloKey() });
}

// PUT /api/apollo/key — save API key
export function apolloSaveKey(req: Request, res: Response) {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== "string") {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }
  ensureStateDir();
  fs.writeFileSync(APOLLO_FILE, JSON.stringify({ apiKey }, null, 2));
  res.json({ connected: true });
}

// DELETE /api/apollo/key — remove API key
export function apolloDeleteKey(_req: Request, res: Response) {
  try {
    fs.unlinkSync(APOLLO_FILE);
  } catch {
    // didn't exist
  }
  res.json({ connected: false });
}

// In-memory cache for Apollo person lookups — avoids redundant API calls
// when flipping through emails from the same person.
const personCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// GET /api/apollo/person?email=... — look up a person
export async function apolloPersonLookup(req: Request, res: Response) {
  const { email } = req.query;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email query param required" });
    return;
  }

  const apiKey = getApolloKey();
  if (!apiKey) {
    res.status(401).json({ error: "Apollo API key not configured" });
    return;
  }

  // Return cached result if still fresh
  const cached = personCache.get(email);
  if (cached && cached.expiry > Date.now()) {
    res.json(cached.data);
    return;
  }

  try {
    const response = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      res
        .status(response.status)
        .json({ error: `Apollo API error: ${response.status}` });
      return;
    }

    const data = await response.json();
    const person = data.person || null;

    // Cache the result
    personCache.set(email, { data: person, expiry: Date.now() + CACHE_TTL });

    res.json(person);
  } catch {
    res.status(500).json({ error: "Failed to reach Apollo API" });
  }
}
