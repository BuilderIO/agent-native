import { createFileRoute } from '@tanstack/react-router'
import DocsLayout from '../../components/DocsLayout'
import CodeBlock from '../../components/CodeBlock'

export const Route = createFileRoute('/docs/server')({ component: ServerDocs })

const TOC = [
  { id: 'createserver', label: 'createServer()' },
  { id: 'createfilewatcher', label: 'createFileWatcher()' },
  { id: 'createssehandler', label: 'createSSEHandler()' },
  { id: 'createproductionserver', label: 'createProductionServer()' },
]

function ServerDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Server</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        <code>@agent-native/core</code> provides Express utilities for building your API server
        with file watching and SSE.
      </p>

      <h2 id="createserver">createServer(options?)</h2>
      <p>Creates a pre-configured Express app with standard middleware:</p>
      <CodeBlock code={`import { createServer } from "@agent-native/core";

const app = createServer();
// Includes: cors, json({ limit: "50mb" }), urlencoded, /api/ping`} />

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
            ['cors', 'CorsOptions | false', 'CORS config. Pass false to disable.'],
            ['jsonLimit', 'string', 'JSON body parser limit. Default: "50mb"'],
            ['pingMessage', 'string', 'Health check response. Default: env PING_MESSAGE or "pong"'],
            ['disablePing', 'boolean', 'Disable /api/ping endpoint'],
          ].map(([name, type, desc]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="font-mono text-xs">{type}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="createfilewatcher">createFileWatcher(dir, options?)</h2>
      <p>Creates a chokidar file watcher for real-time file change detection:</p>
      <CodeBlock code={`import { createFileWatcher } from "@agent-native/core";

const watcher = createFileWatcher("./data");
// watcher emits "all" events: (eventName, filePath)`} />

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
            ['ignored', 'any', 'Glob patterns or regex to ignore'],
            ['emitInitial', 'boolean', 'Emit events for initial file scan. Default: false'],
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
      <p>Creates an Express route handler that streams file changes as Server-Sent Events:</p>
      <CodeBlock code={`import { createServer, createFileWatcher, createSSEHandler } from "@agent-native/core";

export function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

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
            <td className="font-mono text-xs">{'Array<{ emitter, event }>'}</td>
            <td>Additional EventEmitters to stream</td>
          </tr>
        </tbody>
      </table>

      <h2 id="createproductionserver">createProductionServer(app, options?)</h2>
      <p>Starts a production server with SPA fallback and graceful shutdown:</p>
      <CodeBlock code={`// server/node-build.ts
import { createProductionServer } from "@agent-native/core";
import { createAppServer } from "./index.js";

createProductionServer(createAppServer());`} />

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
            ['port', 'number | string', 'Listen port. Default: env PORT or 3000'],
            ['spaDir', 'string', 'Built SPA directory. Default: "dist/spa"'],
            ['appName', 'string', 'Name for log messages. Default: "Agent-Native"'],
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
  )
}
