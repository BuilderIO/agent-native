import { createFileRoute } from "@tanstack/react-router";
import DocsLayout from "../../components/DocsLayout";
import CodeBlock from "../../components/CodeBlock";

export const Route = createFileRoute("/docs/file-sync")({
  component: FileSyncDocs,
  head: () => ({
    meta: [
      { title: "File Sync — Agent-Native" },
      {
        name: "description",
        content:
          "Sync agent-native app state across instances using Firestore, Supabase, or Convex.",
      },
    ],
  }),
});

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "quick-start", label: "Quick Start" },
  { id: "configuration", label: "Configuration" },
  { id: "backend-firestore", label: "Backend: Firestore" },
  { id: "backend-supabase", label: "Backend: Supabase" },
  { id: "backend-convex", label: "Backend: Convex" },
  { id: "create-file-sync-factory", label: "createFileSync()" },
  { id: "sync-status-diagnostics", label: "Sync Status & Diagnostics" },
  { id: "agent-native-parity", label: "Agent-Native Parity" },
  { id: "building-a-custom-adapter", label: "Building a Custom Adapter" },
  { id: "adapter-interface", label: "The Interface", indent: true },
  { id: "adapter-methods", label: "Implementing Methods", indent: true },
  { id: "adapter-full-example", label: "Full Example", indent: true },
  { id: "adapter-testing", label: "Testing", indent: true },
];

function FileSyncDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">File Sync</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Share state across multiple instances of an agent-native app through a
        remote database.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Overview                                                            */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="overview">Overview</h2>
      <p>
        File sync lets multiple instances of an agent-native app share state
        through a remote database. Files remain the primary source of truth —
        the database is a sync target, not a replacement. The sync engine
        watches the local file system for changes, pushes them to the database,
        and pulls remote updates back to disk.
      </p>
      <p>
        Three backends ship with <code>@agent-native/core</code>: Firestore,
        Supabase, and Convex. You can also build your own adapter for any
        backend.
      </p>
      <p>
        The sync engine handles file watching, pattern matching, conflict
        resolution (three-way merge), deduplication, and retry queues. Your
        backend adapter only needs to implement a small interface — the engine
        does everything else.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Quick Start                                                         */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="quick-start">Quick Start</h2>

      <h3>1. Install the peer dependency for your backend</h3>
      <CodeBlock
        code={`# Pick one:
pnpm add firebase-admin       # Firestore
pnpm add @supabase/supabase-js  # Supabase
pnpm add convex                # Convex`}
        lang="bash"
      />

      <h3>2. Set environment variables</h3>
      <CodeBlock
        code={`# .env
FILE_SYNC_ENABLED=true
FILE_SYNC_BACKEND=firestore   # or "supabase" or "convex"

# Backend-specific (see sections below)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json  # Firestore
# SUPABASE_URL=https://xyz.supabase.co                 # Supabase
# SUPABASE_ANON_KEY=eyJ...                             # Supabase
# CONVEX_URL=https://xyz.convex.cloud                  # Convex`}
        lang="bash"
      />

      <h3>3. Restart your app</h3>
      <p>
        The default template server already calls <code>createFileSync()</code>.
        Once the env vars are set, sync starts automatically on the next server
        boot.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Configuration                                                       */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="configuration">Configuration</h2>
      <p>
        Control which files sync with a <code>sync-config.json</code> file in
        your content root (typically <code>data/sync-config.json</code> or{" "}
        <code>content/sync-config.json</code>):
      </p>
      <CodeBlock
        code={`{
  "syncFilePatterns": [
    "data/**/*.json",
    "data/**/*.md",
    "!data/local-only/**"
  ],
  "privateSyncFilePatterns": [
    "data/private/**"
  ]
}`}
        lang="json"
      />

      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>syncFilePatterns</code>
            </td>
            <td>
              Glob patterns for files to sync. Supports negation with{" "}
              <code>!</code> prefix.
            </td>
          </tr>
          <tr>
            <td>
              <code>privateSyncFilePatterns</code>
            </td>
            <td>
              Patterns for files that sync to a per-user channel instead of the
              shared channel.
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Denylist</h3>
      <p>
        Regardless of your patterns, the sync engine always blocks sensitive and
        infrastructure files. These are never synced:
      </p>
      <ul>
        <li>
          <strong>Secrets:</strong> <code>.env*</code>, <code>*.key</code>,{" "}
          <code>*.pem</code>, <code>credentials.json</code>,{" "}
          <code>service-account*.json</code>, <code>.ssh/</code>,{" "}
          <code>.aws/</code>
        </li>
        <li>
          <strong>Infrastructure:</strong> <code>.git/</code>,{" "}
          <code>node_modules/</code>, <code>*.sqlite</code>, <code>*.db</code>,{" "}
          <code>*.tfstate</code>
        </li>
        <li>
          <strong>Sync meta-files:</strong> <code>sync-config.json</code>,{" "}
          <code>.sync-status.json</code>, <code>.sync-failures.json</code>
        </li>
        <li>
          <strong>Scratch files:</strong> <code>_tmp-*</code> (agent scratch
          space)
        </li>
        <li>
          <strong>Editor/OS junk:</strong> <code>*.swp</code>,{" "}
          <code>.DS_Store</code>, <code>Thumbs.db</code>
        </li>
      </ul>
      <p>
        The denylist is hardcoded and cannot be overridden by user patterns.
        This prevents accidental credential leaks.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Backend: Firestore                                                  */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="backend-firestore">Backend: Firestore</h2>
      <p>
        Firestore provides real-time listeners out of the box, so remote changes
        arrive with minimal latency.
      </p>

      <h3>Setup</h3>
      <ol>
        <li>
          Install the peer dependency:
          <CodeBlock code={`pnpm add firebase-admin`} lang="bash" />
        </li>
        <li>
          Create a service account in the Firebase console and download the JSON
          key file.
        </li>
        <li>
          Set the environment variables:
          <CodeBlock
            code={`FILE_SYNC_ENABLED=true
FILE_SYNC_BACKEND=firestore
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`}
            lang="bash"
          />
        </li>
      </ol>
      <p>
        The adapter stores documents in a <code>files</code> collection. No
        additional Firestore setup is required — the collection is created
        automatically on first write.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Backend: Supabase                                                   */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="backend-supabase">Backend: Supabase</h2>

      <h3>Setup</h3>
      <ol>
        <li>
          Install the peer dependency:
          <CodeBlock code={`pnpm add @supabase/supabase-js`} lang="bash" />
        </li>
        <li>
          Create the <code>files</code> table in your Supabase project:
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
        </li>
        <li>
          Set the environment variables:
          <CodeBlock
            code={`FILE_SYNC_ENABLED=true
FILE_SYNC_BACKEND=supabase
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_ANON_KEY=eyJ...`}
            lang="bash"
          />
        </li>
      </ol>

      <h3>Row Level Security</h3>
      <p>
        The default setup uses the anon key, which means Supabase RLS policies
        apply. If your <code>files</code> table has no RLS policies, reads and
        writes will be blocked. Either add appropriate policies or set{" "}
        <code>FILE_SYNC_SUPABASE_KEY_TYPE=service_role</code> with a{" "}
        <code>SUPABASE_SERVICE_ROLE_KEY</code> to bypass RLS (not recommended
        for multi-tenant production).
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Backend: Convex                                                     */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="backend-convex">Backend: Convex</h2>
      <p>
        Convex provides real-time reactivity built in — the adapter subscribes
        to query results and receives changes automatically when data updates.
      </p>

      <h3>Setup</h3>
      <ol>
        <li>
          Install the peer dependency:
          <CodeBlock code={`pnpm add convex`} lang="bash" />
        </li>
        <li>
          Initialize Convex in your project:
          <CodeBlock code={`npx convex init`} lang="bash" />
        </li>
        <li>
          Create the schema at <code>convex/schema.ts</code>:
          <CodeBlock
            code={`import { defineSchema, defineTable, v } from "convex/values";

export default defineSchema({
  files: defineTable({
    id: v.string(),
    path: v.string(),
    content: v.string(),
    app: v.string(),
    ownerId: v.string(),
    lastUpdated: v.number(),
    createdAt: v.optional(v.number()),
  })
    .index("by_id", ["id"])
    .index("by_app_owner", ["app", "ownerId"]),
});`}
          />
        </li>
        <li>
          Create the functions at <code>convex/files.ts</code>:
          <CodeBlock
            code={`import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { app: v.string(), ownerId: v.string() },
  handler: async (ctx, { app, ownerId }) => {
    return await ctx.db.query("files")
      .withIndex("by_app_owner", (q) => q.eq("app", app).eq("ownerId", ownerId))
      .collect();
  },
});

export const get = query({
  args: { id: v.string(), app: v.string(), ownerId: v.string() },
  handler: async (ctx, { id, app, ownerId }) => {
    const doc = await ctx.db.query("files")
      .withIndex("by_id", (q) => q.eq("id", id))
      .unique();
    if (doc && (doc.app !== app || doc.ownerId !== ownerId)) return null;
    return doc;
  },
});

export const upsert = mutation({
  args: {
    id: v.string(),
    path: v.optional(v.string()),
    content: v.optional(v.string()),
    app: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    lastUpdated: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("files")
      .withIndex("by_id", (q) => q.eq("id", args.id))
      .unique();
    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.path !== undefined) updates.path = args.path;
      if (args.content !== undefined) updates.content = args.content;
      if (args.lastUpdated !== undefined) updates.lastUpdated = args.lastUpdated;
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("files", {
        id: args.id,
        path: args.path!,
        content: args.content!,
        app: args.app!,
        ownerId: args.ownerId!,
        lastUpdated: args.lastUpdated!,
        createdAt: args.createdAt,
      });
    }
  },
});

export const remove = mutation({
  args: { id: v.string(), app: v.string(), ownerId: v.string() },
  handler: async (ctx, { id, app, ownerId }) => {
    const doc = await ctx.db.query("files")
      .withIndex("by_id", (q) => q.eq("id", id))
      .unique();
    if (doc && doc.app === app && doc.ownerId === ownerId) {
      await ctx.db.delete(doc._id);
    }
  },
});`}
          />
        </li>
        <li>
          Deploy to Convex:
          <CodeBlock code={`npx convex deploy`} lang="bash" />
        </li>
        <li>
          Set the environment variables:
          <CodeBlock
            code={`FILE_SYNC_ENABLED=true
FILE_SYNC_BACKEND=convex
CONVEX_URL=https://your-project.convex.cloud`}
            lang="bash"
          />
        </li>
      </ol>

      <h3>Security</h3>
      <p>
        The functions above have no authentication checks. In production, add
        Convex auth and validate the caller's identity in each function handler.
        Without auth, anyone with your deployment URL can read and write files.
      </p>

      <h3>Document size limit</h3>
      <p>
        Convex documents have a 1 MiB size limit. Files larger than this will
        fail to sync. If you need to sync large files, consider Firestore or
        Supabase instead.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* createFileSync() Factory                                            */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="create-file-sync-factory">
        The <code>createFileSync()</code> factory
      </h2>
      <p>
        The factory reads environment variables, creates the correct adapter,
        initializes sync, and returns a discriminated union so you can handle
        all three states cleanly:
      </p>
      <CodeBlock
        code={`import { createFileSync } from "@agent-native/core/adapters/sync";

const syncResult = await createFileSync({ contentRoot: "./data" });

// syncResult is one of:
// { status: "disabled" }               — FILE_SYNC_ENABLED !== "true"
// { status: "error", reason: string }  — misconfiguration or init failure
// { status: "ready", fileSync, sseEmitter, shutdown }`}
      />

      <h3>FileSyncResult</h3>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Fields</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>"disabled"</code>
            </td>
            <td>None</td>
            <td>
              <code>FILE_SYNC_ENABLED</code> is not <code>"true"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>"error"</code>
            </td>
            <td>
              <code>reason: string</code>
            </td>
            <td>Missing env vars, invalid backend, adapter init failure</td>
          </tr>
          <tr>
            <td>
              <code>"ready"</code>
            </td>
            <td>
              <code>fileSync</code>, <code>sseEmitter</code>,{" "}
              <code>shutdown</code>
            </td>
            <td>Sync is running</td>
          </tr>
        </tbody>
      </table>

      <h3>Wiring SSE</h3>
      <p>
        Pass <code>sseEmitter</code> to <code>createSSEHandler</code> so clients
        receive real-time sync events alongside file-watcher events:
      </p>
      <CodeBlock
        code={`const extraEmitters =
  syncResult.status === "ready" ? [syncResult.sseEmitter] : [];

app.get(
  "/api/events",
  createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
);`}
      />

      <h3>Shutdown</h3>
      <p>
        Call <code>shutdown()</code> on <code>SIGTERM</code> to flush the retry
        queue and close database connections:
      </p>
      <CodeBlock
        code={`process.on("SIGTERM", async () => {
  if (syncResult.status === "ready") await syncResult.shutdown();
  process.exit(0);
});`}
      />

      <h3>Template server example</h3>
      <p>
        The default template wires everything together. Here is the full server
        setup:
      </p>
      <CodeBlock
        code={`import "dotenv/config";
import fs from "fs";
import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { createFileSync } from "@agent-native/core/adapters/sync";

export async function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  // --- File sync (opt-in via FILE_SYNC_ENABLED=true) ---
  const syncResult = await createFileSync({ contentRoot: "./data" });

  if (syncResult.status === "error") {
    console.warn(\`[app] File sync failed: \${syncResult.reason}\`);
  }

  const extraEmitters =
    syncResult.status === "ready" ? [syncResult.sseEmitter] : [];

  // --- Your API routes ---
  app.get("/api/hello", (_req, res) => {
    res.json({ message: "Hello from your @agent-native/core app!" });
  });

  // File sync status (diagnostic endpoint)
  app.get("/api/file-sync/status", (_req, res) => {
    if (syncResult.status !== "ready") {
      return res.json({ enabled: false, conflicts: 0 });
    }
    res.json({
      enabled: true,
      connected: true,
      conflicts: syncResult.fileSync.conflictCount,
    });
  });

  // SSE events (keep this last)
  app.get(
    "/api/events",
    createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (syncResult.status === "ready") await syncResult.shutdown();
    process.exit(0);
  });

  return app;
}`}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Sync Status & Diagnostics                                           */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="sync-status-diagnostics">Sync Status & Diagnostics</h2>

      <h3>
        <code>data/.sync-status.json</code>
      </h3>
      <p>
        The sync engine writes a status file to disk on every state change. This
        file is readable by both the UI and the agent:
      </p>
      <CodeBlock
        code={`{
  "enabled": true,
  "connected": true,
  "conflicts": ["data/projects/draft.json"],
  "lastSyncedAt": 1710849600000,
  "retryQueueSize": 0,
  "failedPaths": []
}`}
        lang="json"
      />

      <h3>
        <code>data/.sync-failures.json</code>
      </h3>
      <p>
        When a file fails to sync after all retries (evicted from the retry
        queue or dropped at shutdown), an entry is appended to the failures log:
      </p>
      <CodeBlock
        code={`[
  {
    "path": "data/large-file.json",
    "reason": "evicted",
    "timestamp": 1710849600000
  }
]`}
        lang="json"
      />

      <h3>
        <code>GET /api/file-sync/status</code>
      </h3>
      <p>
        The template server exposes a diagnostic endpoint. Returns the current
        sync state as JSON:
      </p>
      <CodeBlock
        code={`// Response when sync is active
{ "enabled": true, "connected": true, "conflicts": 0 }

// Response when sync is off or failed
{ "enabled": false, "conflicts": 0 }`}
        lang="json"
      />

      <h3>
        <code>useFileSyncStatus()</code> hook
      </h3>
      <p>
        On the client, use the React hook to track sync state. It fetches
        initial status from the endpoint, then listens to SSE for real-time
        updates:
      </p>
      <CodeBlock
        code={`import { useFileSyncStatus } from "@agent-native/core/client";

function SyncIndicator() {
  const { enabled, connected, conflicts, lastSyncedAt } = useFileSyncStatus({
    onEvent: (event) => console.log("Sync event:", event),
  });

  if (!enabled) return null;

  return (
    <div>
      {connected ? "Synced" : "Disconnected"}
      {conflicts.length > 0 && <span> ({conflicts.length} conflicts)</span>}
    </div>
  );
}`}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Agent-Native Parity                                                 */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="agent-native-parity">Agent-Native Parity</h2>
      <p>
        File sync follows agent-native's core rule: files are the database. The
        agent reads and writes files — sync is transparent. A few conventions
        keep the agent in the loop:
      </p>

      <h3>Conflict notification</h3>
      <p>
        When a conflict cannot be auto-merged, the sync engine writes the
        details to <code>application-state/sync-conflict.json</code>. The agent
        can read this file and help resolve the conflict through chat:
      </p>
      <CodeBlock
        code={`// application-state/sync-conflict.json
{
  "type": "conflict-needs-llm",
  "path": "data/projects/draft.json",
  "localSnippet": "...(first 500 chars of local version)...",
  "remoteSnippet": "...(first 500 chars of remote version)..."
}`}
        lang="json"
      />

      <h3>Scratch files</h3>
      <p>
        Files prefixed with <code>_tmp-</code> are excluded from sync by the
        denylist. Use this prefix for agent scratch work that should not leave
        the local machine — draft outputs, intermediate computations, or
        temporary state.
      </p>

      <h3>Sync status for agents</h3>
      <p>
        The agent can read <code>data/.sync-status.json</code> to check whether
        sync is healthy, see active conflicts, or inspect the retry queue. This
        is the same file the UI reads — no separate agent API is needed.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Building a Custom Adapter                                           */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="building-a-custom-adapter">Building a Custom Adapter</h2>
      <p>
        If Firestore, Supabase, and Convex don't fit your stack, you can build
        an adapter for any backend — DynamoDB, MongoDB, Turso, a REST API,
        whatever you need. An adapter is a single class that implements six
        methods.
      </p>

      <h3 id="adapter-interface">The interface</h3>
      <p>
        Every adapter implements <code>FileSyncAdapter</code>:
      </p>
      <CodeBlock
        code={`import type {
  FileSyncAdapter,
  FileRecord,
  FileChange,
  Unsubscribe,
} from "@agent-native/core/adapters/sync";

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

      <h3 id="adapter-methods">Implementing methods</h3>

      <h4>query(appId, ownerId)</h4>
      <p>
        Return all file records for a given app and owner. Called at startup to
        load the initial state.
      </p>
      <CodeBlock
        code={`async query(appId: string, ownerId: string) {
  const rows = await db.select("files", { app: appId, owner_id: ownerId });
  return rows.map(row => ({ id: row.id, data: toFileRecord(row) }));
}`}
      />

      <h4>get(id)</h4>
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

      <h4>set(id, record)</h4>
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

      <h4>delete(id)</h4>
      <p>Delete a file record by ID.</p>
      <CodeBlock
        code={`async delete(id: string) {
  await db.remove("files", { id });
}`}
      />

      <h4>subscribe(appId, ownerId, onChange, onError)</h4>
      <p>
        Listen for remote changes and call <code>onChange</code> with an array
        of <code>FileChange</code> objects. Return an unsubscribe function.
      </p>
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
            If your database doesn't support real-time, poll on an interval.
            Keep an in-memory snapshot and diff against it.
          </p>
        </div>
      </div>
      <p>Polling approach (works with any database):</p>
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

      <h3 id="adapter-full-example">Full example</h3>
      <p>
        A complete adapter for a generic SQL database (e.g., Turso, PlanetScale,
        or any driver that supports parameterized queries):
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

export class MyCustomAdapter implements FileSyncAdapter {
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

      <h3>Wiring it up</h3>
      <p>
        Pass your adapter to <code>FileSync</code> in your server setup:
      </p>
      <CodeBlock
        code={`import { FileSync } from "@agent-native/core/adapters/sync";
import { MyCustomAdapter } from "./my-adapter";

const adapter = new MyCustomAdapter(dbClient);

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
      <p>All SQL-based adapters use the same table schema:</p>
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

      <h3 id="adapter-testing">Testing</h3>
      <p>Test your adapter against the five methods:</p>
      <CodeBlock
        code={`import { describe, it, expect } from "vitest";
import { MyCustomAdapter } from "./my-adapter";

describe("MyCustomAdapter", () => {
  const adapter = new MyCustomAdapter(testDb);

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

      <h3>Publishing</h3>
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
