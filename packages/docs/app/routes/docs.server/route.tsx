import DocsLayout from "../../components/DocsLayout";
import CodeBlock from "../../components/CodeBlock";

const TOC = [
  { id: "file-based-routing", label: "File-Based Routing" },
  { id: "server-plugins", label: "Server Plugins" },
  { id: "shared-state", label: "Shared State" },
  { id: "createfilewatcher", label: "createFileWatcher()" },
  { id: "createssehandler", label: "createSSEHandler()" },
  { id: "createserver", label: "createServer()" },
  { id: "mountauthmiddleware", label: "mountAuthMiddleware()" },
  {
    id: "createproductionagenthandler",
    label: "createProductionAgentHandler()",
  },
];

export default function ServerDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Server</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-native apps use{" "}
        <a href="https://nitro.build" target="_blank" rel="noopener noreferrer">
          Nitro
        </a>{" "}
        for the server layer. Nitro is included automatically via the{" "}
        <code>defineConfig()</code> Vite plugin — you get file-based API
        routing, server plugins, and deploy-anywhere presets out of the box.
      </p>

      <h2 id="file-based-routing">File-Based Routing</h2>
      <p>
        API routes live in <code>server/routes/</code>. Nitro auto-discovers
        them based on file name and path:
      </p>
      <CodeBlock
        code={`server/routes/
  api/
    hello.get.ts          → GET  /api/hello
    items/
      index.get.ts        → GET  /api/items
      index.post.ts       → POST /api/items
      [id].get.ts         → GET  /api/items/:id
      [id].delete.ts      → DELETE /api/items/:id
      [id]/
        archive.patch.ts  → PATCH /api/items/:id/archive`}
        lang="text"
      />
      <p>
        Each route file exports a default <code>defineEventHandler</code>:
      </p>
      <CodeBlock
        code={`// server/routes/api/items/index.get.ts
import { defineEventHandler } from "h3";
import fs from "fs/promises";

export default defineEventHandler(async () => {
  const files = await fs.readdir("./data/items");
  const items = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => JSON.parse(await fs.readFile(\`./data/items/\${f}\`, "utf-8"))),
  );
  return items;
});`}
      />

      <h3>Route naming conventions</h3>
      <table>
        <thead>
          <tr>
            <th>File name pattern</th>
            <th>HTTP method</th>
            <th>Example path</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["index.get.ts", "GET", "/api/items"],
            ["index.post.ts", "POST", "/api/items"],
            ["[id].get.ts", "GET", "/api/items/:id"],
            ["[id].patch.ts", "PATCH", "/api/items/:id"],
            ["[id].delete.ts", "DELETE", "/api/items/:id"],
            ["[...slug].get.ts", "GET", "/api/items/* (catch-all)"],
          ].map(([file, method, path]) => (
            <tr key={file}>
              <td>
                <code>{file}</code>
              </td>
              <td>{method}</td>
              <td>
                <code>{path}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Accessing route parameters</h3>
      <CodeBlock
        code={`import { defineEventHandler, getRouterParam, readBody, getQuery } from "h3";

// GET /api/items/:id
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const { filter } = getQuery(event);
  // ...
});`}
      />

      <h2 id="server-plugins">Server Plugins</h2>
      <p>
        Cross-cutting concerns — file watchers, file sync, scheduled jobs, auth
        — go in <code>server/plugins/</code>. Nitro runs these at startup before
        serving requests:
      </p>
      <CodeBlock
        code={`// server/plugins/file-sync.ts
import { defineNitroPlugin } from "@agent-native/core";
import { createFileSync } from "@agent-native/core/adapters/sync";

export default defineNitroPlugin(async () => {
  const result = await createFileSync({ contentRoot: "./data" });
  if (result.status === "error") {
    console.warn(\`[app] File sync failed: \${result.reason}\`);
  }
});`}
      />

      <h2 id="shared-state">Shared State Between Plugins and Routes</h2>
      <p>
        Use a shared module in <code>server/lib/</code> to pass state from
        plugins to route handlers:
      </p>
      <CodeBlock
        code={`// server/lib/watcher.ts
import { createFileWatcher } from "@agent-native/core";
import type { SSEHandlerOptions } from "@agent-native/core";

export const watcher = createFileWatcher("./data");
export const sseExtraEmitters: NonNullable<SSEHandlerOptions["extraEmitters"]> = [];

export let syncResult: any = { status: "disabled" };
export function setSyncResult(result: any) {
  syncResult = result;
  if (result.status === "ready" && result.sseEmitter) {
    sseExtraEmitters.push(result.sseEmitter);
  }
}`}
      />
      <p>
        The plugin populates the state at startup; route handlers read it at
        request time.
      </p>

      <h2 id="createfilewatcher">createFileWatcher(dir, options?)</h2>
      <p>
        Creates a chokidar file watcher for real-time file change detection:
      </p>
      <CodeBlock
        code={`import { createFileWatcher } from "@agent-native/core";

const watcher = createFileWatcher("./data");
// watcher emits "all" events: (eventName, filePath)`}
      />

      <h3>Options</h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["ignored", "any", "Glob patterns or regex to ignore"],
            [
              "emitInitial",
              "boolean",
              "Emit events for initial file scan. Default: false",
            ],
          ].map(([name, type, desc]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="font-mono text-xs">{type}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="createssehandler">createSSEHandler(watcher, options?)</h2>
      <p>
        Creates an H3 event handler that streams file changes as Server-Sent
        Events:
      </p>
      <CodeBlock
        code={`// server/routes/api/events.get.ts
import { createSSEHandler } from "@agent-native/core";
import { watcher, sseExtraEmitters } from "../../lib/watcher.js";

export default createSSEHandler(watcher, {
  extraEmitters: sseExtraEmitters,
  contentRoot: "./data",
});`}
      />
      <p>
        Each SSE message is JSON:{" "}
        <code>{`{ "type": "change", "path": "data/file.json" }`}</code>
      </p>

      <h3>Options</h3>
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
            <td>extraEmitters</td>
            <td className="font-mono text-xs">{"Array<{ emitter, event }>"}</td>
            <td>Additional EventEmitters to stream</td>
          </tr>
          <tr>
            <td>contentRoot</td>
            <td className="font-mono text-xs">string</td>
            <td>Root directory used to relativize paths in events</td>
          </tr>
        </tbody>
      </table>

      <h2 id="createserver">createServer(options?)</h2>
      <p>
        Optional helper that creates a pre-configured H3 app with CORS
        middleware and a health-check route. Returns{" "}
        <code>{`{ app, router }`}</code>. Useful for programmatic route
        registration when file-based routing doesn't fit:
      </p>
      <CodeBlock
        code={`import { createServer } from "@agent-native/core";
import { defineEventHandler } from "h3";

const { app, router } = createServer();
router.get("/api/items", defineEventHandler(listItems));`}
      />

      <h2 id="mountauthmiddleware">mountAuthMiddleware(app, accessToken)</h2>
      <p>
        Mounts session-cookie authentication onto an H3 app. Serves a login page
        for unauthenticated browser requests and returns 401 for unauthenticated
        API requests.
      </p>
      <CodeBlock
        code={`import { mountAuthMiddleware } from "@agent-native/core";

mountAuthMiddleware(app, process.env.ACCESS_TOKEN!);`}
      />
      <p>
        Adds two routes automatically: <code>POST /api/auth/login</code> and{" "}
        <code>POST /api/auth/logout</code>.
      </p>

      <h2 id="createproductionagenthandler">
        createProductionAgentHandler(options)
      </h2>
      <p>
        Creates an H3 SSE handler at <code>POST /api/agent-chat</code> that runs
        an agentic tool loop using Claude. Each script's <code>run()</code>{" "}
        function is registered as a tool the agent can invoke.
      </p>
      <CodeBlock
        code={`import { createProductionAgentHandler } from "@agent-native/core";
import { scripts } from "./scripts/registry.js";
import { readFileSync } from "fs";

const agent = createProductionAgentHandler({
  scripts,
  systemPrompt: readFileSync("agents/system-prompt.md", "utf-8"),
});`}
      />

      <h3>Options</h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "scripts",
              "Record<string, ScriptEntry>",
              "Map of script name → { tool, run } entries",
            ],
            ["systemPrompt", "string", "System prompt for the embedded agent"],
            [
              "apiKey",
              "string",
              "Anthropic API key. Default: ANTHROPIC_API_KEY env",
            ],
            ["model", "string", "Model to use. Default: claude-sonnet-4-6"],
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
