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

// --- Multi-draft compose ---

function composeFile(id: string): string {
  return path.join(STATE_DIR, `compose-${safeKey(id)}.json`);
}

/** GET /api/application-state/compose — list all drafts */
export function listComposeDrafts(_req: Request, res: Response) {
  ensureStateDir();
  try {
    const files = fs
      .readdirSync(STATE_DIR)
      .filter((f) => f.startsWith("compose-") && f.endsWith(".json"));
    const drafts = files
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf-8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    res.json(drafts);
  } catch {
    res.json([]);
  }
}

/** GET /api/application-state/compose/:id — get single draft */
export function getComposeDraft(req: Request, res: Response) {
  const id = req.params.id as string;
  const file = composeFile(id);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    res.json(data);
  } catch {
    res.status(404).json({ error: "Draft not found" });
  }
}

/** PUT /api/application-state/compose/:id — create or update draft */
export function putComposeDraft(req: Request, res: Response) {
  const id = req.params.id as string;
  const { to, cc, bcc, subject, body, mode, replyToId, replyToThreadId } =
    req.body;

  if (typeof subject !== "string" || typeof body !== "string") {
    res.status(400).json({ error: "subject and body are required strings" });
    return;
  }

  ensureStateDir();

  const state = {
    id,
    to: to ?? "",
    cc: cc ?? "",
    bcc: bcc ?? "",
    subject,
    body,
    mode: mode ?? "compose",
    ...(replyToId ? { replyToId } : {}),
    ...(replyToThreadId ? { replyToThreadId } : {}),
  };

  fs.writeFileSync(composeFile(id), JSON.stringify(state, null, 2));
  res.json(state);
}

/** DELETE /api/application-state/compose/:id — delete single draft */
export function deleteComposeDraft(req: Request, res: Response) {
  const id = req.params.id as string;
  try {
    fs.unlinkSync(composeFile(id));
  } catch {
    // File didn't exist — fine
  }
  res.json({ ok: true });
}

/** DELETE /api/application-state/compose — delete ALL drafts */
export function deleteAllComposeDrafts(_req: Request, res: Response) {
  ensureStateDir();
  try {
    const files = fs
      .readdirSync(STATE_DIR)
      .filter((f) => f.startsWith("compose-") && f.endsWith(".json"));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(STATE_DIR, f));
      } catch {}
    }
  } catch {}
  res.json({ ok: true });
}
