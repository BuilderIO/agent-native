import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

export const meta = () => [
  { title: "File Sync — Agent-Native" },
  {
    name: "description",
    content: "Sync agent-native app state across instances with zero config.",
  },
];

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "setup", label: "Setup" },
  { id: "configuration", label: "Configuration" },
  { id: "external-backends", label: "External Backends" },
  { id: "custom-adapters", label: "Custom Adapters" },
];

export default function FileSyncDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">File Sync</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Share state across multiple instances of an agent-native app through a
        database.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Overview                                                            */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="overview">Overview</h2>
      <p>
        File sync watches your local files, pushes changes to a database, and
        pulls remote updates back to disk. Files stay the source of truth — the
        database is just a sync target.
      </p>
      <p>
        Out of the box it uses Drizzle with SQLite — no external services, no
        extra packages. Just add a config file with your sync patterns and
        you're done.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Setup                                                               */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="setup">Setup</h2>
      <p>
        Create a <code>sync-config.json</code> in your content root (typically{" "}
        <code>data/</code>) with the file patterns you want to sync:
      </p>
      <CodeBlock
        code={`{
  "syncFilePatterns": [
    "data/**/*.json",
    "data/**/*.md",
    "!data/local-only/**"
  ]
}`}
        lang="json"
      />
      <p>
        That's it. When Drizzle is set up (which it is by default), the sync
        engine detects the config file and starts syncing automatically. The
        SQLite database is created at <code>data/sync.db</code> on first run.
      </p>
      <p>
        The default template server already calls <code>createFileSync()</code>{" "}
        — no server code changes needed.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Configuration                                                       */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="configuration">Configuration</h2>

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
        The sync engine always blocks sensitive files regardless of your
        patterns — <code>.env*</code>, <code>*.key</code>,{" "}
        <code>node_modules/</code>, <code>.git/</code>, <code>*.db</code>, and
        editor/OS junk files. This prevents accidental credential leaks.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* External Backends                                                   */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="external-backends">External Backends</h2>
      <p>
        For multi-server deployments or real-time team sync, you can swap the
        default SQLite backend for an external database. Set{" "}
        <code>FILE_SYNC_BACKEND</code> in your <code>.env</code>:
      </p>

      <h3>Firestore</h3>
      <CodeBlock code={`pnpm add firebase-admin`} lang="bash" />
      <CodeBlock
        code={`FILE_SYNC_BACKEND=firestore
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`}
        lang="bash"
      />
      <p>
        The collection is created automatically — no additional setup needed.
      </p>

      <h3>Supabase</h3>
      <CodeBlock code={`pnpm add @supabase/supabase-js`} lang="bash" />
      <CodeBlock
        code={`FILE_SYNC_BACKEND=supabase
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
        lang="bash"
      />
      <p>
        Supabase requires a <code>files</code> table:
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

      <h3>Convex</h3>
      <CodeBlock code={`pnpm add convex`} lang="bash" />
      <CodeBlock
        code={`FILE_SYNC_BACKEND=convex
CONVEX_URL=https://your-project.convex.cloud`}
        lang="bash"
      />
      <p>
        Convex requires a schema and functions — see the{" "}
        <a
          href="https://github.com/AgeNative/agent-native"
          target="_blank"
          rel="noopener"
        >
          repo README
        </a>{" "}
        for the full Convex setup.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Custom Adapters                                                     */}
      {/* ------------------------------------------------------------------ */}

      <h2 id="custom-adapters">Custom Adapters</h2>
      <p>
        If the built-in backends don't fit, you can implement the{" "}
        <code>FileSyncAdapter</code> interface from{" "}
        <code>@agent-native/core/adapters/sync</code> for any database. An
        adapter is a single class with five methods: <code>query</code>,{" "}
        <code>get</code>, <code>set</code>, <code>delete</code>, and{" "}
        <code>subscribe</code>. The sync engine handles file watching, conflict
        resolution, and retry queues — your adapter just talks to the database.
      </p>
      <CodeBlock
        code={`import type { FileSyncAdapter, FileRecord, FileChange, Unsubscribe }
  from "@agent-native/core/adapters/sync";

class MyAdapter implements FileSyncAdapter {
  async query(appId: string, ownerId: string) { /* return all records */ }
  async get(id: string) { /* return one record or null */ }
  async set(id: string, record: Partial<FileRecord>) { /* upsert */ }
  async delete(id: string) { /* remove */ }
  subscribe(appId: string, ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: any) => void): Unsubscribe { /* listen for changes */ }
}`}
      />
      <p>
        Pass your adapter to <code>FileSync</code> and call{" "}
        <code>initFileSync()</code> — the engine does the rest.
      </p>
    </DocsLayout>
  );
}
