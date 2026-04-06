import { Link } from "react-router";
import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "action-dispatcher", label: "Action Dispatcher" },
  { id: "parseargs", label: "parseArgs()" },
  { id: "standard-actions", label: "Standard Actions" },
  { id: "shared-agent-chat", label: "Shared Agent Chat" },
  { id: "utility-functions", label: "Utility Functions" },
];

export default function ActionsDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Actions</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        <code>@agent-native/core</code> provides an action dispatcher and
        utilities for building agent-callable actions.
      </p>

      <h2 id="action-dispatcher">Action Dispatcher</h2>
      <p>
        The action system lets you create actions that agents can invoke via{" "}
        <code>pnpm action &lt;name&gt;</code>. Each action is a TypeScript file
        that exports a default async function.
      </p>
      <CodeBlock
        code={`// actions/run.ts — dispatcher (one-time setup)
import { runScript } from "@agent-native/core";
runScript();`}
      />
      <CodeBlock
        code={`// actions/hello.ts — example action
import { parseArgs } from "@agent-native/core";

export default async function hello(args: string[]) {
  const { name } = parseArgs(args);
  console.log(\`Hello, \${name ?? "world"}!\`);
}`}
      />
      <CodeBlock
        code={`# Run it
pnpm action hello --name Steve`}
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

      <h2 id="standard-actions">Standard actions</h2>
      <p>
        Every template should include these two actions for{" "}
        <Link to="/docs/context-awareness" className="text-[var(--accent)]">
          context awareness
        </Link>
        :
      </p>
      <h3 id="view-screen">view-screen</h3>
      <p>
        Reads the current navigation state, fetches contextual data, and returns
        a snapshot of what the user sees. The agent should always call this
        before acting.
      </p>
      <CodeBlock
        code={`// actions/view-screen.ts
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
      <CodeBlock code={`pnpm action view-screen`} lang="bash" />
      <h3 id="navigate">navigate</h3>
      <p>
        Writes a one-shot navigation command to application-state. The UI reads
        it, navigates, and deletes the entry.
      </p>
      <CodeBlock
        code={`// actions/navigate.ts
import { parseArgs } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default async function main(args: string[]) {
  const parsed = parseArgs(args);
  await writeAppState("navigate", parsed);
  console.log("Navigate command written:", parsed);
}`}
      />
      <CodeBlock
        code={`pnpm action navigate --view inbox --threadId thread-123`}
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
        In Node.js (actions), they use the <code>BUILDER_PARENT_MESSAGE:</code>{" "}
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
