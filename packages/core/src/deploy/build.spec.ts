import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateWorkerEntry,
  getNodeBuiltinNames,
  runNitroBuildPipeline,
} from "./build.js";

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
      '<html><head></head><body><a href="/next">next</a><form action="/api/search"></form><style>.hero{background:url("/hero.png")}</style>' +
        request.method + ' ' + url.pathname + '</body></html>',
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

  it("injects runtime browser Sentry config into generated worker SSR HTML", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/inbox", { method: "GET" }),
      { SENTRY_DSN: "https://public@example/4511270423822336" },
      {},
    );
    const html = await response.text();

    expect(html).toContain("data-agent-native-sentry-config");
    expect(html).toContain("https://public@example/4511270423822336");
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

  it("strips mounted base path for auto-mounted action routes under /_agent-native/actions/", async () => {
    const dir = makeTempDir();
    const actionPath = path.join(dir, "ping-action.mjs");
    fs.writeFileSync(
      actionPath,
      `
export default {
  run: async (params) => ({ ok: true, echo: params }),
};
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [],
        [],
        [],
        [{ name: "ping", absPath: actionPath, method: "post" }],
      ),
    );

    // With APP_BASE_PATH=/docs the client calls /docs/_agent-native/actions/ping.
    // Without the fix the request arrives at H3 with the prefix still attached,
    // misses the literal `/_agent-native/actions/ping` registration, and 404s.
    const mountedResponse = await worker.fetch(
      new Request("https://app.test/docs/_agent-native/actions/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(mountedResponse.status).toBe(200);
    await expect(mountedResponse.json()).resolves.toEqual({
      ok: true,
      echo: { hello: "world" },
    });

    // No base path — original behavior still works.
    const unmountedResponse = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "again" }),
      }),
      {},
      {},
    );
    expect(unmountedResponse.status).toBe(200);
    await expect(unmountedResponse.json()).resolves.toEqual({
      ok: true,
      echo: { hello: "again" },
    });
  });
});

describe("Cloudflare deploy builtins", () => {
  it("externalizes node:sqlite references from optional runtime probes", () => {
    expect(getNodeBuiltinNames()).toContain("sqlite");
  });
});

describe("runNitroBuildPipeline", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function setupFixture() {
    const cwd = fs.mkdtempSync(
      path.join(process.cwd(), ".tmp-nitro-pipeline-"),
    );
    dirs.push(cwd);

    // Simulate a React Router client build with a hashed asset chunk.
    const clientDir = path.join(cwd, "build", "client");
    fs.mkdirSync(path.join(clientDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(clientDir, "assets", "entry.client-abc.js"),
      "console.log('rr-client')",
    );

    // Simulate the cleared publicDir Nitro would set up in `prepare`.
    const publicOutputDir = path.join(cwd, ".output", "public");
    fs.mkdirSync(publicOutputDir, { recursive: true });

    return { cwd, clientDir, publicOutputDir };
  }

  it("copies the React Router client build into publicDir before nitroBuild scans it", async () => {
    const { cwd, clientDir, publicOutputDir } = setupFixture();

    const calls: string[] = [];
    let publicDirContentsAtNitroBuild: string[] = [];

    await runNitroBuildPipeline({
      nitro: { options: { output: { publicDir: publicOutputDir } } },
      hooks: {
        prepare: async () => {
          calls.push("prepare");
        },
        copyPublicAssets: async () => {
          calls.push("copyPublicAssets");
        },
        nitroBuild: async () => {
          calls.push("nitroBuild");
          // This is where Nitro globs publicDir to bake the static manifest
          // into the server bundle. Record what's visible at this point.
          publicDirContentsAtNitroBuild = fs.readdirSync(
            path.join(publicOutputDir, "assets"),
          );
        },
      },
      clientDir,
      publicOutputDir,
      appBasePath: "",
      cwd,
    });

    expect(calls).toEqual(["prepare", "copyPublicAssets", "nitroBuild"]);
    // The regression we're guarding against: if the client build is copied
    // *after* nitroBuild, the manifest is empty here and /assets/* 404s at
    // runtime even though the files exist on disk.
    expect(publicDirContentsAtNitroBuild).toContain("entry.client-abc.js");
  });

  it("mirrors client assets under the app base path when configured", async () => {
    const { cwd, clientDir, publicOutputDir } = setupFixture();

    await runNitroBuildPipeline({
      nitro: { options: { output: { publicDir: publicOutputDir } } },
      hooks: {
        prepare: async () => {},
        copyPublicAssets: async () => {},
        nitroBuild: async () => {},
      },
      clientDir,
      publicOutputDir,
      appBasePath: "/docs",
      cwd,
    });

    expect(
      fs.existsSync(
        path.join(publicOutputDir, "assets", "entry.client-abc.js"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(publicOutputDir, "docs", "assets", "entry.client-abc.js"),
      ),
    ).toBe(true);
  });

  it("skips the client copy when the React Router build is absent", async () => {
    const cwd = fs.mkdtempSync(
      path.join(process.cwd(), ".tmp-nitro-pipeline-"),
    );
    dirs.push(cwd);
    const publicOutputDir = path.join(cwd, ".output", "public");
    fs.mkdirSync(publicOutputDir, { recursive: true });

    await expect(
      runNitroBuildPipeline({
        nitro: { options: { output: { publicDir: publicOutputDir } } },
        hooks: {
          prepare: async () => {},
          copyPublicAssets: async () => {},
          nitroBuild: async () => {},
        },
        clientDir: path.join(cwd, "build", "client"),
        publicOutputDir,
        appBasePath: "",
        cwd,
      }),
    ).resolves.toBeUndefined();
  });
});
