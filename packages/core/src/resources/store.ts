import { getDbExec, isPostgres, intType, type DbExec } from "../db/client.js";
import { emitResourceChange, emitResourceDelete } from "./emitter.js";
import crypto from "crypto";

export const SHARED_OWNER = "__shared__";

export interface Resource {
  id: string;
  path: string;
  owner: string;
  content: string;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface ResourceMeta {
  id: string;
  path: string;
  owner: string;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

let _initialized = false;

const DEFAULT_LEARNINGS_MD = `# Learnings

Record user preferences, corrections, and patterns here. The agent reads this at the start of every conversation.

## Preferences

## Corrections

## Patterns
`;

const DEFAULT_AGENTS_MD = `# Agent Instructions

This file customizes how the AI agent behaves in this app. Edit it to add your own instructions, preferences, and context.

## What to put here

- **Preferences** — Tone, style, verbosity, response format
- **Context** — Domain knowledge, terminology, team conventions
- **Rules** — Things the agent should always/never do
- **Skills** — Reference skill files for specialized tasks (create them in the \`skills/\` folder)

## Skills

You can create skill files to give the agent specialized knowledge for specific tasks. Create resources under \`skills/\` (e.g., \`skills/data-analysis.md\`, \`skills/code-review.md\`) and reference them here:

| Skill | Path | Description |
|-------|------|-------------|
| *(add your skills here)* | \`skills/example.md\` | What this skill teaches the agent |

The agent will read the relevant skill file when performing that type of task.

## Example

\`\`\`markdown
## Tone
Be concise. Lead with the answer. Skip filler.

## Code style
- Use TypeScript, never JavaScript
- Prefer named exports
- Use early returns

## Domain context
We sell B2B SaaS. Our customers are enterprise engineering teams.
\`\`\`
`;

async function ensureTable(): Promise<void> {
  if (_initialized) return;
  const client = getDbExec();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      owner TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'text/markdown',
      size ${intType()} NOT NULL DEFAULT 0,
      created_at ${intType()} NOT NULL,
      updated_at ${intType()} NOT NULL,
      UNIQUE(path, owner)
    )
  `);

  // Seed default shared resources if they don't exist (INSERT OR IGNORE to avoid race conditions)
  const now = Date.now();
  const seedSql = isPostgres()
    ? `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`
    : `INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  // AGENTS.md — shared agent instructions
  const agentsSize = Buffer.byteLength(DEFAULT_AGENTS_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "AGENTS.md",
      SHARED_OWNER,
      DEFAULT_AGENTS_MD,
      "text/markdown",
      agentsSize,
      now,
      now,
    ],
  });

  // LEARNINGS.md — shared learnings (preferences, corrections, patterns)
  const learningsSize = Buffer.byteLength(DEFAULT_LEARNINGS_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "LEARNINGS.md",
      SHARED_OWNER,
      DEFAULT_LEARNINGS_MD,
      "text/markdown",
      learningsSize,
      now,
      now,
    ],
  });

  _initialized = true;
}

function rowToResource(row: any): Resource {
  return {
    id: row.id as string,
    path: row.path as string,
    owner: row.owner as string,
    content: row.content as string,
    mimeType: row.mime_type as string,
    size: row.size as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function rowToMeta(row: any): ResourceMeta {
  return {
    id: row.id as string,
    path: row.path as string,
    owner: row.owner as string,
    mimeType: row.mime_type as string,
    size: row.size as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export async function resourceGet(id: string): Promise<Resource | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToResource(rows[0]);
}

export async function resourceGetByPath(
  owner: string,
  path: string,
): Promise<Resource | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });
  if (rows.length === 0) return null;
  return rowToResource(rows[0]);
}

export async function resourcePut(
  owner: string,
  path: string,
  content: string,
  mimeType?: string,
): Promise<Resource> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const size = Buffer.byteLength(content, "utf8");
  const mime = mimeType || "text/markdown";

  // Check for existing resource to preserve ID on upsert
  const { rows: existing } = await client.execute({
    sql: `SELECT id, created_at FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });

  const id =
    existing.length > 0 ? (existing[0].id as string) : crypto.randomUUID();
  const createdAt =
    existing.length > 0 ? (existing[0].created_at as number) : now;

  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO UPDATE SET id=EXCLUDED.id, content=EXCLUDED.content, mime_type=EXCLUDED.mime_type, size=EXCLUDED.size, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, path, owner, content, mime, size, createdAt, now],
  });

  emitResourceChange(id, path, owner);

  return {
    id,
    path,
    owner,
    content,
    mimeType: mime,
    size,
    createdAt,
    updatedAt: now,
  };
}

export async function resourceDelete(id: string): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();

  // Get resource info for emitter before deleting
  const { rows } = await client.execute({
    sql: `SELECT path, owner FROM resources WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return false;

  const result = await client.execute({
    sql: `DELETE FROM resources WHERE id = ?`,
    args: [id],
  });
  const deleted = result.rowsAffected > 0;
  if (deleted) {
    emitResourceDelete(id, rows[0].path as string, rows[0].owner as string);
  }
  return deleted;
}

export async function resourceDeleteByPath(
  owner: string,
  path: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();

  // Get resource info for emitter before deleting
  const { rows } = await client.execute({
    sql: `SELECT id FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });
  if (rows.length === 0) return false;

  const result = await client.execute({
    sql: `DELETE FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });
  const deleted = result.rowsAffected > 0;
  if (deleted) {
    emitResourceDelete(rows[0].id as string, path, owner);
  }
  return deleted;
}

export async function resourceList(
  owner: string,
  pathPrefix?: string,
): Promise<ResourceMeta[]> {
  await ensureTable();
  const client = getDbExec();

  if (pathPrefix) {
    const { rows } = await client.execute({
      sql: `SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?`,
      args: [owner, pathPrefix + "%"],
    });
    return rows.map(rowToMeta);
  }

  const { rows } = await client.execute({
    sql: `SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?`,
    args: [owner],
  });
  return rows.map(rowToMeta);
}

export async function resourceListAccessible(
  userEmail: string,
  pathPrefix?: string,
): Promise<ResourceMeta[]> {
  await ensureTable();
  const client = getDbExec();

  if (pathPrefix) {
    const { rows } = await client.execute({
      sql: `SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?
            UNION
            SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?`,
      args: [userEmail, pathPrefix + "%", SHARED_OWNER, pathPrefix + "%"],
    });
    return rows.map(rowToMeta);
  }

  const { rows } = await client.execute({
    sql: `SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?
          UNION
          SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?`,
    args: [userEmail, SHARED_OWNER],
  });
  return rows.map(rowToMeta);
}

export async function resourceMove(
  id: string,
  newPath: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  // Get current resource info
  const { rows } = await client.execute({
    sql: `SELECT path, owner FROM resources WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return false;

  const result = await client.execute({
    sql: `UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,
    args: [newPath, now, id],
  });
  const moved = result.rowsAffected > 0;
  if (moved) {
    emitResourceChange(id, newPath, rows[0].owner as string);
  }
  return moved;
}
