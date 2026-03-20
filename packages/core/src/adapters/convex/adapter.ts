import { createHash } from "crypto";
import type {
  FileSyncAdapter,
  FileRecord,
  FileChange,
  FileWritePayload,
  Unsubscribe,
} from "../sync/types.js";

// ---------------------------------------------------------------------------
// Minimal Convex client interface (avoids hard convex dependency)
// ---------------------------------------------------------------------------

export interface ConvexClient {
  mutation(
    functionRef: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  query(functionRef: string, args: Record<string, unknown>): Promise<unknown>;
  onUpdate(
    functionRef: string,
    args: Record<string, unknown>,
    callback: (result: unknown) => void,
  ): () => void;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Convex row type (what the Convex query returns)
// ---------------------------------------------------------------------------

interface ConvexFileRow {
  id: string;
  path: string;
  content: string;
  app: string;
  ownerId: string;
  lastUpdated: number;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRecord(row: ConvexFileRow): FileRecord {
  return {
    path: row.path,
    content: row.content,
    app: row.app,
    ownerId: row.ownerId,
    lastUpdated: row.lastUpdated,
    createdAt: row.createdAt,
  };
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Convex adapter
// ---------------------------------------------------------------------------

export class ConvexFileSyncAdapter implements FileSyncAdapter {
  constructor(private client: ConvexClient) {}

  async query(
    appId: string,
    ownerId: string,
  ): Promise<{ id: string; data: FileRecord }[]> {
    const rows = (await this.client.query("files:list", {
      app: appId,
      ownerId,
    })) as ConvexFileRow[];

    return (rows ?? []).map((row) => ({
      id: row.id,
      data: toRecord(row),
    }));
  }

  async get(id: string): Promise<{ id: string; data: FileRecord } | null> {
    const row = (await this.client.query("files:get", {
      id,
    })) as ConvexFileRow | null;

    if (!row) return null;
    return { id: row.id, data: toRecord(row) };
  }

  async set(id: string, record: FileWritePayload): Promise<void> {
    await this.client.mutation("files:upsert", {
      id,
      ...(record.path !== undefined && { path: record.path }),
      ...(record.content !== undefined && { content: record.content }),
      ...(record.app !== undefined && { app: record.app }),
      ...(record.ownerId !== undefined && { ownerId: record.ownerId }),
      ...(record.lastUpdated !== undefined && {
        lastUpdated: record.lastUpdated,
      }),
      ...(record.createdAt !== undefined && { createdAt: record.createdAt }),
    });
  }

  async delete(id: string): Promise<void> {
    await this.client.mutation("files:remove", { id });
  }

  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    // Store content hashes for memory-efficient diffing
    let previousHashes = new Map<string, string>();
    // Store last known records for removed file data
    let previousRecords = new Map<string, FileRecord>();
    // Serialize callback processing to prevent race conditions
    let processingChain = Promise.resolve();

    const unsubscribe = this.client.onUpdate(
      "files:list",
      { app: appId, ownerId },
      (result) => {
        processingChain = processingChain
          .then(() => {
            try {
              const rows = (result as ConvexFileRow[]) ?? [];
              const currentHashes = new Map<string, string>();
              const currentRecords = new Map<string, FileRecord>();

              for (const row of rows) {
                currentHashes.set(row.id, contentHash(row.content ?? ""));
                currentRecords.set(row.id, toRecord(row));
              }

              const changes: FileChange[] = [];

              // Detect added + modified
              for (const [id, hash] of currentHashes) {
                const prevHash = previousHashes.get(id);
                if (prevHash === undefined) {
                  changes.push({
                    type: "added",
                    id,
                    data: currentRecords.get(id)!,
                  });
                } else if (prevHash !== hash) {
                  changes.push({
                    type: "modified",
                    id,
                    data: currentRecords.get(id)!,
                  });
                }
              }

              // Detect removed
              for (const id of previousHashes.keys()) {
                if (!currentHashes.has(id)) {
                  const record = previousRecords.get(id);
                  if (record) {
                    changes.push({ type: "removed", id, data: record });
                  }
                }
              }

              previousHashes = currentHashes;
              previousRecords = currentRecords;

              if (changes.length > 0) onChange(changes);
            } catch (err) {
              onError(err);
            }
          })
          .catch(() => {
            // Prevent chain poisoning if onError throws
          });
      },
    );

    return unsubscribe;
  }

  async dispose(): Promise<void> {
    await this.client.close();
  }
}
