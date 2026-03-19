import type {
  FileSyncAdapter,
  FileRecord,
  FileChange,
  Unsubscribe,
} from "../sync/types.js";

// ---------------------------------------------------------------------------
// Minimal Supabase client interface (avoids hard @supabase/supabase-js dep)
// ---------------------------------------------------------------------------

interface SupabaseFilterBuilder {
  select(columns: string): SupabaseFilterBuilder;
  eq(column: string, value: any): SupabaseFilterBuilder;
  maybeSingle(): SupabaseFilterBuilder;
  then(resolve: (value: any) => any, reject?: (error: any) => any): any;
}

interface SupabaseQueryBuilder {
  select(columns: string): SupabaseFilterBuilder;
  upsert(values: any, options?: { onConflict?: string }): SupabaseFilterBuilder;
  delete(): SupabaseFilterBuilder;
}

interface SupabaseRealtimeChannel {
  on(
    event: string,
    filter: any,
    callback: (payload: any) => void,
  ): SupabaseRealtimeChannel;
  subscribe(callback?: (status: string) => void): SupabaseRealtimeChannel;
  unsubscribe(): void;
}

interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
  channel(name: string): SupabaseRealtimeChannel;
  removeChannel(channel: SupabaseRealtimeChannel): void;
}

// ---------------------------------------------------------------------------
// Column mapping helpers
// ---------------------------------------------------------------------------

/**
 * Table schema:
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
    lastUpdated: row.last_updated,
    createdAt: row.created_at ?? undefined,
  };
}

function recordToRow(
  id: string,
  record: Partial<FileRecord>,
): Record<string, any> {
  const row: Record<string, any> = { id };
  if (record.path !== undefined) row.path = record.path;
  if (record.content !== undefined) row.content = record.content;
  if (record.app !== undefined) row.app = record.app;
  if (record.ownerId !== undefined) row.owner_id = record.ownerId;
  if (record.lastUpdated !== undefined) row.last_updated = record.lastUpdated;
  if (record.createdAt !== undefined) row.created_at = record.createdAt;
  return row;
}

// ---------------------------------------------------------------------------
// Supabase adapter
// ---------------------------------------------------------------------------

export class SupabaseFileSyncAdapter implements FileSyncAdapter {
  constructor(
    private client: SupabaseClient,
    private table: string = "files",
  ) {}

  async query(
    appId: string,
    ownerId: string,
  ): Promise<{ id: string; data: FileRecord }[]> {
    const { data, error } = await (this.client
      .from(this.table)
      .select("*")
      .eq("app", appId)
      .eq("owner_id", ownerId) as any);

    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      data: rowToRecord(row),
    }));
  }

  async get(id: string): Promise<{ id: string; data: FileRecord } | null> {
    const { data, error } = await (this.client
      .from(this.table)
      .select("*")
      .eq("id", id)
      .maybeSingle() as any);

    if (error) throw error;
    if (!data) return null;
    return { id: data.id, data: rowToRecord(data) };
  }

  async set(id: string, record: Partial<FileRecord>): Promise<void> {
    const row = recordToRow(id, record);
    const { error } = await (this.client
      .from(this.table)
      .upsert(row, { onConflict: "id" }) as any);

    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await (this.client
      .from(this.table)
      .delete()
      .eq("id", id) as any);

    if (error) throw error;
  }

  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    const channel = this.client
      .channel(`file-sync-${appId}-${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: this.table,
          filter: `app=eq.${appId}&owner_id=eq.${ownerId}`,
        },
        (payload: any) => {
          try {
            const row = payload.new ?? payload.old;
            if (!row) return;

            let type: FileChange["type"];
            if (payload.eventType === "INSERT") type = "added";
            else if (payload.eventType === "UPDATE") type = "modified";
            else if (payload.eventType === "DELETE") type = "removed";
            else return;

            const change: FileChange = {
              type,
              id: row.id,
              data: rowToRecord(row),
            };
            onChange([change]);
          } catch (err) {
            onError(err);
          }
        },
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR") {
          onError(new Error("Supabase realtime channel error"));
        }
      });

    return () => {
      this.client.removeChannel(channel);
    };
  }

  async dispose(): Promise<void> {
    // removeAllChannels is the cleanest teardown for Supabase realtime
  }
}
