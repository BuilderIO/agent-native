import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

const STATE_DIR = path.join(process.cwd(), "application-state");

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "");
}

// --- Generic state helpers ---

export function getState(req: Request, res: Response) {
  const key = safeKey(String(req.params.key));
  const file = path.join(STATE_DIR, `${key}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    res.json(data);
  } catch {
    res.status(404).json({ error: `No state for ${key}` });
  }
}

export function putState(req: Request, res: Response) {
  const key = safeKey(String(req.params.key));
  const file = path.join(STATE_DIR, `${key}.json`);
  ensureStateDir();
  fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
  res.json(req.body);
}

export function deleteState(req: Request, res: Response) {
  const key = safeKey(String(req.params.key));
  const file = path.join(STATE_DIR, `${key}.json`);
  try {
    fs.unlinkSync(file);
  } catch {
    // File didn't exist — that's fine
  }
  res.json({ ok: true });
}

// --- Compose state (with validation) ---

const COMPOSE_FILE = path.join(STATE_DIR, "compose.json");

export function getComposeState(_req: Request, res: Response) {
  try {
    const data = JSON.parse(fs.readFileSync(COMPOSE_FILE, "utf-8"));
    res.json(data);
  } catch {
    res.status(404).json({ error: "No compose state" });
  }
}

export function putComposeState(req: Request, res: Response) {
  const { to, cc, bcc, subject, body, mode, replyToId, replyToThreadId } =
    req.body;

  if (typeof subject !== "string" || typeof body !== "string") {
    res.status(400).json({ error: "subject and body are required strings" });
    return;
  }

  ensureStateDir();

  const state = {
    to: to ?? "",
    cc: cc ?? "",
    bcc: bcc ?? "",
    subject,
    body,
    mode: mode ?? "compose",
    ...(replyToId ? { replyToId } : {}),
    ...(replyToThreadId ? { replyToThreadId } : {}),
  };

  fs.writeFileSync(COMPOSE_FILE, JSON.stringify(state, null, 2));
  res.json(state);
}

export function deleteComposeState(_req: Request, res: Response) {
  try {
    fs.unlinkSync(COMPOSE_FILE);
  } catch {
    // File didn't exist — that's fine
  }
  res.json({ ok: true });
}
