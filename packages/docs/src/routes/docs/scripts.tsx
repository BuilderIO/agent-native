import { createFileRoute } from "@tanstack/react-router";
import DocsLayout from "../../components/DocsLayout";
import CodeBlock from "../../components/CodeBlock";

export const Route = createFileRoute("/docs/scripts")({
  component: ScriptsDocs,
});

const TOC = [
  { id: "script-dispatcher", label: "Script Dispatcher" },
  { id: "parseargs", label: "parseArgs()" },
  { id: "shared-agent-chat", label: "Shared Agent Chat" },
  { id: "utility-functions", label: "Utility Functions" },
  { id: "database-sync-adapters", label: "Database Sync Adapters" },
];

function ScriptsDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Scripts</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        <code>@agent-native/core</code> provides a script dispatcher and
        utilities for building agent-callable scripts.
      </p>

      <h2 id="script-dispatcher">Script Dispatcher</h2>
      <p>
        The script system lets you create scripts that agents can invoke via{" "}
        <code>pnpm script &lt;name&gt;</code>. Each script is a TypeScript file
        that exports a default async function.
      </p>
      <CodeBlock
        code={`// scripts/run.ts — dispatcher (one-time setup)
import { runScript } from "@agent-native/core";
runScript();`}
      />
      <CodeBlock
        code={`// scripts/hello.ts — example script
import { parseArgs } from "@agent-native/core";

export default async function hello(args: string[]) {
  const { name } = parseArgs(args);
  console.log(\`Hello, \${name ?? "world"}!\`);
}`}
      />
      <CodeBlock
        code={`# Run it
pnpm script hello --name Steve`}
        lang="bash"
      />

      <h2 id="parseargs">parseArgs(args)</h2>
      <p>
        Parse CLI arguments in <code>--key value</code> or{" "}
        <code>--key=value</code> format:
      </p>
      <CodeBlock
        code={`import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }`}
      />

      <h2 id="shared-agent-chat">Shared Agent Chat</h2>
      <p>
        <code>@agent-native/core</code> provides an isomorphic chat bridge that
        works in both browser and Node.js:
      </p>
      <CodeBlock
        code={`import { agentChat } from "@agent-native/core";

// Auto-submit a message
agentChat.submit("Generate a report for Q4");

// Prefill without submitting
agentChat.prefill("Draft an email to...", contextData);

// Full control
agentChat.send({
  message: "Process this data",
  context: JSON.stringify(data),
  submit: true,
});`}
      />
      <p>
        In the browser, messages are sent via <code>window.postMessage()</code>.
        In Node.js (scripts), they use the <code>BUILDER_PARENT_MESSAGE:</code>{" "}
        stdout format that the Electron host translates to postMessage.
      </p>

      <h2 id="utility-functions">Utility Functions</h2>
      <table>
        <thead>
          <tr>
            <th>Function</th>
            <th>Returns</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "loadEnv(path?)",
              "void",
              "Load .env from project root (or custom path)",
            ],
            [
              "camelCaseArgs(args)",
              "Record",
              "Convert kebab-case keys to camelCase",
            ],
            [
              "isValidPath(p)",
              "boolean",
              "Validate relative path (no traversal, no absolute)",
            ],
            [
              "isValidProjectPath(p)",
              "boolean",
              'Validate project slug (e.g. "my-project")',
            ],
            ["ensureDir(dir)", "void", "mkdir -p helper"],
            ["fail(message)", "never", "Print error to stderr and exit(1)"],
          ].map(([name, type, desc]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="font-mono text-xs">{type}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="database-sync-adapters">Database Sync Adapters</h2>
      <p>
        For apps that need bidirectional file sync across instances,
        agent-native provides adapters for{" "}
        <strong>Google Cloud Firestore</strong> and <strong>Supabase</strong>{" "}
        (Postgres). All adapters implement the same <code>FileSyncAdapter</code>{" "}
        interface and plug into <code>FileSync</code>:
      </p>
      <CodeBlock
        code={`// Google Cloud Firestore
import { FileSync, FirestoreFileSyncAdapter } from "@agent-native/core/adapters/firestore";

const adapter = new FirestoreFileSyncAdapter(() => db.collection("files"));
const sync = new FileSync({
  appId: "my-app",
  ownerId: "owner-123",
  contentRoot: "./content",
  adapter,
});
await sync.initFileSync();`}
      />
      <CodeBlock
        code={`// Supabase
import { FileSync, SupabaseFileSyncAdapter } from "@agent-native/core/adapters/supabase";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const adapter = new SupabaseFileSyncAdapter(supabase);
const sync = new FileSync({
  appId: "my-app",
  ownerId: "owner-123",
  contentRoot: "./content",
  adapter,
});
await sync.initFileSync();`}
      />
      <p>
        All adapters support: startup sync, remote change listeners, chokidar
        file watchers, three-way merge with LCS-based conflict resolution, and{" "}
        <code>.conflict</code> sidecar files for unresolvable conflicts.
      </p>
      <p>
        Supabase requires a <code>files</code> table. Run this migration:
      </p>
      <CodeBlock
        code={`CREATE TABLE files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  app TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  last_updated BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT
);
CREATE INDEX idx_files_app_owner ON files(app, owner_id);`}
        lang="sql"
      />
      <p>
        The adapter interface (<code>@agent-native/core/adapters/sync</code>) is
        also available for building custom adapters for other databases.
      </p>
    </DocsLayout>
  );
}
