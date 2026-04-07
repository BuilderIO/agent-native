import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "the-interface", label: "The Interface" },
  { id: "shell-adapter", label: "ShellCliAdapter" },
  { id: "registry", label: "Registry" },
  { id: "custom-adapter", label: "Custom Adapters" },
  { id: "server-route", label: "Server Route" },
  { id: "from-scripts", label: "Using from Scripts" },
];

export default function CliAdaptersDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        CLI Adapters
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Give your agent structured access to any CLI tool — with discovery,
        execution, and consistent output handling.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        Agents are great at running CLI commands. But without structure, every
        script reinvents how to invoke a CLI, check if it's installed, and parse
        its output.
      </p>
      <p>
        CLI adapters solve this with a small interface. Each adapter wraps a single CLI (
        <code>gh</code>, <code>ffmpeg</code>, <code>stripe</code>,{" "}
        <code>aws</code>) and provides:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Discovery</strong> — the agent can list what CLIs are
          available and what they do
        </li>
        <li>
          <strong>Availability checks</strong> — is the CLI installed?
        </li>
        <li>
          <strong>Consistent execution</strong> — stdout, stderr, and exit code
          in a standard format
        </li>
      </ul>

      <h2 id="the-interface">The interface</h2>
      <p>
        Every CLI adapter implements <code>CliAdapter</code>:
      </p>
      <CodeBlock
        code={`import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";

interface CliAdapter {
  name: string;           // "gh", "stripe", "ffmpeg"
  description: string;    // What the agent sees during discovery
  isAvailable(): Promise<boolean>;
  execute(args: string[]): Promise<CliResult>;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}`}
      />

      <h2 id="shell-adapter">ShellCliAdapter</h2>
      <p>
        For most CLIs, you don't need a custom class.{" "}
        <code>ShellCliAdapter</code> wraps any CLI binary with sensible
        defaults:
      </p>
      <CodeBlock
        code={`import { ShellCliAdapter } from "@agent-native/core/adapters/cli";

const gh = new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI — manage repos, PRs, issues, and releases",
});

const ffmpeg = new ShellCliAdapter({
  command: "ffmpeg",
  description: "Audio/video processing and transcoding",
  timeoutMs: 120_000, // 2 min for long encodes
});

const stripe = new ShellCliAdapter({
  command: "stripe",
  description: "Stripe CLI — manage payments, webhooks, and customers",
  env: { STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY! },
});`}
      />
      <h3 id="shell-adapter-options">Options</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>command</code>
              </td>
              <td>string</td>
              <td>Binary name or path (required)</td>
            </tr>
            <tr>
              <td>
                <code>description</code>
              </td>
              <td>string</td>
              <td>What the CLI does — shown to the agent (required)</td>
            </tr>
            <tr>
              <td>
                <code>name</code>
              </td>
              <td>string</td>
              <td>
                Display name (defaults to <code>command</code>)
              </td>
            </tr>
            <tr>
              <td>
                <code>env</code>
              </td>
              <td>Record</td>
              <td>Extra environment variables merged with process.env</td>
            </tr>
            <tr>
              <td>
                <code>cwd</code>
              </td>
              <td>string</td>
              <td>Working directory (defaults to process.cwd())</td>
            </tr>
            <tr>
              <td>
                <code>timeoutMs</code>
              </td>
              <td>number</td>
              <td>Execution timeout (default: 30000)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="registry">Registry</h2>
      <p>
        The <code>CliRegistry</code> collects adapters so the agent can discover
        what's available at runtime:
      </p>
      <CodeBlock
        code={`import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();

cliRegistry.register(new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI — manage repos, PRs, issues, and releases",
}));

cliRegistry.register(new ShellCliAdapter({
  command: "ffmpeg",
  description: "Audio/video processing and transcoding",
}));

// List all registered CLIs
cliRegistry.list();
// → [{ name: "gh", ... }, { name: "ffmpeg", ... }]

// List only installed CLIs
await cliRegistry.listAvailable();
// → [{ name: "gh", ... }]  (if ffmpeg isn't installed)

// Get a full summary for agent discovery
await cliRegistry.describe();
// → [{ name: "gh", description: "...", available: true },
//    { name: "ffmpeg", description: "...", available: false }]

// Execute a command
const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
console.log(result?.stdout);`}
      />

      <h2 id="custom-adapter">Custom adapters</h2>
      <p>
        When you need more than <code>ShellCliAdapter</code> provides — custom
        auth, output parsing, or pre/post processing — implement{" "}
        <code>CliAdapter</code> directly:
      </p>
      <CodeBlock
        code={`import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";
import { execFile } from "node:child_process";

export class DockerAdapter implements CliAdapter {
  name = "docker";
  description = "Docker container management — build, run, and manage containers";

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.execute(["info", "--format", "{{.ServerVersion}}"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async execute(args: string[]): Promise<CliResult> {
    return new Promise((resolve) => {
      execFile("docker", args, {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf-8",
      }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: (error as any)?.code ?? 0,
        });
      });
    });
  }
}`}
      />

      <h2 id="server-route">Server route</h2>
      <p>
        Expose the registry to the UI via an API route so actions and components
        can discover and invoke CLIs:
      </p>
      <CodeBlock
        code={`// server/index.ts
import { createServer } from "@agent-native/core";
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const app = createServer();
const cliRegistry = new CliRegistry();

cliRegistry.register(new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI",
}));

// Discovery endpoint — agent can query this
app.get("/api/cli", async (_req, res) => {
  const tools = await cliRegistry.describe();
  res.json(tools);
});

// Execution endpoint
app.post("/api/cli/:name", async (req, res) => {
  const adapter = cliRegistry.get(req.params.name);
  if (!adapter) return res.status(404).json({ error: "CLI not found" });

  const { args } = req.body;
  const result = await adapter.execute(args ?? []);
  res.json(result);
});`}
      />

      <h2 id="from-actions">Using from actions</h2>
      <p>Actions can use CLI adapters directly for structured access:</p>
      <CodeBlock
        code={`// actions/list-prs.ts
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";

export const meta = () => [
      { title: "CLI Adapters — Agent-Native" },
      {
        name: "description",
        content:
          "Connect any CLI tool to your agent-native app with a standard adapter interface for discovery and execution.",
      },
    ];

const gh = new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI",
});

export default async function listPrs() {
  if (!await gh.isAvailable()) {
    console.error("GitHub CLI not installed. Run: brew install gh");
    process.exit(1);
  }

  const result = await gh.execute([
    "pr", "list", "--json", "title,url,state", "--limit", "10"
  ]);

  if (result.exitCode !== 0) {
    console.error(result.stderr);
    process.exit(1);
  }

  const prs = JSON.parse(result.stdout);
  const fs = await import("node:fs/promises");
  await fs.writeFile("data/prs.json", JSON.stringify(prs, null, 2));
  console.log(\`Fetched \${prs.length} PRs\`);
}`}
      />
      <p>
        Or skip the adapter entirely and call the CLI directly in a script —
        adapters are useful when you want discovery, availability checks, and
        consistent error handling, but they're not required. Use whichever
        approach fits.
      </p>
    </DocsLayout>
  );
}
