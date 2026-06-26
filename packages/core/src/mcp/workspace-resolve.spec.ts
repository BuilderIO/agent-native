import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * workspace-resolve maps the MCP stdio CLI to the right local dev origin. It is
 * a Node-only module that walks the filesystem, optionally queries a gateway,
 * and TCP-probes ports. We use REAL temp directories for the filesystem walk
 * and app discovery, a controllable `node:net` mock so port probes are
 * deterministic, and a stubbed `fetch` for the gateway list.
 */

// --- controllable port-probe outcome -------------------------------------
// probePort dynamically imports("node:net") and connects a socket. We make
// every probe resolve via a single switch so tests stay deterministic.
let probeOutcome: "connect" | "error" | "timeout" = "error";

vi.mock("node:net", () => {
  class FakeSocket {
    private handlers: Record<string, (() => void)[]> = {};
    setTimeout() {}
    once(event: string, cb: () => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    destroy() {}
    connect() {
      const event =
        probeOutcome === "connect"
          ? "connect"
          : probeOutcome === "timeout"
            ? "timeout"
            : "error";
      // Fire asynchronously like a real socket would.
      queueMicrotask(() => this.handlers[event]?.forEach((cb) => cb()));
    }
  }
  const net = { Socket: FakeSocket };
  return { default: net, Socket: FakeSocket };
});

const { findWorkspaceRoot, resolveWorkspace, resolveLocalAppOrigin } =
  await import("./workspace-resolve.js");

let tmpRoot: string;

function mkdirp(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writePkg(dir: string, json: unknown) {
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(json));
}

/** Build a workspace root with the given app ids (each gets a package.json). */
function buildWorkspace(appIds: string[]): string {
  const root = fs.mkdtempSync(path.join(tmpRoot, "ws-"));
  writePkg(root, {
    name: "workspace",
    "agent-native": { workspaceCore: "@agent-native/core" },
  });
  for (const id of appIds) {
    writePkg(path.join(root, "apps", id), { name: id });
  }
  return root;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wsr-"));
  probeOutcome = "error";
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("findWorkspaceRoot", () => {
  it("finds the nearest ancestor with workspaceCore + an apps/ dir", () => {
    const root = buildWorkspace(["mail"]);
    const deep = path.join(root, "apps", "mail", "src", "nested");
    mkdirp(deep);
    expect(findWorkspaceRoot(deep)).toBe(root);
  });

  it("returns null when no ancestor declares a workspace", () => {
    const plain = fs.mkdtempSync(path.join(tmpRoot, "plain-"));
    writePkg(plain, { name: "just-an-app" });
    expect(findWorkspaceRoot(plain)).toBeNull();
  });

  it("ignores a workspaceCore package.json that lacks an apps/ dir", () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "noapps-"));
    writePkg(dir, {
      name: "ws",
      "agent-native": { workspaceCore: "@agent-native/core" },
    });
    // No apps/ dir → not a workspace root.
    expect(findWorkspaceRoot(dir)).toBeNull();
  });

  it("keeps walking past an unparsable package.json", () => {
    const root = buildWorkspace(["mail"]);
    const child = path.join(root, "apps", "mail");
    fs.writeFileSync(path.join(child, "package.json"), "{ not valid json");
    // Starting from the app with broken json, it should still find the root.
    expect(findWorkspaceRoot(child)).toBe(root);
  });
});

