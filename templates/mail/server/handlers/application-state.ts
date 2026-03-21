import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
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

export const getState = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  const file = path.join(STATE_DIR, `${key}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return data;
  } catch {
    setResponseStatus(event, 404);
    return { error: `No state for ${key}` };
  }
});

export const putState = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  const file = path.join(STATE_DIR, `${key}.json`);
  ensureStateDir();
  const body = await readBody(event);
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return body;
});

export const deleteState = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  const file = path.join(STATE_DIR, `${key}.json`);
  try {
    fs.unlinkSync(file);
  } catch {
    // File didn't exist — that's fine
  }
  return { ok: true };
});

// --- Multi-draft compose ---

function composeFile(id: string): string {
  return path.join(STATE_DIR, `compose-${safeKey(id)}.json`);
}

/** GET /api/application-state/compose — list all drafts */
export const listComposeDrafts = defineEventHandler((_event: H3Event) => {
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
    return drafts;
  } catch {
    return [];
  }
});

/** GET /api/application-state/compose/:id — get single draft */
export const getComposeDraft = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  const file = composeFile(id);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return data;
  } catch {
    setResponseStatus(event, 404);
    return { error: "Draft not found" };
  }
});

/** PUT /api/application-state/compose/:id — create or update draft */
export const putComposeDraft = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  const body = await readBody(event);
  const { subject, body: bodyText } = body;

  if (typeof subject !== "string" || typeof bodyText !== "string") {
    setResponseStatus(event, 400);
    return { error: "subject and body are required strings" };
  }

  ensureStateDir();

  // Persist the full draft state (including inline, accountEmail, attachments, etc.)
  const state = { ...body, id };

  fs.writeFileSync(composeFile(id), JSON.stringify(state, null, 2));
  return state;
});

/** DELETE /api/application-state/compose/:id — delete single draft */
export const deleteComposeDraft = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  try {
    fs.unlinkSync(composeFile(id));
  } catch {
    // File didn't exist — fine
  }
  return { ok: true };
});

/** DELETE /api/application-state/compose — delete ALL drafts */
export const deleteAllComposeDrafts = defineEventHandler((_event: H3Event) => {
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
  return { ok: true };
});
