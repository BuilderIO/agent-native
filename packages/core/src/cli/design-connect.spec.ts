import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverDesignRoutes,
  parseDesignConnectArgs,
  prepareDesignConnectManifest,
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

const tmpRoots: string[] = [];

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-design-cli-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
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

  it("rejects write-file for non-HTML/CSS extensions", async () => {
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
        { relPath: "secret.ts", content: "evil" },
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
