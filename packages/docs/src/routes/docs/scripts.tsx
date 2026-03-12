import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/docs/scripts')({ component: ScriptsDocs })

function ScriptsDocs() {
  return (
    <main className="page-wrap px-4 pb-8 pt-10">
      <h1 className="display-title mb-4 text-3xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
        Scripts
      </h1>
      <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)]">
        <code>@agent-native/core/scripts</code> provides a script dispatcher and utilities for
        building agent-callable scripts.
      </p>

      <section className="prose-section mb-10">
        <h2>Script Dispatcher</h2>
        <p>
          The script system lets you create scripts that agents can invoke via <code>pnpm script &lt;name&gt;</code>.
          Each script is a TypeScript file that exports a default async function.
        </p>
        <Pre code={`// scripts/run.ts — dispatcher (one-time setup)
import { runScript } from "@agent-native/core/scripts";
runScript();`} />
        <Pre code={`// scripts/hello.ts — example script
import { parseArgs } from "@agent-native/core/scripts";

export default async function hello(args: string[]) {
  const { name } = parseArgs(args);
  console.log(\`Hello, \${name ?? "world"}!\`);
}`} />
        <Pre code={`# Run it
pnpm script hello --name Steve`} />
      </section>

      <section className="prose-section mb-10">
        <h2>parseArgs(args)</h2>
        <p>Parse CLI arguments in <code>--key value</code> or <code>--key=value</code> format:</p>
        <Pre code={`import { parseArgs } from "@agent-native/core/scripts";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }`} />
      </section>

      <section className="prose-section mb-10">
        <h2>Shared Fusion Chat</h2>
        <p>
          <code>@agent-native/core/shared</code> provides an isomorphic chat bridge that works in
          both browser and Node.js:
        </p>
        <Pre code={`import { fusionChat } from "@agent-native/core/shared";

// Auto-submit a message
fusionChat.submit("Generate a report for Q4");

// Prefill without submitting
fusionChat.prefill("Draft an email to...", contextData);

// Full control
fusionChat.send({
  message: "Process this data",
  context: JSON.stringify(data),
  submit: true,
});`} />
        <p>
          In the browser, messages are sent via <code>window.postMessage()</code>.
          In Node.js (scripts), they use the <code>BUILDER_PARENT_MESSAGE:</code> stdout
          format that the Electron host translates to postMessage.
        </p>
      </section>

      <section className="prose-section mb-10">
        <h2>Utility Functions</h2>
        <Props items={[
          ['loadEnv(path?)', 'void', 'Load .env from project root (or custom path)'],
          ['camelCaseArgs(args)', 'Record', 'Convert kebab-case keys to camelCase'],
          ['isValidPath(p)', 'boolean', 'Validate relative path (no traversal, no absolute)'],
          ['isValidProjectPath(p)', 'boolean', 'Validate project slug (e.g. "my-project")'],
          ['ensureDir(dir)', 'void', 'mkdir -p helper'],
          ['fail(message)', 'never', 'Print error to stderr and exit(1)'],
        ]} />
      </section>

      <section className="prose-section mb-10">
        <h2>Firestore Adapter</h2>
        <p>
          For apps that need bidirectional file sync across instances,
          import from <code>@agent-native/core/adapters/firestore</code>:
        </p>
        <Pre code={`import { FileSync } from "@agent-native/core/adapters/firestore";

const sync = new FileSync({
  appId: "my-app",
  ownerId: "owner-123",
  contentRoot: "./content",
  getFileCollection: () => db.collection("fusionAppFiles"),
});

await sync.initFileSync();`} />
        <p>
          Features: startup sync, real-time Firestore listeners, chokidar file watchers,
          three-way merge with LCS-based conflict resolution, and <code>.conflict</code> sidecar
          files for unresolvable conflicts.
        </p>
      </section>
    </main>
  )
}

function Pre({ code }: { code: string }) {
  return (
    <pre className="my-3 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-xs leading-relaxed text-[var(--sea-ink)]">
      <code>{code}</code>
    </pre>
  )
}

function Props({ items }: { items: [string, string, string][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--line)]">
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Function</th>
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Returns</th>
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Description</th>
          </tr>
        </thead>
        <tbody className="text-[var(--sea-ink-soft)]">
          {items.map(([name, type, desc]) => (
            <tr key={name} className="border-b border-[var(--line)] last:border-0">
              <td className="px-4 py-2 font-mono text-xs text-[var(--lagoon-deep)]">{name}</td>
              <td className="px-4 py-2 font-mono text-xs">{type}</td>
              <td className="px-4 py-2">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
