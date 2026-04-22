import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
  type DbExec,
} from "../db/client.js";
import { emitResourceChange, emitResourceDelete } from "./emitter.js";
import type { StoreWriteOptions } from "../settings/store.js";
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

let _initPromise: Promise<void> | undefined;

const DEFAULT_LEARNINGS_SHARED_MD = `# Learnings

User preferences, corrections, and patterns. The agent reads this at the start of every conversation.

Keep this file tidy — revise, consolidate, and remove outdated entries. Don't just append forever.

## Preferences

## Corrections

## Patterns
`;

const DEFAULT_LEARNINGS_PERSONAL_MD = `# My Learnings

Personal preferences, corrections, and patterns — only visible to you.

## Preferences

## Corrections

## Patterns
`;

const DEFAULT_SKILL_LEARN_MD = `---
name: learn
description: >-
  Review the conversation and save structured memories for future sessions.
user-invocable: true
---

# Learn

Review the current conversation and save anything worth remembering using the structured memory system.

## Memory types

- **user** — Preferences, role, personal context, contacts
- **feedback** — Corrections ("don't do X, do Y instead"), confirmed approaches
- **project** — Ongoing work context, decisions, status
- **reference** — Pointers to external systems, URLs, API details

## Steps

1. Review the conversation for new insights
2. Check your memory index: \`resource-read --path memory/MEMORY.md\`
3. For each new insight, use \`save-memory\` with a descriptive name, type, and content
4. If updating an existing memory, read it first with \`resource-read --path memory/<name>.md\`, then save with merged content

## What NOT to capture

- Things obvious from reading the code
- Standard language/framework behavior
- Temporary debugging notes
- Anything already in AGENTS.md or other skills

Keep one memory per logical topic. Descriptions should be concise — the index is loaded every conversation.
`;

const DEFAULT_SKILL_LEARN_SHARED_MD = `---
name: learn-shared
description: >-
  Update the shared LEARNINGS.md with team-wide preferences, corrections, and
  patterns from this session.
user-invocable: true
---

# Learn (Shared)

Review the current conversation and update the shared \`LEARNINGS.md\` resource with anything the whole team should know.

## What to capture

- **Team conventions** — agreed-upon approaches, code style decisions
- **Technical learnings** — API quirks, library gotchas, surprising behavior
- **Architectural decisions** — why something is done a certain way
- **Corrections** — mistakes that any team member's agent should avoid

## What NOT to capture

- Personal preferences (use \`/learn\` for those)
- Things obvious from reading the code
- Standard language/framework behavior

## Steps

1. Read shared learnings: \`pnpm action resource-read --path LEARNINGS.md --scope shared\`
2. Review the conversation for team-relevant insights
3. Merge new learnings with existing ones — don't duplicate, refine existing entries
4. Write back: \`pnpm action resource-write --path LEARNINGS.md --scope shared --content "..."\`

Keep entries concise — one line per learning, grouped by category (Conventions, Technical, Patterns).
`;

const DEFAULT_AGENTS_SHARED_MD = `# Agent Instructions

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

const DEFAULT_AGENTS_PERSONAL_MD = `# My Agent Instructions

Personal agent instructions — only visible to you. Use this for your own contacts, preferences, and context.

## Contacts

Add people you frequently interact with so the agent can resolve names like "email my wife" or "message John":

| Name | Email | Notes |
|------|-------|-------|
| *(add your contacts here)* | | |

## Preferences

