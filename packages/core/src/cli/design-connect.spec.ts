import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { chromium, type Browser } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  discoverDesignRoutes,
  designConnectManifestsTargetSameApp,
  deriveDesignPreviewAttestationSignature,
  deriveDesignScopedLiveEditCapability,
  deriveDesignScopedLiveEditRegistrationCapability,
  parseDesignConnectArgs,
  prepareDesignConnectManifest,
  registerConnectionWithServer,
  resolveAppUrl,
  runDesign,
  startDesignConnectBridge,
} from "./design-connect.js";

function liveEditAuth(
  bridge: Awaited<ReturnType<typeof startDesignConnectBridge>>,
  designId: string,
) {
  return {
    "x-design-preview-token": bridge.previewToken,
    "x-agent-native-live-edit-capability": deriveDesignScopedLiveEditCapability(
      bridge.bridgeToken,
      designId,
    ),
  };
}

function liveEditRegistrationAuth(
  bridge: Awaited<ReturnType<typeof startDesignConnectBridge>>,
  designId: string,
) {
  return {
    "x-design-preview-token": bridge.previewToken,
    "x-agent-native-live-edit-registration-capability":
      deriveDesignScopedLiveEditRegistrationCapability(
        bridge.bridgeToken,
        designId,
      ),
  };
}

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

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: "chrome", headless: true });
  }
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
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    http
      .get(
        {
          hostname: parsed.hostname,
          port: Number(parsed.port),
          path: `${parsed.pathname}${parsed.search}`,
          headers,
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

async function getText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{
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
          headers,
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

async function headText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        method: "HEAD",
        headers,
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers }),
        );
      },
    );
    request.on("error", reject);
    request.end();
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
const bridgeTokenEnvKeys = [
  "AGENT_NATIVE_BRIDGE_TOKEN",
  "AGENT_NATIVE_PREVIEW_TOKEN",
] as const;
const originalBridgeTokenEnv = new Map(
  bridgeTokenEnvKeys.map((key) => [key, process.env[key]]),
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
  for (const key of bridgeTokenEnvKeys) {
    const original = originalBridgeTokenEnv.get(key);
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

  it("parses the distinct read-only preview token", () => {
    expect(
      parseDesignConnectArgs([
        "connect",
        "--bridge-token=example-write-token",
        "--preview-token",
        "example-preview-token",
      ]),
    ).toMatchObject({
      bridgeToken: "example-write-token",
      previewToken: "example-preview-token",
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

  it("reuses a same-app daemon after authenticating with its persisted token", async () => {
    for (const key of bridgeTokenEnvKeys) delete process.env[key];
    const root = tmpDir();
    const port = await freePort();
    const devServerUrl = "http://localhost:5173";
    const manifest = await prepareDesignConnectManifest({
      root,
      url: devServerUrl,
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const persistedPath = path.join(
      root,
      ".agent-native",
      "design-bridge-token",
    );
    const stalePersistedToken = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(persistedPath, `${stalePersistedToken}\n`);
    process.env["AGENT_NATIVE_PREVIEW_TOKEN"] = "stale-preview-token";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        runDesign([
          "connect",
          "--url",
          devServerUrl,
          "--port",
          String(port),
          "--root",
          root,
          "--daemon",
          "--bridge-token",
          bridge.bridgeToken,
        ]),
      ).resolves.toBe(0);
      expect(error).toHaveBeenCalledWith(
        `Design localhost bridge already running at ${manifest.bridgeUrl}`,
      );
      const output = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
      expect(output).not.toContain(bridge.bridgeToken);
      expect(output).not.toContain(bridge.previewToken);
      expect(fs.readFileSync(persistedPath, "utf8").trim()).toBe(
        bridge.bridgeToken,
      );
      expect(output).not.toContain(stalePersistedToken);
      expect(warn).toHaveBeenCalledWith(
        "Ignoring stale AGENT_NATIVE_PREVIEW_TOKEN; the current bridge token determines the preview token.",
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects a same-app daemon with a mismatched persisted token without stopping it", async () => {
    for (const key of bridgeTokenEnvKeys) delete process.env[key];
    const root = tmpDir();
    const port = await freePort();
    const devServerUrl = "http://localhost:5173";
    const manifest = await prepareDesignConnectManifest({
      root,
      url: devServerUrl,
      port,
    });
    const runningToken = crypto.randomBytes(32).toString("hex");
    const persistedToken = crypto.randomBytes(32).toString("hex");
    const mismatchedToken = crypto.randomBytes(32).toString("hex");
    const persistedPath = path.join(
      root,
      ".agent-native",
      "design-bridge-token",
    );
    const bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: runningToken,
    });
    fs.writeFileSync(
      path.join(root, ".agent-native", "design-bridge-token"),
      `${persistedToken}\n`,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        runDesign([
          "connect",
          "--url",
          devServerUrl,
          "--port",
          String(port),
          "--root",
          root,
          "--daemon",
          "--bridge-token",
          mismatchedToken,
        ]),
      ).resolves.toBe(1);
      const output = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
      expect(output).toContain("rejected the current bridge token (HTTP 401)");
      expect(output).toContain("bridgeToken returned by open-visual-edit");
      expect(output).toContain("The existing process was left running.");
      expect(output).not.toContain(runningToken);
      expect(output).not.toContain(persistedToken);
      expect(output).not.toContain(mismatchedToken);
      expect(output).not.toContain(bridge.previewToken);
      expect(fs.readFileSync(persistedPath, "utf8").trim()).toBe(
        persistedToken,
      );
      expect(log).not.toHaveBeenCalled();
      await expect(
        getJson(`${manifest.bridgeUrl}/health`),
      ).resolves.toMatchObject({ status: 200, body: { ok: true } });
      expect(bridge.server.listening).toBe(true);
    } finally {
      log.mockRestore();
      error.mockRestore();
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
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
        id: expect.stringMatching(/^route-root-[a-z0-9]+$/),
        path: "/",
        title: "Home",
        sourceFile: "app/routes/_index.tsx",
        sourceKind: "react-router",
      },
      {
        id: expect.stringMatching(/^route-wildcard-[a-z0-9]+$/),
        path: "/*",
        title: "Wildcard",
        sourceFile: "app/routes/$.tsx",
        sourceKind: "react-router",
      },
      {
        id: expect.stringMatching(/^route-design-systems-setup-[a-z0-9]+$/),
        path: "/design-systems/setup",
        title: "Design Systems Setup",
        sourceFile: "app/routes/design-systems_.setup.tsx",
        sourceKind: "react-router",
      },
      {
        id: expect.stringMatching(/^route-design-pid-[a-z0-9]+$/),
        path: "/design/:id",
        title: "Design Id",
        sourceFile: "app/routes/design.$id.tsx",
        sourceKind: "react-router",
      },
      {
        id: expect.stringMatching(/^route-settings-[a-z0-9]+$/),
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

  it("keeps structural route ids distinct and preserves custom manifest metadata", async () => {
    const root = tmpDir();
    const routes = path.join(root, "app", "routes");
    fs.mkdirSync(routes, { recursive: true });
    fs.writeFileSync(
      path.join(routes, "design.$id.tsx"),
      "export default null;",
    );
    fs.writeFileSync(
      path.join(routes, "design-id.tsx"),
      "export default null;",
    );
    fs.writeFileSync(path.join(routes, "users.tsx"), "export default null;");
    fs.writeFileSync(path.join(routes, "users.$.tsx"), "export default null;");
    fs.writeFileSync(path.join(routes, "_index.tsx"), "export default null;");
    fs.writeFileSync(path.join(routes, "root.tsx"), "export default null;");
    fs.writeFileSync(path.join(routes, "$.tsx"), "export default null;");
    fs.writeFileSync(path.join(routes, "wildcard.tsx"), "export default null;");
    fs.writeFileSync(path.join(routes, "foo.bar.tsx"), "export default null;");
    fs.writeFileSync(path.join(routes, "foo-bar.tsx"), "export default null;");

    const manifestPath = path.join(root, ".agent-native/design-routes.json");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        sourceType: "localhost",
        routes: [
          {
            id: "custom-checkout",
            path: "/checkout?step=payment",
            title: "Payment step",
            sourceKind: "manual",
            metadata: { width: 390, stateName: "payment" },
          },
        ],
      }),
    );

    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port: 7666,
    });

    expect(manifest.routes[0]).toMatchObject({
      id: "custom-checkout",
      title: "Payment step",
      metadata: { width: 390, stateName: "payment" },
    });
    expect(
      manifest.routes.find((route) => route.path === "/design/:id")?.id,
    ).toMatch(/^route-design-pid-[a-z0-9]+$/);
    expect(
      manifest.routes.find((route) => route.path === "/design-id")?.id,
    ).toMatch(/^route-design-id-[a-z0-9]+$/);
    expect(
      manifest.routes.find((route) => route.path === "/users")?.id,
    ).toMatch(/^route-users-[a-z0-9]+$/);
    expect(
      manifest.routes.find((route) => route.path === "/users/*")?.id,
    ).toMatch(/^route-users-w-[a-z0-9]+$/);
    expect(
      manifest.routes.find((route) => route.path === "/design/:id")?.id,
    ).not.toBe("route-design-pid");
    for (const [left, right] of [
      ["/", "/root"],
      ["/*", "/wildcard"],
      ["/foo/bar", "/foo-bar"],
    ]) {
      expect(manifest.routes.find((route) => route.path === left)?.id).not.toBe(
        manifest.routes.find((route) => route.path === right)?.id,
      );
    }
  });
});

describe("design connect bridge endpoints", () => {
  it("rejects a localhost connection id used as the bridge token", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://127.0.0.1:4173",
      port,
    });

    await expect(
      startDesignConnectBridge(manifest, {
        bridgeToken: "localhost_0000000000000000",
      }),
    ).rejects.toThrow(/connection ID, not a bridge token/);
  });

  it("rejects a preview token that does not match the bridge token", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://127.0.0.1:4173",
      port,
    });

    await expect(
      startDesignConnectBridge(manifest, {
        bridgeToken: "bridge-token",
        previewToken: "stale-preview-token",
      }),
    ).rejects.toThrow(/previewToken must match/);
  });

  it("reuses the persisted bridge token after a daemon restart", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://127.0.0.1:4173",
      port,
    });
    const firstBridge = await startDesignConnectBridge(manifest);
    await new Promise<void>((resolve) =>
      firstBridge.server.close(() => resolve()),
    );

    process.env["AGENT_NATIVE_PREVIEW_TOKEN"] = "stale-preview-token";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secondBridge = await startDesignConnectBridge(manifest);
    try {
      expect(secondBridge.bridgeToken).toBe(firstBridge.bridgeToken);
      expect(secondBridge.previewToken).toBe(firstBridge.previewToken);
      expect(warn).toHaveBeenCalledWith(
        "Ignoring stale AGENT_NATIVE_PREVIEW_TOKEN; the current bridge token determines the preview token.",
      );
      const tokenPath = path.join(root, ".agent-native", "design-bridge-token");
      expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600);
    } finally {
      warn.mockRestore();
      await new Promise<void>((resolve) =>
        secondBridge.server.close(() => resolve()),
      );
    }
  });

  it("retains stale-revision rejection after key eviction, re-registration, and daemon restart", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://127.0.0.1:4173",
      port,
    });
    let bridge = await startDesignConnectBridge(manifest);
    const base = `http://127.0.0.1:${port}`;
    const designId = "design-revision-survives-reload";
    const auth = liveEditAuth(bridge, designId);
    const publish = (revision: number) =>
      postJson(
        `${base}/live-edit-pending`,
        {
          designId,
          revision,
          pending: {
            designId,
            pendingEditCount: 1,
            status: "ready",
            prompt: `Revision ${revision}`,
          },
        },
        auth,
      );
    const register = (bridgeKey: string) =>
      postJson(
        `${base}/live-edit-bridge`,
        {
          script: "agent-native:editor-chrome-ready",
          bridgeKey,
          designId,
        },
        auth,
      );
    try {
      expect((await register("revision-survivor")).status).toBe(200);
      expect((await publish(9)).status).toBe(200);
      for (let index = 0; index < 128; index += 1) {
        const otherDesign = `design-key-eviction-${index}`;
        const otherAuth = liveEditAuth(bridge, otherDesign);
        const registered = await postJson(
          `${base}/live-edit-bridge`,
          {
            script: "agent-native:editor-chrome-ready",
            bridgeKey: `evicting-key-${index}`,
            designId: otherDesign,
          },
          otherAuth,
        );
        expect(registered.status).toBe(200);
      }
      expect((await publish(8)).status).toBe(403);
      expect((await register("revision-survivor-again")).status).toBe(200);
      expect((await publish(8)).status).toBe(409);
    } finally {
      await new Promise<void>((resolve) => bridge.server.close(resolve));
    }

    bridge = await startDesignConnectBridge(manifest);
    try {
      expect((await register("revision-survivor-after-restart")).status).toBe(
        200,
      );
      expect((await publish(8)).status).toBe(409);
      expect((await publish(10)).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => bridge.server.close(resolve));
    }
  });

  it("fails closed instead of evicting retained design revision marks at capacity", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://127.0.0.1:4173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const base = `http://127.0.0.1:${port}`;
    const register = (designId: string) =>
      postJson(
        `${base}/live-edit-bridge`,
        {
          script: "agent-native:editor-chrome-ready",
          bridgeKey: "bounded-revision-key",
          designId,
        },
        liveEditAuth(bridge, designId),
      );
    const publish = (designId: string, revision: number) =>
      postJson(
        `${base}/live-edit-pending`,
        {
          designId,
          revision,
          pending: {
            designId,
            pendingEditCount: 1,
            status: "ready",
            prompt: `${designId} revision ${revision}`,
          },
        },
        liveEditAuth(bridge, designId),
      );
    try {
      for (let index = 0; index < 256; index += 1) {
        const designId = `bounded-design-${index}`;
        expect((await register(designId)).status).toBe(200);
        expect((await publish(designId, index === 0 ? 5 : 1)).status).toBe(200);
      }

      const file = path.join(root, ".agent-native", "live-edit-revisions.json");
      const stored = JSON.parse(fs.readFileSync(file, "utf8")) as {
        revisions: Record<string, number>;
      };
      expect(Object.keys(stored.revisions)).toHaveLength(256);

      expect((await register("bounded-design-overflow")).status).toBe(200);
      expect((await publish("bounded-design-overflow", 1)).status).toBe(503);
      expect((await register("bounded-design-0")).status).toBe(200);
      expect((await publish("bounded-design-0", 4)).status).toBe(409);
      expect(
        JSON.parse(fs.readFileSync(file, "utf8")).revisions["bounded-design-0"],
      ).toBe(5);
    } finally {
      await new Promise<void>((resolve) => bridge.server.close(resolve));
    }
  }, 15_000);

  it("serializes concurrent pending revisions so a queued lower revision is stale", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://127.0.0.1:4173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const base = `http://127.0.0.1:${port}`;
    const designId = "design-concurrent-revisions";
    const auth = liveEditAuth(bridge, designId);
    const registered = await postJson(
      `${base}/live-edit-bridge`,
      {
        script: "agent-native:editor-chrome-ready",
        bridgeKey: "concurrent-revision-key",
        designId,
      },
      auth,
    );
    expect(registered.status).toBe(200);

    const originalRename = fsPromises.rename;
    let releaseFirstRename!: () => void;
    let notifyFirstRename!: () => void;
    const firstRenameStarted = new Promise<void>((resolve) => {
      notifyFirstRename = resolve;
    });
    const firstRenameGate = new Promise<void>((resolve) => {
      releaseFirstRename = resolve;
    });
    let renameCount = 0;
    const renameSpy = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (...args) => {
        renameCount += 1;
        if (renameCount === 1) {
          notifyFirstRename();
          await firstRenameGate;
        }
        return originalRename(...args);
      });

    const publish = (revision: number) =>
      postJson(
        `${base}/live-edit-pending`,
        {
          designId,
          revision,
          pending: {
            designId,
            pendingEditCount: 1,
            status: "ready",
            prompt: `Revision ${revision}`,
          },
        },
        auth,
      );
    try {
      const newer = publish(20);
      await firstRenameStarted;
      const older = publish(19);
      releaseFirstRename();

      const [newerResult, olderResult] = await Promise.all([newer, older]);
      expect(newerResult.status).toBe(200);
      expect(olderResult.status).toBe(409);
      expect(olderResult.body.error).toMatch(/stale pending publication/);
      expect(
        (await getJson(`${base}/live-edit-pending?designId=${designId}`, auth))
          .body.pending,
      ).toMatchObject({ prompt: "Revision 20" });
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(root, ".agent-native", "live-edit-revisions.json"),
            "utf8",
          ),
        ).revisions[designId],
      ).toBe(20);
    } finally {
      releaseFirstRename();
      renameSpy.mockRestore();
      await new Promise<void>((resolve) => bridge.server.close(resolve));
    }
  });

  it("derives the same design-scoped capability contract as the Design action", () => {
    expect(
      deriveDesignScopedLiveEditCapability("stored-bridge-token", "design_1"),
    ).toBe("35a0a665bdfa09540ba0fa820572e5bdda7b4ce7d3a7906a6d90617063189130");
    expect(
      deriveDesignScopedLiveEditRegistrationCapability(
        "stored-bridge-token",
        "design_1",
      ),
    ).toBe("b0399b9ad730e945aeacb7d5122fb683a175724eff548537fbbace9967ff55c7");
  });

  it("isolates local pending visual edits by design", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://127.0.0.1:4173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const base = `http://127.0.0.1:${port}`;
    const authA = liveEditAuth(bridge, "design-1");
    const authB = liveEditAuth(bridge, "design-2");
    const registrationAuthA = liveEditRegistrationAuth(bridge, "design-1");
    const auth = authA;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const registered = await postJson(
        `${base}/live-edit-bridge`,
        {
          script: "agent-native:editor-chrome-ready",
          bridgeKey: "screen-a",
          designId: "design-1",
        },
        authA,
      );
      expect(registered.status).toBe(200);
      const publicViewerRegistered = await postJson(
        `${base}/live-edit-bridge`,
        {
          script: "agent-native:editor-chrome-ready",
          bridgeKey: "public-viewer-screen-a",
          designId: "design-1",
        },
        registrationAuthA,
      );
      expect(publicViewerRegistered.status).toBe(200);
      expect(
        (
          await getJson(
            `${base}/live-edit-pending?designId=design-1`,
            registrationAuthA,
          )
        ).status,
      ).toBe(403);
      const publicViewerPublish = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 1,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "A copied public link cannot publish agent handoff data.",
          },
        },
        registrationAuthA,
      );
      expect(publicViewerPublish.status).toBe(403);
      const secondRegistered = await postJson(
        `${base}/live-edit-bridge`,
        {
          script: "agent-native:editor-chrome-ready",
          bridgeKey: "screen-b",
          designId: "design-2",
        },
        authB,
      );
      expect(secondRegistered.status).toBe(200);
      const forgedDesignRegistration = await postJson(
        `${base}/live-edit-bridge`,
        {
          script: "agent-native:editor-chrome-ready",
          bridgeKey: "forged-screen-b",
          designId: "design-2",
        },
        registrationAuthA,
      );
      expect(forgedDesignRegistration.status).toBe(403);
      expect((await getJson(`${base}/live-edit-pending`)).status).toBe(401);
      const unscopedRead = await getJson(`${base}/live-edit-pending`, authA);
      expect(unscopedRead.status).toBe(400);
      expect(unscopedRead.body.error).toMatch(/designId is required/);
      const unregisteredRead = await getJson(
        `${base}/live-edit-pending?designId=design-3`,
        authA,
      );
      expect(unregisteredRead.status).toBe(403);
      const unregisteredWrite = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-3",
          revision: 1,
          pending: {
            designId: "design-3",
            pendingEditCount: 1,
            status: "ready",
            prompt:
              "A registered design's token must not write an unregistered design.",
          },
        },
        auth,
      );
      expect(unregisteredWrite.status).toBe(403);
      const forgedDesignRead = await getJson(
        `${base}/live-edit-pending?designId=design-2`,
        authA,
      );
      expect(forgedDesignRead.status).toBe(403);
      const forgedDesignWrite = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-2",
          revision: 1,
          pending: {
            designId: "design-2",
            pendingEditCount: 1,
            status: "ready",
            prompt: "design A capability cannot write design B",
          },
        },
        authA,
      );
      expect(forgedDesignWrite.status).toBe(403);
      await expect(
        runDesign([
          "pending",
          "--root",
          root,
          "--bridge-url",
          base,
          "--preview-token",
          bridge.previewToken,
        ]),
      ).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("--design-id"),
      );
      expect(
        (await getJson(`${base}/live-edit-pending?designId=design-1`, auth))
          .body,
      ).toEqual({ ok: true, pending: null });
      expect(
        (
          await postJson(
            `${base}/live-edit-pending`,
            {
              designId: "design-1",
              revision: 1,
              pending: {
                designId: "design-1",
                pendingEditCount: 2,
                status: "ready",
                prompt: "Apply the two pending visual edits.",
              },
            },
            { "x-design-preview-token": "wrong-preview-token" },
          )
        ).status,
      ).toBe(401);

      const queryTokenWrite = await postJson(
        `${base}/live-edit-pending?previewToken=${encodeURIComponent(bridge.previewToken)}`,
        {
          designId: "design-1",
          revision: 2,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "forged query-token write",
          },
        },
      );
      expect(queryTokenWrite.status).toBe(401);

      const disallowedOriginWrite = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 3,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "forged cross-origin write",
          },
        },
        { ...auth, origin: "https://evil.example" },
      );
      expect(disallowedOriginWrite.status).toBe(403);

      const opaqueOriginWrite = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 4,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "forged opaque-origin write",
          },
        },
        { ...auth, origin: "null" },
      );
      expect(opaqueOriginWrite.status).toBe(403);

      const crossSiteNoOriginWrite = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 5,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "forged no-origin write",
          },
        },
        { ...auth, "sec-fetch-site": "cross-site" },
      );
      expect(crossSiteNoOriginWrite.status).toBe(403);

      const textPlainWrite = await postJson(
        `${base}/live-edit-pending`,
        {
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "forged simple-request write",
          },
        },
        { ...auth, "content-type": "text/plain" },
      );
      expect(textPlainWrite.status).toBe(415);

      const unwrapped = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          pendingEditCount: 2,
          status: "ready",
          prompt: "Unwrapped visual edits.",
        },
        auth,
      );
      expect(unwrapped.status).toBe(400);
      expect(unwrapped.body.error).toBe("pending must be an object or null");

      const missingRevision = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "Missing revision.",
          },
        },
        auth,
      );
      expect(missingRevision.status).toBe(400);
      expect(missingRevision.body.error).toMatch(/positive safe revision/);

      const published = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 10,
          pending: {
            designId: "design-1",
            pendingEditCount: 2,
            status: "ready",
            prompt: "Apply the two pending visual edits.",
          },
        },
        authA,
      );
      expect(published.status).toBe(200);
      expect(published.body.pending).toMatchObject({
        designId: "design-1",
        pendingEditCount: 2,
        status: "ready",
        prompt: "Apply the two pending visual edits.",
      });

      const secondPublished = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-2",
          revision: 3,
          pending: {
            designId: "design-2",
            pendingEditCount: 1,
            status: "ready",
            prompt: "Apply design two's visual edits.",
          },
        },
        authB,
      );
      expect(secondPublished.status).toBe(200);

      const pulled = await getJson(
        `${base}/live-edit-pending?designId=design-1`,
        auth,
      );
      expect(pulled.status).toBe(200);
      expect(pulled.body.pending).toMatchObject({
        designId: "design-1",
        prompt: "Apply the two pending visual edits.",
      });
      const pulledSecond = await getJson(
        `${base}/live-edit-pending?designId=design-2`,
        authB,
      );
      expect(pulledSecond.body.pending).toMatchObject({
        designId: "design-2",
        prompt: "Apply design two's visual edits.",
      });

      const staleUpdate = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 9,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "An older prompt must not replace the latest one.",
          },
        },
        auth,
      );
      expect(staleUpdate.status).toBe(409);
      expect(
        (await getJson(`${base}/live-edit-pending?designId=design-1`, auth))
          .body.pending,
      ).toMatchObject({ prompt: "Apply the two pending visual edits." });
      const exactRevisionRetry = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 10,
          pending: {
            designId: "design-1",
            pendingEditCount: 2,
            status: "ready",
            prompt: "Apply the two pending visual edits.",
          },
        },
        auth,
      );
      expect(exactRevisionRetry.status).toBe(200);
      const conflictingRevisionRetry = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 10,
          pending: {
            designId: "design-1",
            pendingEditCount: 2,
            status: "ready",
            prompt: "Conflicting content at the same revision.",
          },
        },
        auth,
      );
      expect(conflictingRevisionRetry.status).toBe(409);

      await expect(
        runDesign([
          "pending",
          "--root",
          root,
          "--bridge-url",
          base,
          "--preview-token",
          bridge.previewToken,
          "--design-id",
          "design-1",
        ]),
      ).resolves.toBe(0);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("Apply the two pending visual edits."),
      );

      const oversized = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 11,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "x".repeat(64 * 1024 + 1),
          },
        },
        auth,
      );
      expect(oversized.status).toBe(413);

      const cleared = await postJson(
        `${base}/live-edit-pending`,
        { designId: "design-1", revision: 11, pending: null },
        auth,
      );
      expect(cleared.status).toBe(200);
      expect(
        (await getJson(`${base}/live-edit-pending?designId=design-1`, auth))
          .body,
      ).toEqual({ ok: true, pending: null });
      const staleAfterClear = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-1",
          revision: 10,
          pending: {
            designId: "design-1",
            pendingEditCount: 1,
            status: "ready",
            prompt: "An old prompt must not resurrect after clear.",
          },
        },
        auth,
      );
      expect(staleAfterClear.status).toBe(409);
      expect(
        (await getJson(`${base}/live-edit-pending?designId=design-1`, auth))
          .body,
      ).toEqual({ ok: true, pending: null });
      expect(
        (await getJson(`${base}/live-edit-pending?designId=design-2`, authB))
          .body.pending,
      ).toMatchObject({ designId: "design-2" });

      for (let index = 0; index <= 32; index += 1) {
        const designId = `design-cap-${index}`;
        const registeredForCap = await postJson(
          `${base}/live-edit-bridge`,
          {
            script: "agent-native:editor-chrome-ready",
            bridgeKey: `screen-cap-${index}`,
            designId,
          },
          liveEditAuth(bridge, designId),
        );
        expect(registeredForCap.status).toBe(200);
        const storedForCap = await postJson(
          `${base}/live-edit-pending`,
          {
            designId,
            revision: 1,
            pending: {
              designId,
              pendingEditCount: 1,
              status: "ready",
              prompt: `Apply edits for ${designId}.`,
            },
          },
          liveEditAuth(bridge, designId),
        );
        expect(storedForCap.status).toBe(200);
      }
      expect(
        (
          await getJson(
            `${base}/live-edit-pending?designId=design-cap-0`,
            liveEditAuth(bridge, "design-cap-0"),
          )
        ).body.pending,
      ).toBeNull();
      expect(
        (
          await getJson(
            `${base}/live-edit-pending?designId=design-cap-32`,
            liveEditAuth(bridge, "design-cap-32"),
          )
        ).body.pending,
      ).toMatchObject({ designId: "design-cap-32" });
      const staleAfterCapacityEviction = await postJson(
        `${base}/live-edit-pending`,
        {
          designId: "design-cap-0",
          revision: 1,
          pending: {
            designId: "design-cap-0",
            pendingEditCount: 1,
            status: "ready",
            prompt: "A payload evicted by the capacity limit must not return.",
          },
        },
        liveEditAuth(bridge, "design-cap-0"),
      );
      expect(staleAfterCapacityEviction.status).toBe(409);

      const ttlDesignId = "design-ttl-expired";
      const ttlRegistration = await postJson(
        `${base}/live-edit-bridge`,
        {
          script: "agent-native:editor-chrome-ready",
          bridgeKey: "screen-ttl-expired",
          designId: ttlDesignId,
        },
        liveEditAuth(bridge, ttlDesignId),
      );
      expect(ttlRegistration.status).toBe(200);
      let now = Date.now();
      const systemTime = vi.spyOn(Date, "now").mockImplementation(() => now);
      try {
        const ttlPublish = await postJson(
          `${base}/live-edit-pending`,
          {
            designId: ttlDesignId,
            revision: 7,
            pending: {
              designId: ttlDesignId,
              pendingEditCount: 1,
              status: "ready",
              prompt: "This payload will expire.",
            },
          },
          liveEditAuth(bridge, ttlDesignId),
        );
        expect(ttlPublish.status).toBe(200);
        now += 7 * 24 * 60 * 60 * 1_000;
        expect(
          (
            await getJson(
              `${base}/live-edit-pending?designId=${ttlDesignId}`,
              liveEditAuth(bridge, ttlDesignId),
            )
          ).body.pending,
        ).toBeNull();
        const staleAfterTtlExpiry = await postJson(
          `${base}/live-edit-pending`,
          {
            designId: ttlDesignId,
            revision: 6,
            pending: {
              designId: ttlDesignId,
              pendingEditCount: 1,
              status: "ready",
              prompt: "An expired payload's older revision must not return.",
            },
          },
          liveEditAuth(bridge, ttlDesignId),
        );
        expect(staleAfterTtlExpiry.status).toBe(409);
        const newerAfterTtlExpiry = await postJson(
          `${base}/live-edit-pending`,
          {
            designId: ttlDesignId,
            revision: 8,
            pending: {
              designId: ttlDesignId,
              pendingEditCount: 1,
              status: "ready",
              prompt: "A newer edit remains publishable after expiry.",
            },
          },
          liveEditAuth(bridge, ttlDesignId),
        );
        expect(newerAfterTtlExpiry.status).toBe(200);
      } finally {
        systemTime.mockRestore();
      }
    } finally {
      log.mockRestore();
      error.mockRestore();
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("marks live-edit documents and keyed recovery redirects as embeddable", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><main>Screen</main></body></html>");
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
      const origin = "http://localhost:18081";
      const liveEditUrl = `${base}/live-edit?path=/library&bridgeKey=screen-a&previewToken=${bridge.previewToken}`;
      const auth = liveEditAuth(bridge, "test-design");
      const registration = await postJson(
        `${base}/live-edit-bridge`,
        {
          script:
            '<script>window.__screenBridge="A";window.parent.postMessage({type:"agent-native:editor-chrome-ready"},"*");</script>',
          bridgeKey: "screen-a",
          designId: "test-design",
        },
        auth,
      );
      expect(registration.status).toBe(200);
      const bridgeKey = String(registration.body.bridgeKey ?? "screen-a");

      const liveEdit = await getText(
        liveEditUrl.replace("screen-a", encodeURIComponent(bridgeKey)),
        { origin },
      );
      expect(liveEdit.status).toBe(200);
      expect(liveEdit.headers["cross-origin-resource-policy"]).toBe(
        "cross-origin",
      );
      expect(liveEdit.headers["cross-origin-embedder-policy"]).toBe(
        "credentialless",
      );

      const recovery = await getText(
        `${base}/library?agentNativeBridgeKey=screen-a`,
        {
          cookie: `agent-native-preview-token=${bridge.previewToken}`,
          origin,
          referer: liveEditUrl,
          "sec-fetch-dest": "document",
        },
      );
      expect(recovery.status).toBe(302);
      expect(recovery.headers.location).toContain("/live-edit?");
      expect(recovery.headers["cross-origin-resource-policy"]).toBe(
        "cross-origin",
      );
      expect(recovery.headers["cross-origin-embedder-policy"]).toBe(
        "credentialless",
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("keeps screen-specific editor bridge scripts isolated across parallel frames", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><main>Screen</main></body></html>");
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
      const auth = liveEditAuth(bridge, "test-design");
      const scriptA =
        '<script>window.__screenBridge="A";window.parent.postMessage({type:"agent-native:editor-chrome-ready"},"*");</script>';
      const scriptB =
        '<script>window.__screenBridge="B";window.parent.postMessage({type:"agent-native:editor-chrome-ready"},"*");</script>';
      await postJson(
        `${base}/live-edit-bridge`,
        { script: scriptA, bridgeKey: "screen-a", designId: "test-design" },
        auth,
      );
      await postJson(
        `${base}/live-edit-bridge`,
        { script: scriptB, bridgeKey: "screen-b", designId: "test-design" },
        auth,
      );

      const frameA = await getText(
        `${base}/live-edit?path=/a&bridgeKey=screen-a&previewToken=${bridge.previewToken}`,
      );
      const frameB = await getText(
        `${base}/live-edit?path=/b&bridgeKey=screen-b&previewToken=${bridge.previewToken}`,
      );

      expect(frameA.status).toBe(200);
      expect(frameA.body).toContain('window.__screenBridge="A"');
      expect(frameA.body).not.toContain('window.__screenBridge="B"');
      expect(frameB.status).toBe(200);
      expect(frameB.body).toContain('window.__screenBridge="B"');
      expect(frameB.body).not.toContain('window.__screenBridge="A"');
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("serves N simultaneously-mounted overview frames independently: concurrent registration, live-edit fetch, proxied asset requests, and HMR upgrades never let one frame starve or overwrite another", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const frameCount = 6;
    const devServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${devPort}`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><body><main data-route="${url.pathname}">Screen ${url.pathname}</main></body></html>`,
      );
    });
    const upstreamUpgradePaths: string[] = [];
    const openUpstreamSockets: Array<{ destroy(): void }> = [];
    devServer.on("upgrade", (req, socket) => {
      upstreamUpgradePaths.push(req.url ?? "");
      openUpstreamSockets.push(socket);
      const key = String(req.headers["sec-websocket-key"] ?? "");
      const accept = crypto
        .createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
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
    const openClientSockets: Array<{ destroy(): void }> = [];
    try {
      const base = `http://127.0.0.1:${port}`;
      const auth = liveEditAuth(bridge, "test-design");
      const frames = Array.from({ length: frameCount }, (_, i) => ({
        bridgeKey: `frame-${i}`,
        route: `/screen-${i}`,
        marker: `MARK_${i}_ONLY`,
      }));

      // All N frames register their screen-specific bridge script AT THE SAME
      // TIME, mirroring N iframes mounting together in an overview. If
      // registration were serialized behind shared mutable state (rather than
      // each landing independently in the keyed map), a late arrival could
      // clobber an earlier one before it's ever read back.
      await Promise.all(
        frames.map((frame) =>
          postJson(
            `${base}/live-edit-bridge`,
            {
              script: `<script>window.__frame="${frame.marker}";window.parent.postMessage({type:"agent-native:editor-chrome-ready"},"*");</script>`,
              bridgeKey: frame.bridgeKey,
              designId: "test-design",
            },
            auth,
          ),
        ),
      );

      // All N frames fetch their live-edit document AT THE SAME TIME. Each
      // response must contain only its own marker and route — never another
      // frame's, and never blank/hung.
      const liveEditResults = await Promise.all(
        frames.map((frame) =>
          getText(
            `${base}/live-edit?path=${encodeURIComponent(frame.route)}&bridgeKey=${frame.bridgeKey}&previewToken=${bridge.previewToken}`,
          ),
        ),
      );
      liveEditResults.forEach((result, i) => {
        const frame = frames[i]!;
        expect(result.status).toBe(200);
        expect(result.body).toContain(`window.__frame="${frame.marker}"`);
        expect(result.body).toContain(`data-route="${frame.route}"`);
        for (const other of frames) {
          if (other === frame) continue;
          expect(result.body).not.toContain(other.marker);
        }
      });

      // All N frames also request an ordinary proxied asset AT THE SAME TIME
      // (simulating each iframe's own JS/CSS module graph loading in
      // parallel). None should starve behind another.
      const assetResults = await Promise.all(
        frames.map((frame) =>
          getText(
            `${base}${frame.route}/asset.js?previewToken=${bridge.previewToken}`,
          ),
        ),
      );
      assetResults.forEach((result, i) => {
        expect(result.status).toBe(200);
        expect(result.body).toContain(
          `data-route="${frames[i]!.route}/asset.js"`,
        );
      });

      // All N frames open their Vite HMR WebSocket tunnel AT THE SAME TIME.
      // Every upgrade must independently reach the upstream dev server and
      // come back 101 — none should hang waiting on another frame's tunnel.
      const upgradeStatuses = await Promise.all(
        frames.map(
          (frame, i) =>
            new Promise<number>((resolve, reject) => {
              const request = http.request({
                hostname: "127.0.0.1",
                port,
                path: `/@vite/client?token=hmr-${i}`,
                headers: {
                  connection: "Upgrade",
                  upgrade: "websocket",
                  origin: base,
                  cookie: `agent-native-preview-token=${bridge.previewToken}`,
                  "sec-websocket-key": Buffer.from(`nonce-${i}-nonce`)
                    .toString("base64")
                    .padEnd(24, "A")
                    .slice(0, 24),
                  "sec-websocket-version": "13",
                },
              });
              const timeout = setTimeout(() => {
                reject(new Error(`frame ${i} upgrade stalled`));
              }, 8_000);
              request.on("upgrade", (response, socket) => {
                clearTimeout(timeout);
                openClientSockets.push(socket);
                resolve(response.statusCode ?? 0);
              });
              request.on("response", (response) => {
                clearTimeout(timeout);
                response.resume();
                resolve(response.statusCode ?? 0);
              });
              request.on("error", (error) => {
                clearTimeout(timeout);
                reject(error);
              });
              request.end();
            }),
        ),
      );
      expect(upgradeStatuses).toEqual(frames.map(() => 101));
      expect(upstreamUpgradePaths).toHaveLength(frameCount);
      expect(new Set(upstreamUpgradePaths).size).toBe(frameCount);
    } finally {
      for (const socket of openClientSockets) socket.destroy();
      for (const socket of openUpstreamSockets) socket.destroy();
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  }, 15_000);

  it("signals an unregistered bridgeKey with a machine-readable code and the process's bridgeInstanceId, so a client can tell a restarted bridge apart from a real bug", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><main>Screen</main></body></html>");
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

      // A bridgeKey that was never registered against THIS bridge process —
      // e.g. the client remembers registering it before the bridge process
      // restarted (crash, machine sleep/wake, manual restart), which silently
      // empties the in-memory liveEditBridgeScripts map.
      const unregistered = await getJson(
        `${base}/live-edit?path=/a&bridgeKey=never-registered&previewToken=${bridge.previewToken}`,
      );
      expect(unregistered.status).toBe(409);
      expect(unregistered.body.code).toBe("unknown-bridge-key");
      expect(unregistered.body.bridgeKey).toBe("never-registered");
      expect(unregistered.body.bridgeInstanceId).toBe(bridge.bridgeInstanceId);

      // The registration endpoint echoes the same instance id, so a client
      // that registers, then later hits the 409 above with a DIFFERENT
      // bridgeInstanceId than what it got back here, knows the process
      // restarted (safe to silently re-register) rather than distrust its
      // own bridgeKey.
      const registration = await postJson(
        `${base}/live-edit-bridge`,
        {
          script:
            '<script>window.parent.postMessage({type:"agent-native:editor-chrome-ready"},"*");</script>',
          bridgeKey: "screen-a",
          designId: "test-design",
        },
        liveEditAuth(bridge, "test-design"),
      );
      expect(registration.body.bridgeInstanceId).toBe(bridge.bridgeInstanceId);

      // /health exposes the same id for a lightweight out-of-band check.
      const health = await getJson(`${base}/health`);
      expect(health.body.bridgeInstanceId).toBe(bridge.bridgeInstanceId);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("mints a fresh bridgeInstanceId per bridge process, so a restart is distinguishable", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><main>Screen</main></body></html>");
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
    const firstBridge = await startDesignConnectBridge(manifest);
    await new Promise<void>((resolve) =>
      firstBridge.server.close(() => resolve()),
    );
    const secondBridge = await startDesignConnectBridge(manifest);
    try {
      expect(secondBridge.bridgeInstanceId).not.toBe(
        firstBridge.bridgeInstanceId,
      );
    } finally {
      await new Promise<void>((resolve) =>
        secondBridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

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
        `http://127.0.0.1:${port}/snapshot?path=/hello&previewToken=${bridge.previewToken}`,
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
      if (
        req.url?.startsWith("/@id/__x00__virtual:react-router/browser-manifest")
      ) {
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
        });
        res.end(
          "const manifest={url:'/@id/__x00__virtual:react-router/browser-manifest',runtime:'/@id/__x00__virtual:react-router/inject-hmr-runtime',routes:{root:{module:'/app/root.tsx',clientActionModule:'/app/actions.ts'}}};",
        );
        return;
      }
      if (req.url?.startsWith("/src/main.ts")) {
        if (req.headers.cookie || req.headers.authorization) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("sensitive request headers leaked");
          return;
        }
        if (req.headers["sec-fetch-dest"] !== "script") {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("missing script destination");
          return;
        }
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(
          "import '/src/dependency.ts'; import './relative-dependency.ts'; import('../shared/chunk.js'); const worker = new URL('./worker.ts', import.meta.url); window.__csrBooted = true; document.querySelector('#root').textContent = 'CSR booted';",
        );
        return;
      }
      if (req.url?.startsWith("/src/styles.css")) {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(
          "@import './reset.css'; .app{background:url('/assets/app.woff2#font')}",
        );
        return;
      }
      if (req.url?.startsWith("/src/styles.module.js")) {
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
        });
        res.end(
          `const __vite__css = "body{background:url('/assets/app.woff2#font')}";`,
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><head><title>CSR</title><style>@import './inline.css'; .hero{background:url('/assets/inline.png')}</style></head><body><div id="root">Loading</div><img src="/assets/cover.png"><img src="/assets/stale.png?previewToken=old&mode=dark"><img src="https://cdn.example.com/anonymous.png"><video controls src="/assets/preview.mp4"></video><script type="module" src="/src/main.ts"></script><script type="module">import "/@id/__x00__virtual:react-router/browser-manifest"; import "/@id/__x00__virtual:react-router/inject-hmr-runtime";</script></body></html>`,
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
          bridgeKey: "authorized-screen",
          designId: "test-design",
        },
        liveEditAuth(bridge, "test-design"),
      );
      expect(registration.status).toBe(200);
      expect(registration.body["ok"]).toBe(true);

      const rejectedArbitraryScript = await postJson(
        `${base}/live-edit-bridge`,
        {
          script: "<script>window.__arbitrary = true</script>",
          bridgeKey: "arbitrary-screen",
          designId: "test-design",
        },
        liveEditAuth(bridge, "test-design"),
      );
      expect(rejectedArbitraryScript.status).toBe(400);

      const html = await getText(
        `${base}/live-edit?path=/dashboard&previewToken=${bridge.previewToken}`,
      );
      expect(html.status).toBe(200);
      expect(html.headers["content-type"]).toContain("text/html");
      expect(html.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(html.headers["cross-origin-embedder-policy"]).toBe(
        "credentialless",
      );
      expect(html.body).toContain(`<base href="${base}/">`);
      expect(html.body).toContain(
        `src="/src/main.ts?previewToken=${bridge.previewToken}" crossorigin="use-credentials"`,
      );
      expect(html.body).toContain(
        `/assets/cover.png?previewToken=${bridge.previewToken}`,
      );
      expect(html.body).toContain(
        `/assets/preview.mp4?previewToken=${bridge.previewToken}`,
      );
      expect(html.body).toContain(
        `/assets/inline.png?previewToken=${bridge.previewToken}`,
      );
      expect(html.body).toContain(
        `./inline.css?previewToken=${bridge.previewToken}`,
      );
      expect(html.body).toContain(
        `/assets/stale.png?mode=dark&previewToken=${bridge.previewToken}`,
      );
      expect(html.body).toContain(
        `src="https://cdn.example.com/anonymous.png"`,
      );
      expect(html.body).toContain(
        `inject-hmr-runtime?previewToken=${bridge.previewToken}`,
      );
      expect(html.body).toContain(
        `browser-manifest?previewToken=${bridge.previewToken}`,
      );
      expect(html.body).toContain(
        `<script type="importmap" data-agent-native-opaque-preview-imports>`,
      );
      expect(html.body).toContain("data-agent-native-opaque-preview-auth");
      expect(html.body).toContain("var W=window.WebSocket");
      expect(html.body).toContain('a.protocol==="ws:"||a.protocol==="wss:"');
      expect(html.body).toContain('a.searchParams.has("previewToken")');
      expect(html.body).toContain(bridge.previewToken);
      const authScript = html.body.match(
        /<script data-agent-native-opaque-preview-auth>([\s\S]*?)<\/script>/,
      )?.[1];
      if (!authScript) throw new Error("missing preview auth shim");
      const socketUrls: string[] = [];
      function FakeWebSocket(url: string) {
        socketUrls.push(url);
      }
      FakeWebSocket.prototype = {};
      const iframeUrls: string[] = [];
      const nodePrototype = {
        appendChild: (node: unknown) => node,
      };
      const xhrPrototype = { open: () => undefined };
      const windowObject = {
        fetch: () => undefined,
        WebSocket: FakeWebSocket,
      };
      vm.runInNewContext(authScript, {
        window: windowObject,
        document: { baseURI: `${base}/live-edit` },
        Node: { prototype: nodePrototype },
        XMLHttpRequest: { prototype: xhrPrototype },
        URL,
      });
      const sameOriginIframe = {
        nodeType: 1,
        tagName: "IFRAME",
        value: `${base}/nested-preview`,
        getAttribute(name: string) {
          return name === "src" ? this.value : null;
        },
        setAttribute(name: string, value: string) {
          if (name === "src") {
            this.value = value;
            iframeUrls.push(value);
          }
        },
      };
      nodePrototype.appendChild(sameOriginIframe);
      expect(iframeUrls).toEqual([
        `${base}/nested-preview?previewToken=${bridge.previewToken}`,
      ]);
      const externalIframe = {
        ...sameOriginIframe,
        value: "https://external.example/nested-preview",
      };
      nodePrototype.appendChild(externalIframe);
      expect(iframeUrls).toHaveLength(1);
      new (windowObject.WebSocket as unknown as new (url: string) => unknown)(
        `ws://${new URL(base).host}/hmr`,
      );
      new (windowObject.WebSocket as unknown as new (url: string) => unknown)(
        "wss://external.example/hmr",
      );
      new (windowObject.WebSocket as unknown as new (url: string) => unknown)(
        `ws://${new URL(base).host}/hmr?previewToken=${bridge.previewToken}`,
      );
      expect(socketUrls).toEqual([
        `ws://${new URL(base).host}/hmr?previewToken=${bridge.previewToken}`,
        "wss://external.example/hmr",
        `ws://${new URL(base).host}/hmr?previewToken=${bridge.previewToken}`,
      ]);
      expect(html.body).toContain("agent-native:editor-chrome-ready");
      const previewSessionCookie = (
        Array.isArray(html.headers["set-cookie"])
          ? html.headers["set-cookie"][0]
          : html.headers["set-cookie"]
      )?.split(";")[0];
      expect(previewSessionCookie).toContain("agent-native-preview-token=");

      const interactHtml = await getText(
        `${base}/live-edit?path=/dashboard&bridge=0&previewToken=${bridge.previewToken}`,
      );
      expect(interactHtml.status).toBe(200);
      expect(interactHtml.body).toContain(`<base href="${base}/">`);
      expect(interactHtml.body).toContain(
        `src="/src/main.ts?previewToken=${bridge.previewToken}"`,
      );
      expect(interactHtml.body).not.toContain(
        "agent-native:editor-chrome-ready",
      );

      const module = await getText(
        `${base}/src/main.ts?previewToken=${bridge.previewToken}`,
        {
          "sec-fetch-site": "cross-site",
          "sec-fetch-dest": "script",
          origin: "null",
          cookie: `${previewSessionCookie}; pilot_session=must-not-forward`,
          authorization: "Bearer example-must-not-forward",
        },
      );
      expect(module.status).toBe(200);
      expect(module.headers["content-type"]).toContain(
        "application/javascript",
      );
      expect(module.headers["cross-origin-resource-policy"]).toBeUndefined();
      expect(module.headers["cross-origin-embedder-policy"]).toBeUndefined();
      expect(module.headers["content-length"]).toBe(
        String(Buffer.byteLength(module.body)),
      );
      expect(module.headers["access-control-allow-origin"]).toBe("null");
      expect(module.headers["access-control-allow-credentials"]).toBe("true");
      expect(module.body).toContain(
        `/src/dependency.ts?previewToken=${bridge.previewToken}`,
      );
      expect(module.body).toContain(
        `./relative-dependency.ts?previewToken=${bridge.previewToken}`,
      );
      expect(module.body).toContain(
        `../shared/chunk.js?previewToken=${bridge.previewToken}`,
      );
      expect(module.body).toContain(
        `./worker.ts?previewToken=${bridge.previewToken}`,
      );
      expect(module.body).toContain("CSR booted");

      const manifestModule = await getText(
        `${base}/@id/__x00__virtual:react-router/browser-manifest?previewToken=${bridge.previewToken}`,
        { origin: "null" },
      );
      expect(manifestModule.status).toBe(200);
      expect(manifestModule.body).toContain(
        `/app/root.tsx?previewToken=${bridge.previewToken}`,
      );
      expect(manifestModule.body).toContain(
        `/app/actions.ts?previewToken=${bridge.previewToken}`,
      );
      expect(manifestModule.body).toContain(
        `/@id/__x00__virtual:react-router/browser-manifest?previewToken=${bridge.previewToken}`,
      );
      expect(manifestModule.body).toContain(
        `/@id/__x00__virtual:react-router/inject-hmr-runtime?previewToken=${bridge.previewToken}`,
      );

      const css = await getText(`${base}/src/styles.css`, {
        origin: "null",
        cookie: previewSessionCookie,
        "x-design-preview-token": bridge.previewToken,
      });
      expect(css.status).toBe(200);
      expect(css.body).toContain(
        `/assets/app.woff2?previewToken=${bridge.previewToken}#font`,
      );
      expect(css.body).toContain(
        `./reset.css?previewToken=${bridge.previewToken}`,
      );

      const cssHead = await headText(
        `${base}/src/styles.css?previewToken=${bridge.previewToken}`,
        { origin: "null" },
      );
      expect(cssHead.status).toBe(200);
      expect(cssHead.headers["content-length"]).toBe(
        String(Buffer.byteLength(css.body)),
      );
      expect(cssHead.headers["cache-control"]).toBe("no-store");

      const cookieOnlyCssModule = await getText(
        `${base}/src/styles.module.js`,
        {
          origin: "null",
          cookie: previewSessionCookie,
        },
      );
      expect(cookieOnlyCssModule.status).toBe(200);
      expect(
        cookieOnlyCssModule.headers["access-control-allow-origin"],
      ).toBeUndefined();

      const cssModule = await getText(
        `${base}/src/styles.module.js?previewToken=${bridge.previewToken}`,
        { origin: "null" },
      );
      expect(cssModule.status).toBe(200);
      expect(cssModule.headers["access-control-allow-origin"]).toBe("null");
      expect(cssModule.body).toContain(
        `/assets/app.woff2?previewToken=${bridge.previewToken}#font`,
      );

      const panOnlyRegistration = await postJson(
        `${base}/live-edit-bridge`,
        {
          script:
            "<script>window.__panBridgeMarker = 'embedded-canvas-pan'</script>",
          bridgeKey: "pan-only",
          designId: "test-design",
        },
        liveEditAuth(bridge, "test-design"),
      );
      expect(panOnlyRegistration.status).toBe(200);
      const panOnlyHtml = await getText(
        `${base}/live-edit?path=/dashboard&bridgeKey=pan-only&previewToken=${bridge.previewToken}`,
      );
      expect(panOnlyHtml.body).toContain("embedded-canvas-pan");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("does not make third-party preview resources opt into CORP or CORS", async () => {
    const root = tmpDir();
    const assetPort = await freePort();
    let externalAssetRequests = 0;
    const assetServer = http.createServer((req, res) => {
      if (req.url === "/third-party.js") {
        externalAssetRequests += 1;
        // Deliberately omit both CORP and CORS: this models a normal CDN
        // script that was valid before the preview was embedded in Design.
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end("window.__thirdPartyPreviewAssetLoaded = true;");
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      assetServer.once("error", reject);
      assetServer.listen(assetPort, "127.0.0.1", () => {
        assetServer.off("error", reject);
        resolve();
      });
    });

    const devPort = await freePort();
    const devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html><body><div id="asset-status">Loading</div>
<script src="http://127.0.0.1:${assetPort}/third-party.js"></script>
<script>document.querySelector('#asset-status').textContent = window.__thirdPartyPreviewAssetLoaded ? 'Loaded' : 'Missing';</script>
</body></html>`);
    });
    await new Promise<void>((resolve, reject) => {
      devServer.once("error", reject);
      devServer.listen(devPort, "127.0.0.1", () => {
        devServer.off("error", reject);
        resolve();
      });
    });

    const bridgePort = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: `http://127.0.0.1:${devPort}`,
      port: bridgePort,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const hostPort = await freePort();
    const hostServer = http.createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        // Model the production Design page that embeds the loopback frame.
        "cross-origin-embedder-policy": "require-corp",
      });
      res.end(
        `<!doctype html><iframe title="preview" src="${
          manifest.bridgeUrl
        }/live-edit?path=/&previewToken=${bridge.previewToken}"></iframe>`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      hostServer.once("error", reject);
      hostServer.listen(hostPort, "127.0.0.1", () => {
        hostServer.off("error", reject);
        resolve();
      });
    });

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${hostPort}/`);
      const frame = page
        .frames()
        .find((candidate) => candidate !== page.mainFrame());
      if (!frame) throw new Error("preview iframe did not load");
      await frame.waitForFunction(
        () =>
          (window as Window & { __thirdPartyPreviewAssetLoaded?: boolean })
            .__thirdPartyPreviewAssetLoaded === true,
        { timeout: 10_000 },
      );
      expect(await frame.locator("#asset-status").textContent()).toBe("Loaded");
      expect(externalAssetRequests).toBeGreaterThan(0);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => hostServer.close(() => resolve()));
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
      await new Promise<void>((resolve) => assetServer.close(() => resolve()));
    }
  }, 60_000);

  it("proxies a query-string-suffixed asset request to the dev server byte-for-byte, without dropping or rewriting the query", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    // Vite's `?url` module convention is recognized only for the EXACT
    // valueless query `?url`; a proxy bug that turns it into `?url=` (or
    // drops it) makes Vite fall back to serving a completely different
    // response for the same asset path.
    const tinyModule = 'export default "/app/global.css"';
    const rawFallback = "/* raw unprocessed source, not the ?url module */";
    const devServer = http.createServer((req, res) => {
      if (req.url === "/app/global.css?url") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(tinyModule);
        return;
      }
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(rawFallback);
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

      // previewToken supplied via header: the query string reaching the
      // bridge never contains "previewToken" at all.
      const viaHeader = await getText(`${base}/app/global.css?url`, {
        "x-design-preview-token": bridge.previewToken,
      });
      expect(viaHeader.status).toBe(200);
      expect(viaHeader.body).toBe(tinyModule);
      expect(viaHeader.headers["content-type"]).toContain("text/javascript");

      // previewToken supplied via query string alongside the valueless
      // `url` flag: only the previewToken pair may be removed, and the
      // remaining query must reach the dev server as the bare `?url`
      // Vite expects, not `?url=` or `?url=&...`.
      const viaQuery = await getText(
        `${base}/app/global.css?url&previewToken=${bridge.previewToken}`,
      );
      expect(viaQuery.status).toBe(200);
      expect(viaQuery.body).toBe(tinyModule);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("survives a client resetting a proxied WebSocket upgrade", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    // A dev server that accepts the upgrade and then holds the socket open,
    // so the reset comes from the bridge's client side while both proxied
    // sockets are live.
    const devServer = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const devSockets: net.Socket[] = [];
    devServer.on("upgrade", (_req, socket) => {
      devSockets.push(socket);
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      socket.on("error", () => socket.destroy());
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
      const client = net.connect(port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      client.on("error", () => {});
      client.write(
        [
          `GET /ws?previewToken=${bridge.previewToken} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
      await new Promise<void>((resolve) =>
        client.once("data", () => resolve()),
      );
      // RST instead of FIN: this is what an abruptly closed tab produces and
      // what surfaced as `read ECONNRESET` in the bridge.
      client.resetAndDestroy();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const health = await getJson(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(health.body["ok"]).toBe(true);
    } finally {
      // The dev server still holds the proxied upstream socket open; drop
      // every connection so close() does not wait on it.
      for (const socket of devSockets) socket.destroy();
      bridge.server.closeAllConnections();
      devServer.closeAllConnections();
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("sends a keyed frame's navigation back through /live-edit with its own bridgeKey", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const seenByDevServer: string[] = [];
    const devServer = http.createServer((req, res) => {
      seenByDevServer.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><title>${req.url}</title><h1>page ${req.url}</h1>`,
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
      const auth = liveEditAuth(bridge, "test-design");
      await postJson(
        `${base}/live-edit-bridge`,
        {
          script:
            '<script>window.__screenBridge="A";window.parent.postMessage({type:"agent-native:editor-chrome-ready"},"*");</script>',
          bridgeKey: "screen-a",
          designId: "test-design",
        },
        auth,
      );
      // Registered last: this is what the unkeyed slot would hand out.
      await postJson(
        `${base}/live-edit-bridge`,
        {
          script:
            '<script>window.__screenBridge="B";window.parent.postMessage({type:"agent-native:editor-chrome-ready"},"*");</script>',
          bridgeKey: "screen-b",
          designId: "test-design",
        },
        auth,
      );
      // Frame A follows a link to /home. The browser tags it as an iframe
      // navigation and its referer is the keyed /live-edit URL it came from.
      const navigated = await fetch(`${base}/home`, {
        redirect: "manual",
        headers: {
          ...auth,
          "sec-fetch-dest": "iframe",
          referer: `${base}/live-edit?url=${encodeURIComponent(`http://127.0.0.1:${devPort}/`)}&bridgeKey=screen-a&previewToken=${bridge.previewToken}`,
        },
      });
      expect(navigated.status).toBe(302);
      const location = new URL(navigated.headers.get("location") ?? "");
      expect(location.pathname).toBe("/live-edit");
      expect(location.searchParams.get("url")).toBe(
        `http://127.0.0.1:${devPort}/home`,
      );
      expect(location.searchParams.get("bridgeKey")).toBe("screen-a");
      const landed = await getText(location.toString());
      expect(landed.status).toBe(200);
      expect(landed.body).toContain("page /home");
      expect(landed.body).toContain('window.__screenBridge="A"');
      expect(landed.body).not.toContain('window.__screenBridge="B"');
      // The pre-boot shim rewrites the frame URL to the app route; the key
      // rides along so the NEXT navigation's referer still carries it.
      expect(landed.body).toContain(
        JSON.stringify("/home?agentNativeBridgeKey=screen-a"),
      );

      // Second hop: the frame now sits on the rewritten app route, not on
      // /live-edit, and follows another link.
      const secondHop = await fetch(`${base}/settings`, {
        redirect: "manual",
        headers: {
          ...auth,
          "sec-fetch-dest": "iframe",
          referer: `${base}/home?agentNativeBridgeKey=screen-a`,
        },
      });
      expect(secondHop.status).toBe(302);
      const secondLocation = new URL(secondHop.headers.get("location") ?? "");
      expect(secondLocation.searchParams.get("bridgeKey")).toBe("screen-a");
      expect(secondLocation.searchParams.get("url")).toBe(
        `http://127.0.0.1:${devPort}/settings`,
      );

      // A keyed target with a valueless Vite-style flag keeps it byte-identical.
      const flagged = await getText(
        `${base}/live-edit?url=${encodeURIComponent(`http://127.0.0.1:${devPort}/page?url`)}&bridgeKey=screen-a&previewToken=${bridge.previewToken}`,
      );
      expect(flagged.status).toBe(200);
      expect(flagged.body).toContain(
        JSON.stringify("/page?url&agentNativeBridgeKey=screen-a"),
      );
      expect(flagged.body).not.toContain("?url=&");

      // A form POST navigation cannot be redirected without dropping its
      // body, so it is proxied with the frame's own keyed script instead.
      const posted = await fetch(`${base}/submit`, {
        method: "POST",
        redirect: "manual",
        headers: {
          ...auth,
          "sec-fetch-dest": "iframe",
          "content-type": "application/x-www-form-urlencoded",
          referer: `${base}/home?agentNativeBridgeKey=screen-a`,
        },
        body: "q=1",
      });
      expect(posted.status).toBe(200);
      const postedHtml = await posted.text();
      expect(postedHtml).toContain('window.__screenBridge="A"');
      expect(postedHtml).not.toContain('window.__screenBridge="B"');
      expect(postedHtml).toContain(
        JSON.stringify("/submit?agentNativeBridgeKey=screen-a"),
      );

      // The bridge-only identity param never reaches the dev server, even on
      // a POST whose form action kept the rewritten route's query.
      const postedWithKey = await fetch(
        `${base}/submit?agentNativeBridgeKey=screen-a`,
        {
          method: "POST",
          redirect: "manual",
          headers: {
            ...auth,
            "sec-fetch-dest": "iframe",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "q=1",
        },
      );
      expect(postedWithKey.status).toBe(200);
      expect(seenByDevServer).toContain("POST /submit");
      expect(
        seenByDevServer.some((entry) => entry.includes("agentNativeBridgeKey")),
      ).toBe(false);

      // A keyed POST whose key this bridge no longer knows is refused rather
      // than booted with the last registered screen's script.
      const stale = await fetch(`${base}/submit`, {
        method: "POST",
        redirect: "manual",
        headers: {
          ...auth,
          "sec-fetch-dest": "iframe",
          "content-type": "application/x-www-form-urlencoded",
          referer: `${base}/home?agentNativeBridgeKey=screen-gone`,
        },
        body: "q=1",
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        code: "unknown-bridge-key",
        bridgeKey: "screen-gone",
      });

      // A target that already carries a stale key gets exactly one, the
      // requested one.
      const restamped = await getText(
        `${base}/live-edit?url=${encodeURIComponent(`http://127.0.0.1:${devPort}/home?agentNativeBridgeKey=screen-b`)}&bridgeKey=screen-a&previewToken=${bridge.previewToken}`,
      );
      expect(restamped.status).toBe(200);
      expect(restamped.body).toContain(
        JSON.stringify("/home?agentNativeBridgeKey=screen-a"),
      );
      expect(restamped.body).not.toContain("agentNativeBridgeKey=screen-b");

      // A stale keyed POST is refused with its body drained, so the same
      // keep-alive connection serves the next request normally.
      const keepAlive = new http.Agent({ keepAlive: true, maxSockets: 1 });
      const onSameConnection = (
        options: http.RequestOptions,
        body?: string,
      ): Promise<{ status: number; body: string }> =>
        new Promise((resolve, reject) => {
          const request = http.request(
            { ...options, agent: keepAlive, host: "127.0.0.1", port },
            (response) => {
              const chunks: Buffer[] = [];
              response.on("data", (chunk) => chunks.push(chunk));
              response.on("end", () =>
                resolve({
                  status: response.statusCode ?? 0,
                  body: Buffer.concat(chunks).toString("utf8"),
                }),
              );
            },
          );
          request.on("error", reject);
          request.end(body);
        });
      try {
        const staleOnKeepAlive = await onSameConnection(
          {
            method: "POST",
            path: "/submit",
            headers: {
              ...auth,
              "sec-fetch-dest": "iframe",
              "content-type": "application/x-www-form-urlencoded",
              referer: `${base}/home?agentNativeBridgeKey=screen-gone`,
            },
          },
          "q=".padEnd(64 * 1024, "x"),
        );
        expect(staleOnKeepAlive.status).toBe(409);
        const next = await onSameConnection({
          method: "GET",
          path: "/health",
        });
        expect(next.status).toBe(200);
      } finally {
        keepAlive.destroy();
      }

      // A percent-encoded spelling of the identity param is still a duplicate.
      const encodedStale = await getText(
        `${base}/live-edit?url=${encodeURIComponent(`http://127.0.0.1:${devPort}/home?%61gentNativeBridgeKey=screen-b`)}&bridgeKey=screen-a&previewToken=${bridge.previewToken}`,
      );
      expect(encodedStale.status).toBe(200);
      expect(encodedStale.body).toContain(
        JSON.stringify("/home?agentNativeBridgeKey=screen-a"),
      );
      expect(encodedStale.body).not.toContain("screen-b");

      // The keyed page remembers its screen in window.name, and an unkeyed
      // frame navigation (no referer: Referrer-Policy no-referrer) carries a
      // recovery snippet that goes back through /live-edit with that key.
      expect(landed.body).toContain(
        'window.name="agent-native-bridge:"+"screen-a"',
      );
      const noReferer = await fetch(`${base}/settings`, {
        redirect: "manual",
        headers: { ...auth, "sec-fetch-dest": "iframe" },
      });
      expect(noReferer.status).toBe(200);
      const noRefererHtml = await noReferer.text();
      expect(noRefererHtml).toContain(
        'window.name.indexOf("agent-native-bridge:")===0',
      );
      expect(noRefererHtml).toContain(
        `location.replace("/live-edit?url="+encodeURIComponent(${JSON.stringify(`http://127.0.0.1:${devPort}/settings`)})`,
      );

      // A no-referer POST that already reached the app keeps its response:
      // recovery would re-issue it as a GET, so it is never injected there.
      const noRefererPost = await fetch(`${base}/submit`, {
        method: "POST",
        redirect: "manual",
        headers: {
          ...auth,
          "sec-fetch-dest": "iframe",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "q=1",
      });
      expect(noRefererPost.status).toBe(200);
      const noRefererPostHtml = await noRefererPost.text();
      expect(noRefererPostHtml).toContain("page /submit");
      expect(noRefererPostHtml).not.toContain("location.replace(");
      // …and, with keyed screens registered, it boots with no bridge rather
      // than with whichever screen registered last.
      expect(noRefererPostHtml).not.toContain("__screenBridge");

      // A reload of the rewritten URL itself carries the key in the request.
      const reload = await fetch(`${base}/home?agentNativeBridgeKey=screen-a`, {
        redirect: "manual",
        headers: { ...auth, "sec-fetch-dest": "iframe" },
      });
      expect(reload.status).toBe(302);
      const reloadLocation = new URL(reload.headers.get("location") ?? "");
      expect(reloadLocation.searchParams.get("bridgeKey")).toBe("screen-a");
      expect(reloadLocation.searchParams.get("url")).toBe(
        `http://127.0.0.1:${devPort}/home`,
      );

      // A navigation with no keyed referer still gets the proxied page with
      // the unkeyed bridge, as before.
      const unkeyed = await fetch(`${base}/home`, {
        redirect: "manual",
        headers: { ...auth, "sec-fetch-dest": "iframe" },
      });
      expect(unkeyed.status).toBe(200);
      expect(await unkeyed.text()).toContain("page /home");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("proxies a frame navigation to the bare root instead of serving the control-plane manifest", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const devServer = http.createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>app root</title><h1>app root</h1>");
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
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

      // Control-plane callers never send Sec-Fetch-Dest: the bare root keeps
      // returning the bridge manifest for them.
      const controlPlane = await getJson(`${base}/`, {
        "x-design-preview-token": bridge.previewToken,
      });
      expect(controlPlane.status).toBe(200);
      expect(controlPlane.body["source"]).toBe("agent-native-design-connect");

      // A live frame that navigates to "/" (router redirect, home link) is a
      // document/iframe navigation and must get the app's own root.
      const framed = await fetch(`${base}/`, {
        headers: {
          "x-design-preview-token": bridge.previewToken,
          "sec-fetch-dest": "iframe",
        },
      });
      expect(framed.status).toBe(200);
      expect(framed.headers.get("content-type") ?? "").toContain("text/html");
      expect(framed.headers.get("cross-origin-resource-policy")).toBe(
        "cross-origin",
      );
      expect(framed.headers.get("cross-origin-embedder-policy")).toBe(
        "credentialless",
      );
      const framedHtml = await framed.text();
      expect(framedHtml).toContain("app root");
      // The frame keeps live editing after navigating: the proxy must inject
      // the bridge into iframe navigations, not only top-level documents.
      expect(framedHtml).toContain("data-agent-native-live-edit-location");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("routes the proxied app's own manifest.json to the dev server instead of the bridge's control-plane manifest", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const proxiedAppManifest = { name: "Proxied App", start_url: "/" };
    const devServer = http.createServer((req, res) => {
      if (req.url === "/manifest.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(proxiedAppManifest));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
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

      // Existing control-plane callers (the Design app, and
      // fetchRunningBridgeManifest used by `design connect --json` / daemon
      // self-detection) never send Sec-Fetch-Dest, so /manifest.json keeps
      // returning the bridge's own manifest, still gated by the token.
      const unauthenticated = await getJson(`${base}/manifest.json`);
      expect(unauthenticated.status).toBe(401);

      const controlPlane = await getJson(`${base}/manifest.json`, {
        "x-design-preview-token": bridge.previewToken,
      });
      expect(controlPlane.status).toBe(200);
      expect(controlPlane.body["source"]).toBe("agent-native-design-connect");

      // A real browser's <link rel="manifest"> fetch (re-pointed at the
      // bridge origin by the injected <base href>) tags its request with
      // Sec-Fetch-Dest: manifest, a header page JS cannot set. That request
      // must reach the PROXIED APP's manifest, and — matching the target
      // dev server, which serves this path unauthenticated — must not be
      // blocked by a missing preview token.
      const proxied = await getJson(`${base}/manifest.json`, {
        "sec-fetch-dest": "manifest",
      });
      expect(proxied.status).toBe(200);
      expect(proxied.body).toEqual(proxiedAppManifest);

      const post = await postJson(
        `${base}/manifest.json`,
        {},
        { "sec-fetch-dest": "manifest" },
      );
      expect(post.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("keeps cookie and bearer auth shared across authenticated live-edit routes", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const seen: Array<{
      method: string;
      url: string;
      cookie?: string;
      authorization?: string;
      origin?: string;
      body: string;
    }> = [];
    const devServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        seen.push({
          method: req.method ?? "",
          url: req.url ?? "",
          cookie:
            typeof req.headers.cookie === "string"
              ? req.headers.cookie
              : undefined,
          authorization:
            typeof req.headers.authorization === "string"
              ? req.headers.authorization
              : undefined,
          origin:
            typeof req.headers.origin === "string"
              ? req.headers.origin
              : undefined,
          body,
        });
        if (req.url === "/api/login" && req.method === "POST") {
          res.writeHead(303, {
            location: "/dashboard",
            "set-cookie": [
              "preview_session=server-session; HttpOnly; Path=/; SameSite=Lax",
              "csrf=server-csrf; Path=/; SameSite=Lax",
            ],
          });
          res.end();
          return;
        }
        if (req.url === "/login" && req.method === "GET") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<!doctype html><html><body>Sign in</body></html>");
          return;
        }
        if (req.url === "/dashboard") {
          const authenticated = req.headers.cookie?.includes(
            "preview_session=server-session",
          );
          res.writeHead(authenticated ? 200 : 401, {
            "content-type": "text/html; charset=utf-8",
          });
          res.end(
            authenticated
              ? "<!doctype html><html><body>Authenticated dashboard</body></html>"
              : "Signed out",
          );
          return;
        }
        if (req.url === "/api/me") {
          const cookie = req.headers.cookie ?? "";
          const authorized =
            cookie.includes("preview_session=server-session") &&
            cookie.includes("client_pref=updated") &&
            req.headers.authorization === "Bearer local-storage-token";
          res.writeHead(authorized ? 200 : 401, {
            "content-type": "application/json",
          });
          res.end(JSON.stringify({ authorized }));
          return;
        }
        res.writeHead(404).end();
      });
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
      const primed = await getText(
        `${base}/live-edit?path=/login&previewToken=${bridge.previewToken}`,
      );
      const previewSessionCookie = (
        Array.isArray(primed.headers["set-cookie"])
          ? primed.headers["set-cookie"].find((value) =>
              value.startsWith("agent-native-preview-token="),
            )
          : primed.headers["set-cookie"]
      )?.split(";")[0];
      expect(previewSessionCookie).toContain("agent-native-preview-token=");
      const login = await fetch(`${base}/api/login`, {
        method: "POST",
        redirect: "follow",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          "sec-fetch-dest": "document",
          cookie: `${previewSessionCookie}; client_pref=initial`,
        },
        body: JSON.stringify({ email: "designer@example.test" }),
      });
      expect(login.status).toBe(200);
      expect(await login.text()).toContain("Authenticated dashboard");
      expect(login.headers.getSetCookie().join("\n")).toContain(
        "preview_session=server-session",
      );

      // A second URL-backed screen shares the bridge's isolated upstream jar.
      // A client-side document.cookie update and localStorage bearer token are
      // merged only for this same-origin app request.
      const me = await fetch(`${base}/api/me`, {
        headers: {
          "sec-fetch-site": "same-origin",
          cookie: `${previewSessionCookie}; csrf=server-csrf; client_pref=updated`,
          authorization: "Bearer local-storage-token",
        },
      });
      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({ authorized: true });

      const loginRequest = seen.find((request) => request.url === "/api/login");
      expect(loginRequest).toMatchObject({
        method: "POST",
        origin: `http://127.0.0.1:${devPort}`,
        body: JSON.stringify({ email: "designer@example.test" }),
      });
      const dashboardRequest = seen.find(
        (request) => request.url === "/dashboard",
      );
      expect(dashboardRequest?.cookie).toContain(
        "preview_session=server-session",
      );
      const meRequest = seen.find((request) => request.url === "/api/me");
      expect(meRequest?.cookie).toContain("client_pref=updated");
      expect(meRequest?.authorization).toBe("Bearer local-storage-token");

      const oversizedStatus = await new Promise<number>((resolve, reject) => {
        const request = http.request(
          `${base}/api/login`,
          {
            method: "POST",
            headers: {
              "content-length": String(8 * 1024 * 1024 + 1),
              "sec-fetch-site": "same-origin",
              cookie: previewSessionCookie,
            },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        request.on("error", reject);
        request.end();
      });
      expect(oversizedStatus).toBe(413);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("tunnels same-origin Vite HMR WebSocket upgrades to the connected dev server", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const upgradeRequests: Array<{
      url?: string;
      host?: string;
      origin?: string;
    }> = [];
    const phases: string[] = [];
    const upgradeSockets = new Set<{ destroy(): void }>();
    const devServer = http.createServer((_req, res) =>
      res.writeHead(404).end(),
    );
    devServer.on("upgrade", (req, socket) => {
      phases.push("upstream-upgrade");
      upgradeSockets.add(socket);
      socket.once("close", () => upgradeSockets.delete(socket));
      upgradeRequests.push({
        url: req.url,
        host: req.headers.host,
        origin:
          typeof req.headers.origin === "string"
            ? req.headers.origin
            : undefined,
      });
      const key = String(req.headers["sec-websocket-key"] ?? "");
      const accept = crypto
        .createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
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
    let pendingClientRequest: ReturnType<typeof http.request> | null = null;
    try {
      const bridgeOrigin = `http://127.0.0.1:${port}`;
      const statusPromise = new Promise<number>((resolve, reject) => {
        phases.push("client-request");
        const request = http.request({
          hostname: "127.0.0.1",
          port,
          path: "/@vite/client?token=hmr-token",
          headers: {
            connection: "Upgrade",
            upgrade: "websocket",
            origin: bridgeOrigin,
            cookie: `agent-native-preview-token=${bridge.previewToken}`,
            "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            "sec-websocket-version": "13",
          },
        });
        pendingClientRequest = request;
        request.on("upgrade", (response, socket) => {
          phases.push("client-upgrade");
          resolve(response.statusCode ?? 0);
          socket.destroy();
        });
        request.on("response", (response) => {
          phases.push(`client-response-${response.statusCode}`);
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.on("error", (error) => {
          phases.push(`client-error-${error.message}`);
          reject(error);
        });
        request.end();
      });
      const status = await Promise.race([
        statusPromise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`upgrade stalled: ${phases.join(", ")}`)),
            2_000,
          ),
        ),
      ]);
      expect(status).toBe(101);
      expect(upgradeRequests).toEqual([
        {
          url: "/@vite/client?token=hmr-token",
          host: `127.0.0.1:${devPort}`,
          origin: `http://127.0.0.1:${devPort}`,
        },
      ]);
    } finally {
      pendingClientRequest?.destroy();
      for (const socket of upgradeSockets) socket.destroy();
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
        `http://127.0.0.1:${port}/snapshot?url=http://example.com/&previewToken=${bridge.previewToken}`,
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

  it("exposes distinct write and read-only preview tokens on the bridge", async () => {
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
      expect(typeof bridge.previewToken).toBe("string");
      expect(bridge.previewToken).toHaveLength(64);
      expect(bridge.previewToken).not.toBe(bridge.bridgeToken);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("proves possession of the bridge token for a page bootstrap challenge", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const challenge = "a".repeat(32);
      const result = await getJson(
        `http://127.0.0.1:${port}/manifest.json?previewToken=${bridge.previewToken}&attestationChallenge=${challenge}`,
      );
      expect(result.status).toBe(200);
      expect(result.body.attestation).toEqual({
        challenge,
        signature: deriveDesignPreviewAttestationSignature(
          bridge.bridgeToken,
          challenge,
        ),
      });
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

  it("never accepts the read-only preview token for filesystem access", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "index.html"), "<h1>private source</h1>");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const result = await postJson(
        `http://127.0.0.1:${port}/read-file`,
        { relPath: "index.html" },
        { "x-bridge-token": bridge.previewToken },
      );
      expect(result.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("never accepts the filesystem token for browser preview registration", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const result = await postJson(
        `http://127.0.0.1:${port}/live-edit-bridge`,
        {
          script:
            "<script>window.__ready='agent-native:editor-chrome-ready'</script>",
        },
        { "x-design-preview-token": bridge.bridgeToken },
      );
      expect(result.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("blocks hostile browser origins and never emits wildcard CORS", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest, {
      allowedOrigins: ["https://design.example.com"],
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const approved = await getText(
        `${base}/manifest.json?previewToken=${bridge.previewToken}`,
        { origin: "https://design.example.com" },
      );
      expect(approved.status).toBe(200);
      expect(approved.headers["access-control-allow-origin"]).toBe(
        "https://design.example.com",
      );
      expect(approved.headers["access-control-allow-origin"]).not.toBe("*");

      const liveEditPreflight = await new Promise<{
        status: number;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        const request = http.request(
          `${base}/live-edit-bridge`,
          {
            method: "OPTIONS",
            headers: {
              origin: "https://design.example.com",
              "access-control-request-method": "POST",
              "access-control-request-headers":
                "content-type,x-design-preview-token,x-agent-native-live-edit-registration-capability",
            },
          },
          (response) => {
            response.resume();
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      });
      expect(liveEditPreflight.status).toBe(204);
      expect(
        liveEditPreflight.headers["access-control-allow-headers"],
      ).toContain("x-agent-native-live-edit-capability");
      expect(
        liveEditPreflight.headers["access-control-allow-headers"],
      ).toContain("x-agent-native-live-edit-registration-capability");

      const pendingReadPreflight = await new Promise<{
        status: number;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        const request = http.request(
          `${base}/live-edit-pending?designId=design-1`,
          {
            method: "OPTIONS",
            headers: {
              origin: "https://design.example.com",
              "access-control-request-method": "GET",
              "access-control-request-headers":
                "x-design-preview-token,x-agent-native-live-edit-capability",
            },
          },
          (response) => {
            response.resume();
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      });
      expect(pendingReadPreflight.status).toBe(204);
      expect(
        pendingReadPreflight.headers["access-control-allow-headers"],
      ).toContain("x-agent-native-live-edit-capability");

      const hostile = await getText(
        `${base}/manifest.json?previewToken=${bridge.previewToken}`,
        { origin: "https://hostile.example" },
      );
      expect(hostile.status).toBe(200);
      expect(hostile.headers["access-control-allow-origin"]).toBeUndefined();

      const preflight = await new Promise<{
        status: number;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        const request = http.request(
          `${base}/snapshot`,
          {
            method: "OPTIONS",
            headers: {
              origin: "https://hostile.example",
              "access-control-request-method": "GET",
              "access-control-request-private-network": "true",
            },
          },
          (response) => {
            response.resume();
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      });
      expect(preflight.status).toBe(403);
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("blocks cross-site proxy reads without a preview token", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const result = await getText(`http://127.0.0.1:${port}/private-route`, {
        origin: "https://hostile.example",
        "sec-fetch-site": "cross-site",
      });
      expect(result.status).toBe(401);
      expect(result.headers["access-control-allow-origin"]).toBeUndefined();
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

  it("edits existing text/code files without requiring an extension allowlist", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "tool.py"), "print('old')\n");
    fs.writeFileSync(path.join(root, "Dockerfile"), "FROM scratch\n");
    fs.writeFileSync(path.join(root, ".prettierrc"), '{"semi":true}\n');
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
      for (const [relPath, content] of [
        ["src/tool.py", "print('new')\n"],
        ["Dockerfile", "FROM example/base\n"],
        [".prettierrc", '{"semi":false}\n'],
      ] as const) {
        const result = await postJson(
          `${base}/write-file`,
          { relPath, content },
          authHeader,
        );
        expect(
          result.status,
          `${relPath}: ${JSON.stringify(result.body)}`,
        ).toBe(200);
        expect(fs.readFileSync(path.join(root, relPath), "utf8")).toBe(content);
      }
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects write-file for known binary file types", async () => {
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

  it("registerConnectionWithServer sends both scoped tokens in the payload", async () => {
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
        expect(captured?.["previewToken"]).toBe(bridge.previewToken);
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

  it("keeps health public but requires the preview token for manifests and routes", async () => {
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
      for (const pathname of ["/", "/manifest.json", "/routes.json"]) {
        await new Promise<void>((resolve, reject) => {
          http
            .get(`${base}${pathname}`, (res) => {
              expect(res.statusCode).toBe(401);
              res.resume();
              res.on("end", resolve);
            })
            .on("error", reject);
        });
      }
      expect((await getJson(`${base}/health`)).status).toBe(200);
      expect(
        (
          await getJson(
            `${base}/manifest.json?previewToken=${bridge.previewToken}`,
          )
        ).status,
      ).toBe(200);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });
});
