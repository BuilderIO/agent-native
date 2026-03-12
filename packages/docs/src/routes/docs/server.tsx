import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/docs/server')({ component: ServerDocs })

function ServerDocs() {
  return (
    <main className="page-wrap px-4 pb-8 pt-10">
      <h1 className="display-title mb-4 text-3xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
        Server
      </h1>
      <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)]">
        <code>@agent-native/core/server</code> provides Express utilities for building your API server
        with file watching and SSE.
      </p>

      <section className="prose-section mb-10">
        <h2>createServer(options?)</h2>
        <p>Creates a pre-configured Express app with standard middleware:</p>
        <Pre code={`import { createServer } from "@agent-native/core/server";

const app = createServer();
// Includes: cors, json({ limit: "50mb" }), urlencoded, /api/ping`} />
        <h3>Options</h3>
        <Props items={[
          ['cors', 'CorsOptions | false', 'CORS config. Pass false to disable.'],
          ['jsonLimit', 'string', 'JSON body parser limit. Default: "50mb"'],
          ['pingMessage', 'string', 'Health check response. Default: env PING_MESSAGE or "pong"'],
          ['disablePing', 'boolean', 'Disable /api/ping endpoint'],
        ]} />
      </section>

      <section className="prose-section mb-10">
        <h2>createFileWatcher(dir, options?)</h2>
        <p>Creates a chokidar file watcher for real-time file change detection:</p>
        <Pre code={`import { createFileWatcher } from "@agent-native/core/server";

const watcher = createFileWatcher("./data");
// watcher emits "all" events: (eventName, filePath)`} />
        <h3>Options</h3>
        <Props items={[
          ['ignored', 'any', 'Glob patterns or regex to ignore'],
          ['emitInitial', 'boolean', 'Emit events for initial file scan. Default: false'],
        ]} />
      </section>

      <section className="prose-section mb-10">
        <h2>createSSEHandler(watcher, options?)</h2>
        <p>Creates an Express route handler that streams file changes as Server-Sent Events:</p>
        <Pre code={`import { createServer, createFileWatcher, createSSEHandler } from "@agent-native/core/server";

export function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  // Your API routes
  app.get("/api/items", listItems);
  app.post("/api/items", createItem);

  // SSE endpoint (keep last)
  app.get("/api/events", createSSEHandler(watcher));

  return app;
}`} />
        <p>
          Each SSE message is JSON: <code>{`{ "type": "change", "path": "data/file.json" }`}</code>
        </p>
        <h3>Options</h3>
        <Props items={[
          ['extraEmitters', 'Array<{ emitter, event }>', 'Additional EventEmitters to stream (e.g. sync events)'],
        ]} />
      </section>

      <section className="prose-section mb-10">
        <h2>createProductionServer(app, options?)</h2>
        <p>Starts a production server with SPA fallback and graceful shutdown:</p>
        <Pre code={`// server/node-build.ts
import { createProductionServer } from "@agent-native/core/server";
import { createAppServer } from "./index.js";

createProductionServer(createAppServer());`} />
        <h3>Options</h3>
        <Props items={[
          ['port', 'number | string', 'Listen port. Default: env PORT or 3000'],
          ['spaDir', 'string', 'Built SPA directory. Default: "dist/spa"'],
          ['appName', 'string', 'Name for log messages. Default: "Agent-Native"'],
        ]} />
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
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Option</th>
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Type</th>
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
