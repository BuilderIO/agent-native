import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverDesignRoutes,
  designConnectManifestsTargetSameApp,
  parseDesignConnectArgs,
  prepareDesignConnectManifest,
  registerConnectionWithServer,
  resolveAppUrl,
  startDesignConnectBridge,
} from "./design-connect.js";

// ── Bridge helpers ──────────────────────────────────────────────────────────

/** Pick an ephemeral port that is likely free by binding momentarily. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.once("error", reject);
  });
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as Record<string, unknown>,
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(raw);
  });
}

async function getJson(
  url: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    http
      .get(
        {
          hostname: parsed.hostname,
          port: Number(parsed.port),
          path: `${parsed.pathname}${parsed.search}`,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: JSON.parse(
                  Buffer.concat(chunks).toString("utf8"),
                ) as Record<string, unknown>,
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      )
      .on("error", reject);
  });
}

async function getText(url: string): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    http
      .get(
        {
          hostname: parsed.hostname,
          port: Number(parsed.port),
          path: `${parsed.pathname}${parsed.search}`,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      )
      .on("error", reject);
  });
}

const tmpRoots: string[] = [];
const appUrlEnvKeys = [
  "AGENT_NATIVE_URL",
  "DESIGN_APP_URL",
  "APP_URL",
  "VITE_APP_URL",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
] as const;
const originalAppUrlEnv = new Map(
  appUrlEnvKeys.map((key) => [key, process.env[key]]),
);

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-design-cli-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const key of appUrlEnvKeys) {
    const original = originalAppUrlEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("design connect CLI", () => {
  it("parses connect flags", () => {
    expect(
      parseDesignConnectArgs([
        "connect",
        "--url",
        "localhost:5173",
        "--port",
        "7555",
        "--root",
        "/tmp/app",
        "--json",
      ]),
    ).toMatchObject({
      url: "http://localhost:5173",
      port: 7555,
      root: "/tmp/app",
      json: true,
      once: true,
    });
  });

  it("parses --app-url flag", () => {
    expect(
      parseDesignConnectArgs([
        "connect",
        "--app-url",
        "https://design.example.com",
      ]),
    ).toMatchObject({
      appUrl: "https://design.example.com",
    });
  });

  it("parses --app-url= inline form", () => {
    expect(
      parseDesignConnectArgs([
        "connect",
        "--app-url=https://design.example.com",
      ]),
    ).toMatchObject({
      appUrl: "https://design.example.com",
    });
  });

  it("parses --daemon and rejects one-shot modes", () => {
    expect(parseDesignConnectArgs(["connect", "--daemon"])).toMatchObject({
      daemon: true,
      once: false,
    });
    expect(() =>
      parseDesignConnectArgs(["connect", "--daemon", "--json"]),
    ).toThrow(/--daemon cannot be combined/);
  });

  it("validates daemon bridge reuse against the requested app", () => {
    expect(
      designConnectManifestsTargetSameApp(
        {
          devServerUrl: "http://localhost:5173/",
          rootPath: "/tmp/project",
        },
        {
          devServerUrl: "localhost:5173",
          rootPath: "/tmp/project/.",
        },
      ),
    ).toBe(true);
    expect(
      designConnectManifestsTargetSameApp(
        {
          devServerUrl: "http://localhost:5173",
          rootPath: "/tmp/project",
        },
        {
          devServerUrl: "http://localhost:5174",
          rootPath: "/tmp/project",
        },
      ),
    ).toBe(false);
    expect(
      designConnectManifestsTargetSameApp(
        {
          devServerUrl: "http://localhost:5173",
          rootPath: "/tmp/project",
        },
        {
          devServerUrl: "http://localhost:5173",
          rootPath: "/tmp/other-project",
        },
      ),
    ).toBe(false);
  });

  it("resolves standard app URL env vars for self-registration", () => {
    for (const key of appUrlEnvKeys) delete process.env[key];
    process.env.APP_URL = "https://design.example.com/";

    expect(resolveAppUrl()).toBe("https://design.example.com");
  });

  it("discovers React Router route files without AST parsing", () => {
    const root = tmpDir();
    const routes = path.join(root, "app", "routes");
    fs.mkdirSync(routes, { recursive: true });
    fs.writeFileSync(path.join(routes, "_index.tsx"), "export default null;");
    fs.writeFileSync(
      path.join(routes, "_app.settings.tsx"),
      "export default null;",
    );
    fs.writeFileSync(
      path.join(routes, "design.$id.tsx"),
      "export default null;",
    );
    fs.writeFileSync(
      path.join(routes, "design-systems_.setup.tsx"),
      "export default null;",
    );
    fs.writeFileSync(path.join(routes, "$.tsx"), "export default null;");

    expect(discoverDesignRoutes(root)).toEqual([
      {
        id: "route-root",
        path: "/",
        title: "Home",
        sourceFile: "app/routes/_index.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-wildcard",
        path: "/*",
        title: "Wildcard",
        sourceFile: "app/routes/$.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-design-systems-setup",
        path: "/design-systems/setup",
        title: "Design Systems Setup",
        sourceFile: "app/routes/design-systems_.setup.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-design-id",
        path: "/design/:id",
        title: "Design Id",
        sourceFile: "app/routes/design.$id.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-settings",
        path: "/settings",
        title: "Settings",
        sourceFile: "app/routes/_app.settings.tsx",
        sourceKind: "react-router",
      },
    ]);
  });

  it("marks all capabilities as available in the manifest", async () => {
    const root = tmpDir();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port: 7667,
    });
    for (const cap of manifest.capabilities) {
      expect(cap.status).toBe("available");
    }
  });

  it("scaffolds a route manifest without overwriting an existing one", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "app", "routes"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "app", "routes", "_index.tsx"),
      "export default null;",
    );

    const first = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port: 7666,
    });
    expect(first.bridgeUrl).toBe("http://127.0.0.1:7666");
    expect(first.routeManifestCreated).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agent-native/design-routes.json")),
    ).toBe(true);

    fs.writeFileSync(first.routeManifestPath, '{"keep":true}\n', "utf8");
    const second = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port: 7666,
    });
    expect(second.routeManifestCreated).toBe(false);
    expect(fs.readFileSync(first.routeManifestPath, "utf8")).toBe(
      '{"keep":true}\n',
    );
  });
});

describe("design connect bridge endpoints", () => {
  it("returns read-only HTML snapshots from the connected dev server", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const devServer = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><body><main data-path="${req.url}">Hello</main></body></html>`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      devServer.once("error", reject);
      devServer.listen(devPort, "127.0.0.1", () => {
        devServer.off("error", reject);
        resolve();
      });
    });
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: `http://127.0.0.1:${devPort}`,
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const result = await getJson(
        `http://127.0.0.1:${port}/snapshot?path=/hello`,
      );
      expect(result.status).toBe(200);
      expect(result.body["ok"]).toBe(true);
      expect(result.body["url"]).toBe(`http://127.0.0.1:${devPort}/hello`);
      expect(result.body["html"]).toContain('data-path="/hello"');
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("serves live-edit HTML and proxies root-relative CSR assets", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const devServer = http.createServer((req, res) => {
      if (req.url?.startsWith("/src/main.ts")) {
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(
          "window.__csrBooted = true; document.querySelector('#root').textContent = 'CSR booted';",
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><head><title>CSR</title></head><body><div id="root">Loading</div><script type="module" src="/src/main.ts"></script></body></html>`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      devServer.once("error", reject);
      devServer.listen(devPort, "127.0.0.1", () => {
        devServer.off("error", reject);
        resolve();
      });
    });
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: `http://127.0.0.1:${devPort}`,
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const base = `http://127.0.0.1:${port}`;
      const rejectedRegistration = await postJson(`${base}/live-edit-bridge`, {
        script:
          "<script>window.__editorBridgeReady = 'agent-native:editor-chrome-ready';</script>",
      });
      expect(rejectedRegistration.status).toBe(401);
      expect(rejectedRegistration.body["ok"]).toBe(false);

      const registration = await postJson(
        `${base}/live-edit-bridge`,
        {
          script:
            "<script>window.__editorBridgeReady = 'agent-native:editor-chrome-ready';</script>",
        },
        { "x-bridge-token": bridge.bridgeToken },
      );
      expect(registration.status).toBe(200);
      expect(registration.body["ok"]).toBe(true);

      const html = await getText(`${base}/live-edit?path=/dashboard`);
      expect(html.status).toBe(200);
      expect(html.headers["content-type"]).toContain("text/html");
      expect(html.body).toContain(`<base href="${base}/">`);
      expect(html.body).toContain('src="/src/main.ts"');
      expect(html.body).toContain("agent-native:editor-chrome-ready");

      const interactHtml = await getText(
        `${base}/live-edit?path=/dashboard&bridge=0`,
      );
      expect(interactHtml.status).toBe(200);
      expect(interactHtml.body).toContain(`<base href="${base}/">`);
      expect(interactHtml.body).toContain('src="/src/main.ts"');
      expect(interactHtml.body).not.toContain(
        "agent-native:editor-chrome-ready",
      );

      const module = await getText(`${base}/src/main.ts`);
      expect(module.status).toBe(200);
      expect(module.headers["content-type"]).toContain(
        "application/javascript",
      );
      expect(module.body).toContain("CSR booted");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("rejects snapshot URLs outside the connected dev server origin", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const result = await getJson(
        `http://127.0.0.1:${port}/snapshot?url=http://example.com/`,
      );
      expect(result.status).toBe(400);
      expect(result.body["ok"]).toBe(false);
      expect(String(result.body["error"])).toContain("connected dev server");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("exposes bridgeToken on the returned bridge object", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      expect(typeof bridge.bridgeToken).toBe("string");
      expect(bridge.bridgeToken.length).toBe(64); // 32 bytes hex
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("returns 401 for write endpoints without a token", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const base = `http://127.0.0.1:${port}`;
      for (const ep of ["/read-file", "/write-file", "/apply-edit"]) {
        const result = await postJson(`${base}${ep}`, {
          relPath: "index.html",
        });
        expect(result.status).toBe(401);
        expect(result.body["ok"]).toBe(false);
      }
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("returns 401 for write endpoints with a wrong token", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/read-file`,
        { relPath: "index.html" },
        { "x-bridge-token": "wrong-token-value" },
      );
      expect(result.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("returns 405 for GET on write endpoints", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const base = `http://127.0.0.1:${port}`;
      await new Promise<void>((resolve, reject) => {
        http
          .get(`${base}/write-file`, (res) => {
            expect(res.statusCode).toBe(405);
            res.resume();
            res.on("end", resolve);
          })
          .on("error", reject);
      });
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("write-file and read-file round-trip through the bridge", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      // Write a new file.
      const writeResult = await postJson(
        `${base}/write-file`,
        { relPath: "index.html", content: "<h1>Hello</h1>" },
        authHeader,
      );
      expect(writeResult.status).toBe(200);
      expect(writeResult.body["ok"]).toBe(true);

      // Read it back.
      const readResult = await postJson(
        `${base}/read-file`,
        { relPath: "index.html" },
        authHeader,
      );
      expect(readResult.status).toBe(200);
      expect(readResult.body["content"]).toBe("<h1>Hello</h1>");

      // Verify it is actually on disk.
      expect(fs.readFileSync(path.join(root, "index.html"), "utf8")).toBe(
        "<h1>Hello</h1>",
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("apply-edit patches an existing file with search/replace", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      fs.writeFileSync(
        path.join(root, "style.css"),
        "body { color: red; }\n",
        "utf8",
      );

      const result = await postJson(
        `${base}/apply-edit`,
        {
          relPath: "style.css",
          search: "color: red;",
          replace: "color: blue;",
        },
        authHeader,
      );
      expect(result.status).toBe(200);
      expect(result.body["method"]).toBe("patch");
      expect(fs.readFileSync(path.join(root, "style.css"), "utf8")).toBe(
        "body { color: blue; }\n",
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("apply-edit returns 422 when search string is not found", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      fs.writeFileSync(path.join(root, "page.html"), "<p>hi</p>", "utf8");

      const result = await postJson(
        `${base}/apply-edit`,
        { relPath: "page.html", search: "NOT_PRESENT", replace: "x" },
        authHeader,
      );
      expect(result.status).toBe(422);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("apply-edit returns 422 when search string is ambiguous", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };
      const original = "a { color: red; }\nb { color: red; }\n";

      fs.writeFileSync(path.join(root, "style.css"), original, "utf8");

      const result = await postJson(
        `${base}/apply-edit`,
        { relPath: "style.css", search: "color: red;", replace: "x" },
        authHeader,
      );
      expect(result.status).toBe(422);
      expect(String(result.body["error"])).toContain("ambiguous");
      expect(fs.readFileSync(path.join(root, "style.css"), "utf8")).toBe(
        original,
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects write-file for extensions outside the allowed text-file list", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      const result = await postJson(
        `${base}/write-file`,
        { relPath: "secret.exe", content: "evil" },
        authHeader,
      );
      expect(result.status).toBe(500);
      expect(String(result.body["error"])).toContain("Write rejected");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects path traversal attempts", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      const result = await postJson(
        `${base}/read-file`,
        { relPath: "../../etc/passwd" },
        authHeader,
      );
      // Must be an error (status 500 with traversal message or 404 if OS resolves
      // to a non-existent file that still escapes the root — we just want not-200).
      expect(result.status).not.toBe(200);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects a symlink leaf inside root that points outside root (read)", async () => {
    const root = tmpDir();
    const outsideDir = tmpDir();
    const secretPath = path.join(outsideDir, "id_dsa_secret");
    fs.writeFileSync(secretPath, "super-secret-key-material", "utf8");
    // The symlink itself lives inside root — only its target escapes.
    fs.symlinkSync(secretPath, path.join(root, "link.css"));

    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      const result = await postJson(
        `${base}/read-file`,
        { relPath: "link.css" },
        authHeader,
      );
      expect(result.status).not.toBe(200);
      expect(result.body["ok"]).toBe(false);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects a symlink leaf inside root that points outside root (write)", async () => {
    const root = tmpDir();
    const outsideDir = tmpDir();
    const targetPath = path.join(outsideDir, "outside.css");
    fs.writeFileSync(targetPath, "body { color: red; }", "utf8");
    fs.symlinkSync(targetPath, path.join(root, "link.css"));

    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      const result = await postJson(
        `${base}/write-file`,
        { relPath: "link.css", content: "body { color: blue; }" },
        authHeader,
      );
      expect(result.status).not.toBe(200);
      expect(result.body["ok"]).toBe(false);
      // The file outside root must remain untouched.
      expect(fs.readFileSync(targetPath, "utf8")).toBe("body { color: red; }");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("registerConnectionWithServer sends bridgeToken in the payload", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      // Spin up a small HTTP server to capture the registration payload.
      let captured: Record<string, unknown> | null = null;
      const captureServer = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          try {
            captured = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as Record<string, unknown>;
          } catch {
            captured = null;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      });
      const capturePort = await freePort();
      await new Promise<void>((resolve, reject) => {
        captureServer.once("error", reject);
        captureServer.listen(capturePort, "127.0.0.1", () => {
          captureServer.off("error", reject);
          resolve();
        });
      });

      try {
        await registerConnectionWithServer(
          `http://127.0.0.1:${capturePort}`,
          bridge,
          "test-auth-token",
        );
        // Give the async handler a tick to finish.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        expect(captured).not.toBeNull();
        expect(captured?.["bridgeToken"]).toBe(bridge.bridgeToken);
        expect(captured?.["devServerUrl"]).toBe(manifest.devServerUrl);
        expect(captured?.["bridgeUrl"]).toBe(manifest.bridgeUrl);
        const registeredOperations = (
          captured?.["capabilities"] as Array<{ operation?: string }>
        ).map((capability) => capability.operation);
        expect(
          manifest.capabilities.map((capability) => capability.operation),
        ).toContain("listFiles");
        expect(registeredOperations).not.toContain("listFiles");
        expect(registeredOperations).toContain("readFile");
      } finally {
        await new Promise<void>((resolve) =>
          captureServer.close(() => resolve()),
        );
      }
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("public routes remain accessible without a token", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const base = `http://127.0.0.1:${port}`;
      for (const pathname of [
        "/",
        "/manifest.json",
        "/routes.json",
        "/health",
      ]) {
        await new Promise<void>((resolve, reject) => {
          http
            .get(`${base}${pathname}`, (res) => {
              expect(res.statusCode).toBe(200);
              res.resume();
              res.on("end", resolve);
            })
            .on("error", reject);
        });
      }
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });
});
