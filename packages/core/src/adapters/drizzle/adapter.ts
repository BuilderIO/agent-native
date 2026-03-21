import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and, sql } from "drizzle-orm";
import type {
  FileSyncAdapter,
  FileRecord,
  FileChange,
  FileWritePayload,
  Unsubscribe,
} from "../sync/types.js";
import { files } from "./schema.js";

type DrizzleDb = ReturnType<typeof drizzle>;

// ---------------------------------------------------------------------------
// Column mapping helpers
// ---------------------------------------------------------------------------

function rowToRecord(row: typeof files.$inferSelect): FileRecord {
  return {
    path: row.path,
    content: row.content,
    app: row.app,
    ownerId: row.ownerId,
    lastUpdated: row.lastUpdated,
    createdAt: row.createdAt ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// DrizzleFileSyncAdapter
// ---------------------------------------------------------------------------

/**
 * SQLite-backed file sync adapter using Drizzle ORM.
 *
 * Zero external dependencies beyond what @agent-native/core already ships
 * (drizzle-orm + better-sqlite3). The SQLite database is created automatically
 * at the provided path on construction.
 *
 * Since SQLite has no built-in change notifications, `subscribe()` uses a
 * lightweight polling loop (~1s interval) that queries `MAX(last_updated)` and
 * only fetches full rows when the max changes. This is efficient for local dev.
 *
 * Best for: single-instance / local dev. For multi-instance / team sync, use
 * the Supabase, Firestore, or Convex adapters instead.
 */
export class DrizzleFileSyncAdapter implements FileSyncAdapter {
  private db: DrizzleDb;
  private sqlite: Database.Database;
  private pollIntervals: Set<ReturnType<typeof setInterval>> = new Set();

  constructor(dbPathOrInstance: string | Database.Database) {
    if (typeof dbPathOrInstance === "string") {
      this.sqlite = new Database(dbPathOrInstance);
      // WAL mode for better concurrent read performance
      this.sqlite.pragma("journal_mode = WAL");
    } else {
      this.sqlite = dbPathOrInstance;
    }

    this.db = drizzle(this.sqlite);
    this.ensureTable();
  }

  // ---------------------------------------------------------------------------
  // Schema setup
  // ---------------------------------------------------------------------------

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        app TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        last_updated INTEGER NOT NULL,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_files_app_owner ON files(app, owner_id);
    `);
  }

  // ---------------------------------------------------------------------------
  // FileSyncAdapter interface
  // ---------------------------------------------------------------------------

  async query(
    appId: string,
    ownerId: string,
  ): Promise<{ id: string; data: FileRecord }[]> {
    const rows = this.db
      .select()
      .from(files)
      .where(and(eq(files.app, appId), eq(files.ownerId, ownerId)))
      .all();

    return rows.map((row) => ({ id: row.id, data: rowToRecord(row) }));
  }

  async get(id: string): Promise<{ id: string; data: FileRecord } | null> {
    const row = this.db.select().from(files).where(eq(files.id, id)).get();

    if (!row) return null;
    return { id: row.id, data: rowToRecord(row) };
  }

  async set(id: string, record: FileWritePayload): Promise<void> {
    const existing = this.db.select().from(files).where(eq(files.id, id)).get();

    if (existing) {
      // Update only provided fields. Use a plain record to avoid drizzle's
      // strict inferred-insert type, which may omit nullable columns.
      const updates: Record<string, unknown> = {};
      if (record.path !== undefined) updates.path = record.path;
      if (record.content !== undefined) updates.content = record.content;
      if (record.app !== undefined) updates.app = record.app;
      if (record.ownerId !== undefined) updates.ownerId = record.ownerId;
      if (record.lastUpdated !== undefined)
        updates.lastUpdated = record.lastUpdated;
      if (record.createdAt !== undefined) updates.createdAt = record.createdAt;

      if (Object.keys(updates).length > 0) {
        this.db
          .update(files)
          .set(updates as typeof files.$inferInsert)
          .where(eq(files.id, id))
          .run();
      }
    } else {
      // Insert new record — require all required fields
      const values: Record<string, unknown> = {
        id,
        path: record.path ?? "",
        content: record.content ?? "",
        app: record.app ?? "",
        ownerId: record.ownerId ?? "",
        lastUpdated: record.lastUpdated ?? 0,
      };
      if (record.createdAt !== undefined) values.createdAt = record.createdAt;

      this.db
        .insert(files)
        .values(values as typeof files.$inferInsert)
        .run();
    }
  }

  async delete(id: string): Promise<void> {
    this.db.delete(files).where(eq(files.id, id)).run();
  }

  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    // Track a lightweight "high-water mark" — the MAX(last_updated) seen so far.
    // On each tick we query the max; if it changed, we do a full diff.
    let lastMaxUpdated: number | null = null;
    const snapshot = new Map<
      string,
      { content: string; lastUpdated: number }
    >();

    const tick = () => {
      try {
        // Cheap scalar query — only fetch rows when something changed
        const maxRow = this.db
          .select({ max: sql<number>`MAX(${files.lastUpdated})` })
          .from(files)
          .where(and(eq(files.app, appId), eq(files.ownerId, ownerId)))
          .get();

        const currentMax = maxRow?.max ?? null;
        if (currentMax === lastMaxUpdated) return;
        lastMaxUpdated = currentMax;

        const rows = this.db
          .select()
          .from(files)
          .where(and(eq(files.app, appId), eq(files.ownerId, ownerId)))
          .all();

        const currentIds = new Set<string>();
        const changes: FileChange[] = [];

        for (const row of rows) {
          currentIds.add(row.id);
          const prev = snapshot.get(row.id);
          const data = rowToRecord(row);

          if (!prev) {
            changes.push({ type: "added", id: row.id, data });
          } else if (
            prev.content !== row.content ||
            prev.lastUpdated !== row.lastUpdated
          ) {
            changes.push({ type: "modified", id: row.id, data });
          }

          snapshot.set(row.id, {
            content: row.content,
            lastUpdated: row.lastUpdated,
          });
        }

        for (const [id] of snapshot) {
          if (!currentIds.has(id)) {
            changes.push({
              type: "removed",
              id,
              data: {
                path: "",
                content: "",
                app: appId,
                ownerId,
                lastUpdated: 0,
              },
            });
            snapshot.delete(id);
          }
        }

        if (changes.length > 0) onChange(changes);
      } catch (err) {
        onError(err);
      }
    };

    const interval = setInterval(tick, 1000);
    this.pollIntervals.add(interval);

    return () => {
      clearInterval(interval);
      this.pollIntervals.delete(interval);
    };
  }

  async dispose(): Promise<void> {
    for (const interval of this.pollIntervals) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();
    this.sqlite.close();
  }
}