## Context
`;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = _doEnsureTable().catch((err) => {
      // Don't cache the rejection — let the next caller retry a fresh init.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

async function _doEnsureTable(): Promise<void> {
  const client = getDbExec();
  await retryOnDdlRace(() =>
    client.execute(`
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
    `),
  );

  // Seed default shared resources if they don't exist (INSERT OR IGNORE to avoid race conditions)
  const now = Date.now();
  const seedSql = isPostgres()
    ? `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`
    : `INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  // AGENTS.md — shared agent instructions
  const agentsSize = Buffer.byteLength(DEFAULT_AGENTS_SHARED_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "AGENTS.md",
      SHARED_OWNER,
      DEFAULT_AGENTS_SHARED_MD,
      "text/markdown",
      agentsSize,
      now,
      now,
    ],
  });

  // LEARNINGS.md — shared learnings (preferences, corrections, patterns)
  const learningsSize = Buffer.byteLength(DEFAULT_LEARNINGS_SHARED_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "LEARNINGS.md",
      SHARED_OWNER,
      DEFAULT_LEARNINGS_SHARED_MD,
      "text/markdown",
      learningsSize,
      now,
      now,
    ],
  });

  // skills/learn-shared.md — shared skill for updating shared LEARNINGS.md
  const learnSharedSize = Buffer.byteLength(
    DEFAULT_SKILL_LEARN_SHARED_MD,
    "utf8",
  );
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "skills/learn-shared.md",
      SHARED_OWNER,
      DEFAULT_SKILL_LEARN_SHARED_MD,
      "text/markdown",
      learnSharedSize,
      now,
      now,
    ],
  });

  // Seed built-in agents as shared resources under agents/
  try {
    const { getBuiltinAgents } = await import("../server/agent-discovery.js");
    const builtins = getBuiltinAgents();
    for (const agent of builtins) {
      const agentJson = JSON.stringify(
        {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          url: agent.url,
          color: agent.color,
        },
        null,
        2,
      );
      const agentSize = Buffer.byteLength(agentJson, "utf8");
      await client.execute({
        sql: seedSql,
        args: [
          crypto.randomUUID(),
          `remote-agents/${agent.id}.json`,
          SHARED_OWNER,
          agentJson,
          "application/json",
          agentSize,
          now,
          now,
        ],
      });
    }
  } catch {
    // Agent discovery not available — skip seeding
  }

  // One-time migration: rename legacy agents/*.json (A2A manifests) to
  // remote-agents/*.json so they live in their own folder, separate from
  // custom agents (agents/*.md).
  try {
    const legacy = await client.execute({
      sql: `SELECT id, path FROM resources WHERE path LIKE ? AND path LIKE ?`,
      args: ["agents/%", "%.json"],
    });
    const rows = (legacy.rows ?? []) as Array<{ id: string; path: string }>;
    for (const row of rows) {
      const newPath = row.path.replace(/^agents\//, "remote-agents/");
      try {
        await client.execute({
          sql: `UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,
          args: [newPath, Date.now(), row.id],
        });
      } catch {
        // Skip if destination path already exists (unique constraint) —
        // we'll leave the old row in place; it'll be ignored by readers.
      }
    }
  } catch {
    // Migration best-effort
  }
}

const _personalSeeded = new Set<string>();

/**
 * Seed personal AGENTS.md and LEARNINGS.md for a user if they don't exist.
 * Called when listing resources or from the agent chat plugin.
 */
export async function ensurePersonalDefaults(owner: string): Promise<void> {
  if (owner === SHARED_OWNER || _personalSeeded.has(owner)) return;
  _personalSeeded.add(owner);
  await ensureTable();

  const client = getDbExec();
  const now = Date.now();
  const seedSql = isPostgres()
    ? `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`
    : `INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  const agentsSize = Buffer.byteLength(DEFAULT_AGENTS_PERSONAL_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "AGENTS.md",
      owner,
      DEFAULT_AGENTS_PERSONAL_MD,
      "text/markdown",
      agentsSize,
      now,
      now,
    ],
  });

  const learningsSize = Buffer.byteLength(
    DEFAULT_LEARNINGS_PERSONAL_MD,
    "utf8",
  );
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "LEARNINGS.md",
      owner,
      DEFAULT_LEARNINGS_PERSONAL_MD,
      "text/markdown",
      learningsSize,
      now,
      now,
    ],
  });

  // memory/MEMORY.md — personal structured memory index
  const memoryIndexContent = "# Memory Index\n";
  const memoryIndexSize = Buffer.byteLength(memoryIndexContent, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "memory/MEMORY.md",
      owner,
      memoryIndexContent,
      "text/markdown",
      memoryIndexSize,
      now,
      now,
    ],
  });

  // skills/learn.md — personal skill for updating memory
  const learnSize = Buffer.byteLength(DEFAULT_SKILL_LEARN_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "skills/learn.md",
      owner,
      DEFAULT_SKILL_LEARN_MD,
      "text/markdown",
      learnSize,
      now,
      now,
    ],
  });
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
  options?: StoreWriteOptions,
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

  emitResourceChange(id, path, owner, options?.requestSource);

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

/**
 * List all resources matching a path prefix across ALL owners.
 * Used by the recurring jobs scheduler to find all job resources.
 */
export async function resourceListAllOwners(
  pathPrefix: string,
): Promise<Resource[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE path LIKE ?`,
    args: [pathPrefix + "%"],
  });
  return rows.map(rowToResource);
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
