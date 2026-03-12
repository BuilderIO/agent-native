import { createFileRoute } from '@tanstack/react-router'
import DocsLayout from '../../components/DocsLayout'
import CodeBlock from '../../components/CodeBlock'

export const Route = createFileRoute('/docs/scripts')({ component: ScriptsDocs })

const TOC = [
  { id: 'script-dispatcher', label: 'Script Dispatcher' },
  { id: 'parseargs', label: 'parseArgs()' },
  { id: 'shared-agent-chat', label: 'Shared Agent Chat' },
  { id: 'utility-functions', label: 'Utility Functions' },
  { id: 'firestore-adapter', label: 'Firestore Adapter' },
]

function ScriptsDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Scripts</h1>
      <p className="mb-8 text-base text-[var(--fg-secondary)]">
        <code>@agent-native/core</code> provides a script dispatcher and utilities for
        building agent-callable scripts.
      </p>

      <hr />

      <h2 id="script-dispatcher">Script Dispatcher</h2>
      <p>
        The script system lets you create scripts that agents can invoke via <code>pnpm script &lt;name&gt;</code>.
        Each script is a TypeScript file that exports a default async function.
      </p>
      <CodeBlock code={`// scripts/run.ts — dispatcher (one-time setup)
import { runScript } from "@agent-native/core";
runScript();`} />
      <CodeBlock code={`// scripts/hello.ts — example script
import { parseArgs } from "@agent-native/core";

export default async function hello(args: string[]) {
  const { name } = parseArgs(args);
  console.log(\`Hello, \${name ?? "world"}!\`);
}`} />
      <CodeBlock code={`# Run it
pnpm script hello --name Steve`} lang="bash" />

      <h2 id="parseargs">parseArgs(args)</h2>
      <p>Parse CLI arguments in <code>--key value</code> or <code>--key=value</code> format:</p>
      <CodeBlock code={`import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }`} />

      <h2 id="shared-agent-chat">Shared Agent Chat</h2>
      <p>
        <code>@agent-native/client</code> provides an isomorphic chat bridge that works in
        both browser and Node.js:
      </p>
      <CodeBlock code={`import { agentChat } from "@agent-native/client";

// Auto-submit a message
agentChat.submit("Generate a report for Q4");

// Prefill without submitting
agentChat.prefill("Draft an email to...", contextData);

// Full control
agentChat.send({
  message: "Process this data",
  context: JSON.stringify(data),
  submit: true,
});`} />
      <p>
        In the browser, messages are sent via <code>window.postMessage()</code>.
        In Node.js (scripts), they use the <code>BUILDER_PARENT_MESSAGE:</code> stdout
        format that the Electron host translates to postMessage.
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
            ['loadEnv(path?)', 'void', 'Load .env from project root (or custom path)'],
            ['camelCaseArgs(args)', 'Record', 'Convert kebab-case keys to camelCase'],
            ['isValidPath(p)', 'boolean', 'Validate relative path (no traversal, no absolute)'],
            ['isValidProjectPath(p)', 'boolean', 'Validate project slug (e.g. "my-project")'],
            ['ensureDir(dir)', 'void', 'mkdir -p helper'],
            ['fail(message)', 'never', 'Print error to stderr and exit(1)'],
          ].map(([name, type, desc]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="font-mono text-xs">{type}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="firestore-adapter">Firestore Adapter</h2>
      <p>
        For apps that need bidirectional file sync across instances,
        import from <code>@agent-native/core/adapters/firestore</code>:
      </p>
      <CodeBlock code={`import { FileSync } from "@agent-native/core/adapters/firestore";

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
    </DocsLayout>
  )
}
