import { createFileRoute } from "@tanstack/react-router";
import DocsLayout from "../../components/DocsLayout";
import CodeBlock from "../../components/CodeBlock";

export const Route = createFileRoute("/docs/database-adapters")({
  component: DatabaseAdaptersDocs,
  head: () => ({
    meta: [
      { title: "Database Adapters — Agent-Native" },
      {
        name: "description",
        content:
          "How to build a custom database adapter for syncing agent-native app state across instances.",
      },
    ],
  }),
});

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "the-interface", label: "The Interface" },
  { id: "building-an-adapter", label: "Building an Adapter" },
  { id: "query", label: "query()", indent: true },
  { id: "get", label: "get()", indent: true },
  { id: "set", label: "set()", indent: true },
  { id: "delete", label: "delete()", indent: true },
  { id: "subscribe", label: "subscribe()", indent: true },
  { id: "full-example", label: "Full Example" },
  { id: "wiring-it-up", label: "Wiring It Up" },
  { id: "testing", label: "Testing" },
  { id: "publishing", label: "Publishing" },
];

function DatabaseAdaptersDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Database Adapters
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Build a custom adapter to sync agent-native app state to any database.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        Agent-native apps use files as their database. But when multiple users
        collaborate across different agent instances, you need a sync layer to
        keep everyone in sync. That's what adapters do — they bridge the gap
        between the local file system and a remote database.
      </p>
      <p>
        Three adapters ship with <code>@agent-native/core</code> (Firestore,
        Supabase, Neon), but you can build your own for any backend — DynamoDB,
        MongoDB, Turso, a REST API, whatever you need.
      </p>
      <p>
        An adapter is a single class that implements five methods. The sync
        engine handles everything else: file watching, conflict resolution,
        deduplication, and pattern matching.
      </p>

      <h2 id="the-interface">The interface</h2>
      <p>
        Every adapter implements <code>FileSyncAdapter</code>:
      </p>
      <CodeBlock
        code={`import type { FileSyncAdapter, FileRecord, FileChange, Unsubscribe } from "@agent-native/core/adapters/sync";

interface FileSyncAdapter {
  query(appId: string, ownerId: string): Promise<{ id: string; data: FileRecord }[]>;
  get(id: string): Promise<{ id: string; data: FileRecord } | null>;
  set(id: string, record: Partial<FileRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: any) => void,
  ): Unsubscribe;
}`}
      />
      <p>The types it works with:</p>
      <CodeBlock
        code={`interface FileRecord {
  path: string;        // File path relative to project root
  content: string;     // File contents
  app: string;         // Application identifier
  ownerId: string;     // Owner/user ID
  lastUpdated: number; // Unix timestamp (ms)
  createdAt?: number;  // Optional creation timestamp
}

interface FileChange {
  type: "added" | "modified" | "removed";
  id: string;          // Document ID
  data: FileRecord;
}

type Unsubscribe = () => void;`}
      />

      <h2 id="building-an-adapter">Building an adapter</h2>
      <p>Each method has a specific job. Here's what to implement:</p>

      <h3 id="query">query(appId, ownerId)</h3>
      <p>
        Return all file records for a given app and owner. This is called at
        startup to load the initial state.
      </p>
      <CodeBlock
        code={`async query(appId: string, ownerId: string) {
  const rows = await db.select("files", { app: appId, owner_id: ownerId });
  return rows.map(row => ({ id: row.id, data: toFileRecord(row) }));
}`}
      />

      <h3 id="get">get(id)</h3>
      <p>
        Fetch a single record by its document ID. Return <code>null</code> if
        not found.
      </p>
      <CodeBlock
        code={`async get(id: string) {
  const row = await db.findOne("files", { id });
  if (!row) return null;
  return { id: row.id, data: toFileRecord(row) };
}`}
      />

      <h3 id="set">set(id, record)</h3>
      <p>
        Upsert a file record. The <code>record</code> argument is{" "}
        <code>Partial&lt;FileRecord&gt;</code> — on updates, only changed fields
        are passed. Your implementation should merge with existing data, not
        overwrite.
      </p>
      <CodeBlock
        code={`async set(id: string, record: Partial<FileRecord>) {
  await db.upsert("files", {
    id,
    path: record.path,
    content: record.content,
    app: record.app,
    owner_id: record.ownerId,
    last_updated: record.lastUpdated,
    created_at: record.createdAt,
  });
}`}
      />

      <h3 id="delete">delete(id)</h3>
      <p>Delete a file record by ID.</p>
      <CodeBlock
        code={`async delete(id: string) {
  await db.remove("files", { id });
}`}
      />

      <h3 id="subscribe">subscribe(appId, ownerId, onChange, onError)</h3>
      <p>
        Listen for remote changes and call <code>onChange</code> with an array
        of <code>FileChange</code> objects. Return an unsubscribe function that
        stops listening when called.
      </p>
      <p>You have two options here:</p>
      <div className="my-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">Real-time listener</div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            If your database supports change streams (Firestore{" "}
            <code>onSnapshot</code>, Supabase Realtime, MongoDB Change Streams),
            use them. Lower latency, no wasted queries.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">Polling</div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            If your database doesn't support real-time, poll on an interval. The
            Neon adapter does this at 2-second intervals. Keep an in-memory
            snapshot and diff against it.
          </p>
        </div>
      </div>
      <p>Here's the polling approach (works with any database):</p>
      <CodeBlock
        code={`subscribe(appId, ownerId, onChange, onError): Unsubscribe {
  const snapshot = new Map<string, { content: string; lastUpdated: number }>();
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      const records = await this.query(appId, ownerId);
      const currentIds = new Set<string>();
      const changes: FileChange[] = [];

      for (const { id, data } of records) {
        currentIds.add(id);
        const prev = snapshot.get(id);

        if (!prev) {
          changes.push({ type: "added", id, data });
        } else if (prev.content !== data.content || prev.lastUpdated !== data.lastUpdated) {
          changes.push({ type: "modified", id, data });
        }
        snapshot.set(id, { content: data.content, lastUpdated: data.lastUpdated });
      }

      for (const [id] of snapshot) {
        if (!currentIds.has(id)) {
          changes.push({
            type: "removed", id,
            data: { path: "", content: "", app: appId, ownerId, lastUpdated: 0 },
          });
          snapshot.delete(id);
        }
      }

      if (changes.length > 0) onChange(changes);
    } catch (err) {
      onError(err);
    }
    if (!stopped) setTimeout(poll, 2000);
  };

  poll();
  return () => { stopped = true; };
}`}
      />

      <h2 id="full-example">Full example</h2>
      <p>
        Here's a complete adapter for a generic SQL database (e.g., Turso,
        PlanetScale, or any driver that supports parameterized queries):
      </p>
      <CodeBlock
        code={`import type {
  FileSyncAdapter, FileRecord, FileChange, Unsubscribe
} from "@agent-native/core/adapters/sync";

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

export class MyDatabaseAdapter implements FileSyncAdapter {
  constructor(private db: any) {}

  async query(appId: string, ownerId: string) {
    const { rows } = await this.db.execute(
      "SELECT * FROM files WHERE app = ? AND owner_id = ?",
      [appId, ownerId]
    );
    return rows.map((row: any) => ({ id: row.id, data: rowToRecord(row) }));
  }

  async get(id: string) {
    const { rows } = await this.db.execute(
      "SELECT * FROM files WHERE id = ? LIMIT 1", [id]
    );
    if (rows.length === 0) return null;
    return { id: rows[0].id, data: rowToRecord(rows[0]) };
  }

  async set(id: string, record: Partial<FileRecord>) {
    await this.db.execute(
      \`INSERT INTO files (id, path, content, app, owner_id, last_updated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         path = COALESCE(excluded.path, files.path),
         content = COALESCE(excluded.content, files.content),
         app = COALESCE(excluded.app, files.app),
         owner_id = COALESCE(excluded.owner_id, files.owner_id),
         last_updated = COALESCE(excluded.last_updated, files.last_updated),
         created_at = COALESCE(excluded.created_at, files.created_at)\`,
      [id, record.path ?? "", record.content ?? "", record.app ?? "",
       record.ownerId ?? "", record.lastUpdated ?? 0, record.createdAt ?? null]
    );
  }

  async delete(id: string) {
    await this.db.execute("DELETE FROM files WHERE id = ?", [id]);
  }

  subscribe(appId: string, ownerId: string, onChange: (c: FileChange[]) => void, onError: (e: any) => void): Unsubscribe {
    const snapshot = new Map<string, { content: string; lastUpdated: number }>();
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      try {
        const records = await this.query(appId, ownerId);
        const currentIds = new Set<string>();
        const changes: FileChange[] = [];

        for (const { id, data } of records) {
          currentIds.add(id);
          const prev = snapshot.get(id);
          if (!prev) {
            changes.push({ type: "added", id, data });
          } else if (prev.content !== data.content || prev.lastUpdated !== data.lastUpdated) {
            changes.push({ type: "modified", id, data });
          }
          snapshot.set(id, { content: data.content, lastUpdated: data.lastUpdated });
        }

        for (const [id] of snapshot) {
          if (!currentIds.has(id)) {
            changes.push({
              type: "removed", id,
              data: { path: "", content: "", app: appId, ownerId, lastUpdated: 0 },
            });
            snapshot.delete(id);
          }
        }

        if (changes.length > 0) onChange(changes);
      } catch (err) { onError(err); }
      if (!stopped) setTimeout(poll, 2000);
    };

    poll();
    return () => { stopped = true; };
  }
}`}
      />

      <h2 id="wiring-it-up">Wiring it up</h2>
      <p>
        Pass your adapter to <code>FileSync</code> in your server setup:
      </p>
      <CodeBlock
        code={`import { FileSync } from "@agent-native/core/adapters/sync";
import { MyDatabaseAdapter } from "./my-adapter";

const adapter = new MyDatabaseAdapter(dbClient);

const sync = new FileSync({
  appId: "my-app",
  ownerId: "shared",
  contentRoot: "./data",
  adapter,
});

// Start syncing
await sync.initFileSync();`}
      />
      <p>
        The sync engine handles the rest — watching files, pushing changes,
        pulling remote updates, and resolving conflicts via three-way merge.
      </p>

      <h3>Table schema</h3>
      <p>
        All SQL-based adapters use the same table schema. Create this in your
        database:
      </p>
      <CodeBlock
        code={`CREATE TABLE files (
  id TEXT PRIMARY KEY,
  path TEXT,
  content TEXT,
  app TEXT,
  owner_id TEXT,
  last_updated BIGINT,
  created_at BIGINT
);

CREATE INDEX idx_files_app_owner ON files(app, owner_id);`}
        lang="sql"
      />

      <h3>Document IDs</h3>
      <p>
        The sync engine generates document IDs automatically in the format{" "}
        <code>{"{appId}__{path/with/__separators}"}</code>. For example, app{" "}
        <code>"my-app"</code> with file <code>data/projects/draft.json</code>{" "}
        becomes <code>"my-app__data__projects__draft.json"</code>. Your adapter
        just stores and retrieves these IDs — it doesn't need to generate them.
      </p>

      <h2 id="testing">Testing</h2>
      <p>
        Test your adapter against the five methods. Here's a minimal test
        pattern:
      </p>
      <CodeBlock
        code={`import { describe, it, expect } from "vitest";
import { MyDatabaseAdapter } from "./my-adapter";

describe("MyDatabaseAdapter", () => {
  const adapter = new MyDatabaseAdapter(testDb);

  it("set and get", async () => {
    await adapter.set("test-1", {
      path: "data/test.json",
      content: '{"hello":"world"}',
      app: "test-app",
      ownerId: "user-1",
      lastUpdated: Date.now(),
    });

    const result = await adapter.get("test-1");
    expect(result).not.toBeNull();
    expect(result!.data.path).toBe("data/test.json");
    expect(result!.data.content).toBe('{"hello":"world"}');
  });

  it("query filters by app and owner", async () => {
    const results = await adapter.query("test-app", "user-1");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.data.app === "test-app")).toBe(true);
  });

  it("delete removes the record", async () => {
    await adapter.delete("test-1");
    const result = await adapter.get("test-1");
    expect(result).toBeNull();
  });

  it("subscribe detects changes", async () => {
    const changes = await new Promise<any[]>((resolve) => {
      const unsub = adapter.subscribe("test-app", "user-1", (c) => {
        unsub();
        resolve(c);
      }, console.error);

      // Trigger a change
      adapter.set("test-2", {
        path: "data/new.json", content: "{}", app: "test-app",
        ownerId: "user-1", lastUpdated: Date.now(),
      });
    });

    expect(changes.some(c => c.type === "added")).toBe(true);
  });
});`}
      />

      <h2 id="publishing">Publishing</h2>
      <p>
        You can publish your adapter as a standalone npm package. Export the
        adapter class and any config types:
      </p>
      <CodeBlock
        code={`// package.json
{
  "name": "agent-native-adapter-turso",
  "peerDependencies": {
    "@agent-native/core": ">=0.2"
  }
}`}
        lang="json"
      />
      <p>
        Users install your package and pass it to <code>FileSync</code> — that's
        it. The adapter interface is stable and versioned with{" "}
        <code>@agent-native/core</code>.
      </p>
    </DocsLayout>
  );
}
