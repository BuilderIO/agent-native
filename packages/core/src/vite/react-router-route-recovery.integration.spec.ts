import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const restartCountKey = "__agentNativeRouteRecoveryRestartCount";

function routeSource(label: string, loaderFailure = false): string {
  return `${
    loaderFailure
      ? 'export function loader() { throw new Response("loader exploded", { status: 598 }); }\n'
      : ""
  }export default function Route() { return <main>${label}</main>; }\n`;
}

async function eventually(
  predicate: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}

async function eventuallyFetch(
  url: string,
  predicate: (response: Response, body: string) => boolean,
  timeoutMs = 15_000,
): Promise<{ response: Response; body: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status?: number; body?: string; error?: unknown } = {};
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      last = { status: response.status, body };
      if (predicate(response, body)) return { response, body };
    } catch (error) {
      last = { error };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${JSON.stringify(last)}`);
}

describe("React Router route topology recovery", () => {
  let fixture = "";
  let routes = "";
  let server: ViteDevServer;
  let baseUrl = "";
  const initialPid = process.pid;

  beforeAll(async () => {
    fixture = fs.mkdtempSync(
      path.join(process.cwd(), ".tmp-route-recovery-integration-"),
    );
    routes = path.join(fixture, "app", "pages");
    fs.mkdirSync(routes, { recursive: true });
    fs.writeFileSync(
      path.join(fixture, "react-router.config.ts"),
      'export default { appDirectory: "app", ssr: true };\n',
    );
    fs.writeFileSync(
      path.join(fixture, "app", "routes.ts"),
      'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes({ rootDirectory: "pages", ignoredRouteFiles: ["pages/**/*.ignored.tsx"] });\n',
    );
    fs.writeFileSync(
      path.join(fixture, "app", "root.tsx"),
      `import { Links, Meta, Outlet, Scripts } from "react-router";
export function Layout({ children }: { children: React.ReactNode }) {
  return <html><head><Meta/><Links/></head><body>{children}<Scripts/></body></html>;
}
export default function Root() { return <Outlet/>; }
`,
    );
    fs.writeFileSync(
      path.join(fixture, "app", "entry.server.tsx"),
      `import { ServerRouter } from "react-router";
import { renderToString } from "react-dom/server";
export default function handleRequest(request, status, headers, context) {
  headers.set("content-type", "text/html");
  return new Response("<!DOCTYPE html>" + renderToString(<ServerRouter context={context} url={request.url}/>), { status, headers });
}
`,
    );
    const ssrHandlerUrl = pathToFileURL(
      path.join(process.cwd(), "src/server/ssr-handler.ts"),
    ).href;
    fs.mkdirSync(path.join(fixture, "server", "routes"), { recursive: true });
    fs.writeFileSync(
      path.join(fixture, "server", "routes", "[...page].get.ts"),
      `import { createH3SSRHandler } from ${JSON.stringify(ssrHandlerUrl)};
export default createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);
`,
    );
    const agentNativePresetUrl = pathToFileURL(
      path.join(process.cwd(), "src/vite/client.ts"),
    ).href;
    fs.writeFileSync(
      path.join(fixture, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from ${JSON.stringify(agentNativePresetUrl)};
const key = ${JSON.stringify(restartCountKey)};
export default defineConfig({
  logLevel: "silent",
  plugins: [
    reactRouter(),
    agentNative(),
    {
      name: "count-route-recovery-restarts",
      configureServer(server) {
        if ((server as any).__restartCountWrapped) return;
        (server as any).__restartCountWrapped = true;
        const restart = server.restart.bind(server);
        server.restart = async (...args) => {
          (globalThis as any)[key] = ((globalThis as any)[key] ?? 0) + 1;
          return restart(...args);
        };
      },
    },
  ],
});
`,
    );
    (globalThis as Record<string, unknown>)[restartCountKey] = 0;
    server = await createServer({
      root: fixture,
      configFile: path.join(fixture, "vite.config.ts"),
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    const address = server.httpServer?.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
    delete (globalThis as Record<string, unknown>)[restartCountKey];
  });

  it("updates an initially empty custom route root while ordinary edits and failures stay HMR-only", async () => {
    await eventuallyFetch(baseUrl, (response) => response.status === 200);
    expect(process.pid).toBe(initialPid);
    expect((globalThis as Record<string, number>)[restartCountKey]).toBe(0);

    fs.writeFileSync(path.join(routes, "image.png"), "not a route");
    fs.writeFileSync(
      path.join(routes, "draft.test.tsx"),
      routeSource("ignored"),
    );
    fs.writeFileSync(
      path.join(routes, "draft.ignored.tsx"),
      routeSource("ignored"),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((globalThis as Record<string, number>)[restartCountKey]).toBe(0);

    fs.writeFileSync(path.join(routes, "old.tsx"), routeSource("Old v1"));
    await eventuallyFetch(`${baseUrl}/old`, (_response, body) =>
      body.includes("Old v1"),
    );
    await eventually(
      () => (globalThis as Record<string, number>)[restartCountKey] >= 1,
    );
    const afterInitialAdd = (globalThis as Record<string, number>)[
      restartCountKey
    ];

    fs.writeFileSync(path.join(routes, "old.tsx"), routeSource("Old v2"));
    await eventuallyFetch(`${baseUrl}/old`, (_response, body) =>
      body.includes("Old v2"),
    );
    expect((globalThis as Record<string, number>)[restartCountKey]).toBe(
      afterInitialAdd,
    );

    fs.renameSync(path.join(routes, "old.tsx"), path.join(routes, "new.tsx"));
    await eventuallyFetch(`${baseUrl}/new`, (_response, body) =>
      body.includes("Old v2"),
    );
    await eventually(
      () =>
        (globalThis as Record<string, number>)[restartCountKey] >
        afterInitialAdd,
    );
    const afterRename = (globalThis as Record<string, number>)[restartCountKey];
    expect(process.pid).toBe(initialPid);

    fs.writeFileSync(path.join(routes, "new.tsx"), "export default function (");
    await eventuallyFetch(
      `${baseUrl}/new`,
      (response) => response.status >= 500,
    );
    expect((globalThis as Record<string, number>)[restartCountKey]).toBe(
      afterRename,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));

    fs.writeFileSync(
      path.join(routes, "new.tsx"),
      routeSource("Loader failure", true),
    );
    await eventuallyFetch(
      `${baseUrl}/new`,
      (response) => response.status === 598,
    );
    expect((globalThis as Record<string, number>)[restartCountKey]).toBe(
      afterRename,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    fs.unlinkSync(path.join(routes, "new.tsx"));
    await eventuallyFetch(
      `${baseUrl}/new`,
      (response) => response.status === 404,
    );
    await eventually(
      () =>
        (globalThis as Record<string, number>)[restartCountKey] > afterRename,
    );
    const afterDelete = (globalThis as Record<string, number>)[restartCountKey];
    await new Promise((resolve) => setTimeout(resolve, 500));

    fs.writeFileSync(
      path.join(routes, "final.tsx"),
      routeSource("Final route"),
    );
    await eventuallyFetch(`${baseUrl}/final`, (_response, body) =>
      body.includes("Final route"),
    );
    await eventually(
      () =>
        (globalThis as Record<string, number>)[restartCountKey] > afterDelete,
    );
    expect(process.pid).toBe(initialPid);
  }, 45_000);
});