describe("resolveWorkspace — standalone (no workspace)", () => {
  it("treats the cwd as the single app and derives a clean id from the pkg name", async () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "solo-"));
    writePkg(dir, { name: "@agent-native/agent-native-mail" });
    probeOutcome = "error"; // dev server not up
    const ws = await resolveWorkspace(dir, { PORT: "4321" });
    expect(ws.isWorkspace).toBe(false);
    expect(ws.gatewayUrl).toBeUndefined();
    expect(ws.apps).toHaveLength(1);
    expect(ws.apps[0]).toMatchObject({
      // scope + agent-native- prefix stripped
      id: "mail",
      port: 4321,
      url: "http://127.0.0.1:4321",
      running: false,
    });
  });

  it("falls back to the Vite default port and reports running when the probe connects", async () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "solo-"));
    writePkg(dir, { name: "design" });
    probeOutcome = "connect";
    const ws = await resolveWorkspace(dir, {});
    expect(ws.apps[0].port).toBe(5173);
    expect(ws.apps[0].running).toBe(true);
  });

  it("derives the id from the directory name when package.json is absent", async () => {
    const dir = path.join(tmpRoot, "my-loose-app");
    mkdirp(dir);
    const ws = await resolveWorkspace(dir, {});
    expect(ws.isWorkspace).toBe(false);
    expect(ws.apps[0].id).toBe("my-loose-app");
  });
});

describe("resolveWorkspace — workspace via filesystem fallback (gateway down)", () => {
  beforeEach(() => {
    // Gateway unreachable → fall back to a filesystem scan.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
  });

  it("discovers apps/* and assigns 8100+index in dispatch-first order", async () => {
    const root = buildWorkspace(["mail", "calendar", "dispatch"]);
    const ws = await resolveWorkspace(root, {});
    expect(ws.isWorkspace).toBe(true);
    expect(ws.gatewayUrl).toBe("http://127.0.0.1:8080");
    // dispatch first, then alphabetical: dispatch, calendar, mail.
    expect(ws.apps.map((a) => [a.id, a.port])).toEqual([
      ["dispatch", 8100],
      ["calendar", 8101],
      ["mail", 8102],
    ]);
  });

  it("skips apps/* entries that lack a package.json", async () => {
    const root = buildWorkspace(["mail"]);
    // A bare directory with no package.json must be ignored.
    mkdirp(path.join(root, "apps", "not-an-app"));
    const ws = await resolveWorkspace(root, {});
    expect(ws.apps.map((a) => a.id)).toEqual(["mail"]);
  });

  it("honours WORKSPACE_PORT / WORKSPACE_HOST / app-port-start overrides", async () => {
    const root = buildWorkspace(["mail"]);
    const ws = await resolveWorkspace(root, {
      WORKSPACE_PORT: "9090",
      WORKSPACE_HOST: "0.0.0.0",
      WORKSPACE_APP_PORT_START: "9200",
    });
    expect(ws.gatewayUrl).toBe("http://0.0.0.0:9090");
    expect(ws.apps[0].port).toBe(9200);
  });
});

describe("resolveWorkspace — workspace via gateway list (authoritative)", () => {
  it("prefers the gateway's apps + ports over the filesystem scan", async () => {
    const root = buildWorkspace(["mail", "calendar"]);
    // Gateway reassigns ports and reports a different set than the FS scan.
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:8080/_workspace/apps");
      return new Response(
        JSON.stringify([
          { id: "mail", port: 8155 },
          { id: "calendar", port: 8156 },
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const ws = await resolveWorkspace(root, {});
    expect(ws.apps.map((a) => [a.id, a.port])).toEqual([
      ["mail", 8155],
      ["calendar", 8156],
    ]);
    expect(ws.apps.map((a) => a.url)).toEqual([
      "http://127.0.0.1:8155",
      "http://127.0.0.1:8156",
    ]);
  });

  it("falls back to the filesystem scan when the gateway returns non-2xx", async () => {
    const root = buildWorkspace(["dispatch", "mail"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503 })),
    );
    const ws = await resolveWorkspace(root, {});
    expect(ws.apps.map((a) => a.id)).toEqual(["dispatch", "mail"]);
  });

  it("falls back to the filesystem scan when the gateway returns a non-array body", async () => {
    const root = buildWorkspace(["mail"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ nope: true }), { status: 200 }),
      ),
    );
    const ws = await resolveWorkspace(root, {});
    expect(ws.apps.map((a) => a.id)).toEqual(["mail"]);
  });

  it("drops malformed gateway entries (no string id)", async () => {
    const root = buildWorkspace(["mail"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { id: "mail", port: 8155 },
              { port: 8156 },
              { id: 42, port: 8157 },
            ]),
            { status: 200 },
          ),
      ),
    );
    const ws = await resolveWorkspace(root, {});
    expect(ws.apps.map((a) => a.id)).toEqual(["mail"]);
  });
});

