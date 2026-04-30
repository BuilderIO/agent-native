import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { generateWorkerEntry } from "./build.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-worker-test-"));
  tempDirs.push(dir);
  return dir;
}

async function importGeneratedWorker(entrySource: string) {
  const dir = makeTempDir();
  const nodeModules = path.join(dir, "node_modules", "react-router");
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.writeFileSync(
    path.join(nodeModules, "package.json"),
    JSON.stringify({ type: "module", main: "index.js" }),
  );
  fs.writeFileSync(
    path.join(nodeModules, "index.js"),
    `
export function createRequestHandler() {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "/login", "content-type": "text/html" },
      });
    }
    return new Response(
      '<a href="/next">next</a><form action="/api/search"></form><style>.hero{background:url("/hero.png")}</style>' +
        request.method + ' ' + url.pathname,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };
}
`,
  );
  fs.writeFileSync(path.join(dir, "server-build.js"), "export default {};\n");
  const entryPath = path.join(dir, "entry.mjs");
  fs.writeFileSync(entryPath, entrySource);
  return (await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`))
    .default;
}

describe("generateWorkerEntry", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strips mounted /api prefixes and removes bodies for HEAD on GET API routes", async () => {
    const dir = makeTempDir();
    const routePath = path.join(dir, "hello.get.mjs");
    fs.writeFileSync(
      routePath,
      `
export default (event) =>
  new Response("body:" + event.req.method + ":" + new URL(event.req.url).pathname, {
    headers: {
      "content-type": "text/plain",
      "x-route-method": event.req.method,
      "x-route-path": new URL(event.req.url).pathname,
    },
  });
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [
          {
            method: "get",
            route: "/api/hello",
            filePath: "api/hello.get.ts",
            absPath: routePath,
          },
        ],
        [],
      ),
    );

    const getResponse = await worker.fetch(
      new Request("https://app.test/docs/api/hello", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(await getResponse.text()).toBe("body:GET:/api/hello");
    expect(getResponse.headers.get("x-route-path")).toBe("/api/hello");

    const headResponse = await worker.fetch(
      new Request("https://app.test/docs/api/hello", { method: "HEAD" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("x-route-method")).toBe("GET");
    await expect(headResponse.text()).resolves.toBe("");
  });

  it("handles mounted /api index routes", async () => {
    const dir = makeTempDir();
    const routePath = path.join(dir, "index.get.mjs");
    fs.writeFileSync(
      routePath,
      `
export default (event) =>
  new Response(new URL(event.req.url).pathname, {
    headers: { "content-type": "text/plain" },
  });
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [
          {
            method: "get",
            route: "/api",
            filePath: "api/index.get.ts",
            absPath: routePath,
          },
        ],
        [],
      ),
    );

    const response = await worker.fetch(
      new Request("https://app.test/docs/api?ping=1"),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    await expect(response.text()).resolves.toBe("/api");
  });

  it("strips mounted SSR paths and rewrites root-relative HTML and redirects", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    const html = await response.text();
    expect(html).toContain("GET /inbox");
    expect(html).toContain('href="/docs/next"');
    expect(html).toContain('action="/docs/api/search"');
    expect(html).toContain('url("/docs/hero.png")');

    const redirect = await worker.fetch(
      new Request("https://app.test/docs/redirect", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/docs/login");
  });

  it("keeps mounted SSR HEAD responses bodyless and leaves missing API paths as 404", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const head = await worker.fetch(
      new Request("https://app.test/docs/inbox", { method: "HEAD" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(head.status).toBe(200);
    await expect(head.text()).resolves.toBe("");

    const missingApi = await worker.fetch(
      new Request("https://app.test/docs/api/missing", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(missingApi.status).toBe(404);
  });
});
