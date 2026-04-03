import { Link } from "react-router";
import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "script-dispatcher", label: "Script Dispatcher" },
  { id: "parseargs", label: "parseArgs()" },
  { id: "standard-scripts", label: "Standard Scripts" },
  { id: "shared-agent-chat", label: "Shared Agent Chat" },
  { id: "utility-functions", label: "Utility Functions" },
];

export default function ScriptsDocs() {
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

      <h2 id="standard-scripts">Standard scripts</h2>
      <p>
        Every template should include these two scripts for{" "}
        <Link to="/docs/context-awareness" className="text-[var(--accent)]">
          context awareness
        </Link>
        :
      </p>
      <h3>view-screen</h3>
      <p>
        Reads the current navigation state, fetches contextual data, and returns
        a snapshot of what the user sees. The agent should always call this
        before acting.
      </p>
      <CodeBlock
        code={`// scripts/view-screen.ts
import { readAppState } from "@agent-native/core/application-state";

export default async function main() {
  const navigation = await readAppState("navigation");
  const screen: Record<string, unknown> = { navigation };

  if (navigation?.view === "inbox") {
    const res = await fetch("http://localhost:3000/api/emails?label=" + navigation.label);
    screen.emailList = await res.json();
  }

  console.log(JSON.stringify(screen, null, 2));
}`}
      />
      <CodeBlock code={`pnpm script view-screen`} lang="bash" />
      <h3>navigate</h3>
      <p>
        Writes a one-shot navigation command to application-state. The UI reads
        it, navigates, and deletes the entry.
      </p>
      <CodeBlock
        code={`// scripts/navigate.ts
import { parseArgs } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default async function main(args: string[]) {
  const parsed = parseArgs(args);
  await writeAppState("navigate", parsed);
  console.log("Navigate command written:", parsed);
}`}
      />
      <CodeBlock
        code={`pnpm script navigate --view inbox --threadId thread-123`}
        lang="bash"
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
    </DocsLayout>
  );
}