describe("resolveLocalAppOrigin precedence", () => {
  beforeEach(() => {
    // Default: gateway down → filesystem scan, ports unprobed/down.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
  });

  it("1. explicit port wins and maps to the matching app id", async () => {
    const root = buildWorkspace(["dispatch", "mail"]);
    const res = await resolveLocalAppOrigin({ cwd: root, port: 8101 });
    // dispatch=8100, mail=8101.
    expect(res.origin).toBe("http://127.0.0.1:8101");
    expect(res.appId).toBe("mail");
  });

  it("1b. explicit port with no matching app still returns that origin", async () => {
    const root = buildWorkspace(["mail"]);
    const res = await resolveLocalAppOrigin({ cwd: root, port: 9999 });
    expect(res.origin).toBe("http://127.0.0.1:9999");
    // Falls back to provided appId / first app id.
    expect(res.appId).toBe("mail");
  });

  it("1c. an explicit port outranks a conflicting appId and adopts the matched app's id", async () => {
    const root = buildWorkspace(["dispatch", "mail"]);
    // dispatch=8100, mail=8101. Port 8101 wins over the appId "dispatch".
    const res = await resolveLocalAppOrigin({
      cwd: root,
      port: 8101,
      appId: "dispatch",
    });
    expect(res.origin).toBe("http://127.0.0.1:8101");
    expect(res.appId).toBe("mail");
  });

  it("2. explicit appId selects that app's discovered url", async () => {
    const root = buildWorkspace(["dispatch", "mail", "calendar"]);
    const res = await resolveLocalAppOrigin({ cwd: root, appId: "calendar" });
    expect(res.appId).toBe("calendar");
    // dispatch first (8100), then alphabetical: calendar=8101, mail=8102.
    expect(res.origin).toBe("http://127.0.0.1:8101");
  });

  it("2b. an unknown appId throws and lists the available apps", async () => {
    const root = buildWorkspace(["dispatch", "mail"]);
    await expect(
      resolveLocalAppOrigin({ cwd: root, appId: "ghost" }),
    ).rejects.toThrow(/App "ghost" not found\. Available: dispatch, mail/);
  });

  it("3. defaults to dispatch when present and no selector is given", async () => {
    const root = buildWorkspace(["mail", "dispatch", "calendar"]);
    const res = await resolveLocalAppOrigin({ cwd: root });
    expect(res.appId).toBe("dispatch");
    expect(res.origin).toBe("http://127.0.0.1:8100");
  });

  it("3b. defaults to the first app when dispatch is absent", async () => {
    const root = buildWorkspace(["mail", "calendar"]);
    const res = await resolveLocalAppOrigin({ cwd: root });
    // alphabetical: calendar first.
    expect(res.appId).toBe("calendar");
    expect(res.origin).toBe("http://127.0.0.1:8100");
  });

  it("4. standalone single app resolves to its own origin", async () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "solo-"));
    writePkg(dir, { name: "@scope/forms" });
    const res = await resolveLocalAppOrigin({
      cwd: dir,
      env: { PORT: "3000" },
    });
    expect(res.appId).toBe("forms");
    expect(res.origin).toBe("http://127.0.0.1:3000");
    expect(res.ws.isWorkspace).toBe(false);
  });

  it("throws when a workspace has zero discoverable apps and no selector", async () => {
    // workspaceCore + apps/ dir present (so it IS a workspace) but apps/ empty
    // and the gateway is down → no apps resolved → guarded error.
    const root = fs.mkdtempSync(path.join(tmpRoot, "empty-ws-"));
    writePkg(root, {
      name: "ws",
      "agent-native": { workspaceCore: "@agent-native/core" },
    });
    mkdirp(path.join(root, "apps"));
    await expect(resolveLocalAppOrigin({ cwd: root })).rejects.toThrow(
      /No apps found/,
    );
  });
});
