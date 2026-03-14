import type {
  FileSyncAdapter,
  FileRecord,
  FileChange,
  Unsubscribe,
} from "../sync/types.js";

// ---------------------------------------------------------------------------
// Minimal Neon SQL interface (avoids hard @neondatabase/serverless dep)
// ---------------------------------------------------------------------------

interface NeonQueryResult {
  rows: any[];
  rowCount: number;
}

type NeonSql = (
  strings: TemplateStringsArray,
  ...values: any[]
) => Promise<NeonQueryResult>;

// ---------------------------------------------------------------------------
// Column mapping helpers
// ---------------------------------------------------------------------------

/**
 * Table schema (same as Supabase):
 *   files(id TEXT PK, path TEXT, content TEXT, app TEXT, owner_id TEXT,
 *         last_updated BIGINT, created_at BIGINT)
 *
 * CREATE INDEX idx_files_app_owner ON files(app, owner_id);
 */

function rowToRecord(row: any): FileRecord {
  return {
    path: row.path,
    content: row.content,
    app: row.app,
    ownerId: row.owner_id,
    lastUpdated: Number(row.last_updated),
    createdAt: row.created_at != null ? Number(row.created_at) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Neon adapter (polling-based subscribe)
// ---------------------------------------------------------------------------

export interface NeonAdapterOptions {
  /** Polling interval in ms for subscribe(). Default: 2000 */
  pollIntervalMs?: number;
}

export class NeonFileSyncAdapter implements FileSyncAdapter {
  private pollIntervalMs: number;

  constructor(
    private sql: NeonSql,
    options?: NeonAdapterOptions,
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 2000;
  }

  async query(
    appId: string,
    ownerId: string,
  ): Promise<{ id: string; data: FileRecord }[]> {
    const result = await this.sql`
      SELECT * FROM files WHERE app = ${appId} AND owner_id = ${ownerId}
    `;
    return result.rows.map((row: any) => ({
      id: row.id,
      data: rowToRecord(row),
    }));
  }

  async get(id: string): Promise<{ id: string; data: FileRecord } | null> {
    const result = await this.sql`
      SELECT * FROM files WHERE id = ${id} LIMIT 1
    `;
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: row.id, data: rowToRecord(row) };
  }

  async set(id: string, record: Partial<FileRecord>): Promise<void> {
    const path = record.path ?? "";
    const content = record.content ?? "";
    const app = record.app ?? "";
    const ownerId = record.ownerId ?? "";
    const lastUpdated = record.lastUpdated ?? 0;
    const createdAt = record.createdAt ?? null;

    await this.sql`
      INSERT INTO files (id, path, content, app, owner_id, last_updated, created_at)
      VALUES (${id}, ${path}, ${content}, ${app}, ${ownerId}, ${lastUpdated}, ${createdAt})
      ON CONFLICT (id) DO UPDATE SET
        path = COALESCE(EXCLUDED.path, files.path),
        content = COALESCE(EXCLUDED.content, files.content),
        app = COALESCE(EXCLUDED.app, files.app),
        owner_id = COALESCE(EXCLUDED.owner_id, files.owner_id),
        last_updated = COALESCE(EXCLUDED.last_updated, files.last_updated),
        created_at = COALESCE(EXCLUDED.created_at, files.created_at)
    `;
  }

  async delete(id: string): Promise<void> {
    await this.sql`DELETE FROM files WHERE id = ${id}`;
  }

  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: any) => void,
  ): Unsubscribe {
    const snapshot = new Map<
      string,
      { content: string; lastUpdated: number }
    >();
    let stopped = false;

    const poll = async () => {
      if (stopped) return;

      try {
        const result = await this.sql`
          SELECT * FROM files WHERE app = ${appId} AND owner_id = ${ownerId}
        `;

        const currentIds = new Set<string>();
        const changes: FileChange[] = [];

        for (const row of result.rows) {
          currentIds.add(row.id);
          const record = rowToRecord(row);
          const prev = snapshot.get(row.id);

          if (!prev) {
            changes.push({ type: "added", id: row.id, data: record });
            snapshot.set(row.id, {
              content: row.content,
              lastUpdated: Number(row.last_updated),
            });
          } else if (
            prev.content !== row.content ||
            prev.lastUpdated !== Number(row.last_updated)
          ) {
            changes.push({ type: "modified", id: row.id, data: record });
            snapshot.set(row.id, {
              content: row.content,
              lastUpdated: Number(row.last_updated),
            });
          }
        }

        for (const [id] of snapshot) {
          if (!currentIds.has(id)) {
            const prev = snapshot.get(id)!;
            changes.push({
              type: "removed",
              id,
              data: {
                path: "",
                content: prev.content,
                app: appId,
                ownerId,
                lastUpdated: prev.lastUpdated,
              },
            });
            snapshot.delete(id);
          }
        }

        if (changes.length > 0) {
          onChange(changes);
        }
      } catch (err) {
        onError(err);
      }

      if (!stopped) {
        setTimeout(poll, this.pollIntervalMs);
      }
    };

    // Start polling
    poll();

    return () => {
      stopped = true;
    };
  }
}
