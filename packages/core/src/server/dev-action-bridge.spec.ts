import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockNotifyActionChange = vi.hoisted(() => vi.fn(async () => {}));
const mockIsLoopbackRequest = vi.hoisted(() => vi.fn(() => true));
const mockResolveDeployEnvironment = vi.hoisted(() => vi.fn(() => "local"));
const mockResolveDevUserEmail = vi.hoisted(() =>
  vi.fn(async () => undefined as string | undefined),
);

// Same mocking shape as action-routes.spec.ts: a fake h3 event is a plain
// object with `_headers`/`_body`/`_status`, and `defineEventHandler` is the
// identity function so the registered handler can be called directly.
vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  readBody: async (event: any) => event._body,
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
}));
vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: any) => app,
}));
vi.mock("./action-change.js", () => ({
  actionCallIsReadOnly: (
    entry: { readOnly?: boolean },
    _params: unknown,
    fallback: boolean,
  ) => entry.readOnly ?? fallback,
  notifyActionChange: (...args: unknown[]) => mockNotifyActionChange(...args),
}));
vi.mock("./auth.js", () => ({
  isLoopbackRequest: (...args: unknown[]) => mockIsLoopbackRequest(...args),
}));
vi.mock("./deploy-environment.js", () => ({
  resolveDeployEnvironment: () => mockResolveDeployEnvironment(),
}));
vi.mock("../scripts/dev-session.js", () => ({
  resolveDevUserEmail: () => mockResolveDevUserEmail(),
}));

import {
  DEV_ACTION_ROUTE,
  DEV_ACTION_ORG_HEADER,
  DEV_ACTION_TOKEN_HEADER,
  DEV_ACTION_USER_HEADER,
  getDevActionToken,
  hashDatabaseKey,
  mountDevActionForwardRoute,
  readDevActionDiscoveryFile,
  removeDevActionDiscoveryFile,
  writeDevActionDiscoveryFile,
} from "./dev-action-bridge.js";

function mountedHandler(actions: Record<string, any>, options?: any) {
  const mounted: Array<{ path: string; handler: any }> = [];
  const nitroApp = {
    use: (routePath: string, handler: any) =>
      mounted.push({ path: routePath, handler }),
  };
  mountDevActionForwardRoute(nitroApp, actions, options);
  return mounted[0]!.handler;
}

describe("dev action discovery file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-dev-action-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes 0600, is readable back, and removes cleanly", () => {
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:4000", "db-key");
    const filePath = path.join(tmpDir, ".agent-native", "dev-server.json");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

    const discovery = readDevActionDiscoveryFile(tmpDir);
    expect(discovery).toMatchObject({
      origin: "http://127.0.0.1:4000",
      pid: process.pid,
      databaseKey: "db-key",
    });
    expect(discovery?.token).toBe(getDevActionToken());

    removeDevActionDiscoveryFile(tmpDir);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(getDevActionToken()).toBeUndefined();
  });

  it("removing twice, or a directory that never had one, is a no-op", () => {
    expect(() => removeDevActionDiscoveryFile(tmpDir)).not.toThrow();
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:1", "k");
    removeDevActionDiscoveryFile(tmpDir);
    expect(() => removeDevActionDiscoveryFile(tmpDir)).not.toThrow();
  });

  it("treats a missing file as absent, not as a live server", () => {
    expect(readDevActionDiscoveryFile(tmpDir)).toBeUndefined();
  });

  it("treats malformed JSON as absent rather than throwing", () => {
    fs.mkdirSync(path.join(tmpDir, ".agent-native"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".agent-native", "dev-server.json"),
      "{not valid json",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readDevActionDiscoveryFile(tmpDir)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("treats a file with the wrong shape as absent rather than throwing", () => {
    fs.mkdirSync(path.join(tmpDir, ".agent-native"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".agent-native", "dev-server.json"),
      JSON.stringify({ origin: "http://x" }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readDevActionDiscoveryFile(tmpDir)).toBeUndefined();
    warn.mockRestore();
  });

  it("hashes a database URL deterministically and distinguishes different URLs", () => {
    expect(hashDatabaseKey("pglite:./data/pglite")).toBe(
      hashDatabaseKey("pglite:./data/pglite"),
    );
    expect(hashDatabaseKey("pglite:./data/pglite")).not.toBe(
      hashDatabaseKey("postgres://a/b"),
    );
  });
});

describe("mountDevActionForwardRoute", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-dev-action-route-"));
    mockNotifyActionChange.mockReset();
    mockNotifyActionChange.mockResolvedValue(undefined);
    mockIsLoopbackRequest.mockReset();
    mockIsLoopbackRequest.mockReturnValue(true);
    mockResolveDeployEnvironment.mockReset();
    mockResolveDeployEnvironment.mockReturnValue("local");
    mockResolveDevUserEmail.mockReset();
    mockResolveDevUserEmail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    removeDevActionDiscoveryFile(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects with 401 on a production deploy, before checking the token", async () => {
    mockResolveDeployEnvironment.mockReturnValue("production");
    const handler = mountedHandler({});
    const event: any = { _headers: {} };
    await expect(handler(event)).resolves.toMatchObject({ ok: false });
    expect(event._status).toBe(401);
  });

  it("rejects a non-loopback request with 401", async () => {
    mockIsLoopbackRequest.mockReturnValue(false);
    const handler = mountedHandler({});
    const event: any = { _headers: {} };
    await expect(handler(event)).resolves.toMatchObject({ ok: false });
    expect(event._status).toBe(401);
  });

  it("rejects a missing or wrong dev token with 401", async () => {
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:1", "k");
    const handler = mountedHandler({});

    const noToken: any = { _headers: {} };
    await expect(handler(noToken)).resolves.toMatchObject({ ok: false });
    expect(noToken._status).toBe(401);

    const wrongToken: any = {
      _headers: { [DEV_ACTION_TOKEN_HEADER]: "wrong" },
    };
    await expect(handler(wrongToken)).resolves.toMatchObject({ ok: false });
    expect(wrongToken._status).toBe(401);
  });

  it("returns 404 without running anything when the action isn't registered", async () => {
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:1", "k");
    const token = getDevActionToken()!;
    const handler = mountedHandler({});
    const event: any = {
      _headers: { [DEV_ACTION_TOKEN_HEADER]: token },
      _body: { name: "missing-action" },
    };
    const response = await handler(event);
    expect(response.ok).toBe(false);
    expect(event._status).toBe(404);
  });

  it("runs a registered action under caller cli with the header identity and returns its result", async () => {
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:1", "k");
    const token = getDevActionToken()!;
    const run = vi.fn(async (params: unknown, ctx: unknown) => ({
      params,
      ctx,
    }));
    const handler = mountedHandler(
      { "do-thing": { run, readOnly: false } as any },
      { appId: "fixture-app" },
    );
    const event: any = {
      _headers: {
        [DEV_ACTION_TOKEN_HEADER]: token,
        [DEV_ACTION_USER_HEADER]: "owner@example.test",
        [DEV_ACTION_ORG_HEADER]: "org_1",
      },
      _body: { name: "do-thing", input: { a: 1 } },
    };

    const response = await handler(event);
    expect(response.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    const [params, ctx] = run.mock.calls[0]!;
    expect(params).toEqual({ a: 1 });
    expect(ctx).toMatchObject({
      caller: "cli",
      userEmail: "owner@example.test",
      orgId: "org_1",
      appId: "fixture-app",
      actionName: "do-thing",
    });
    expect(mockResolveDevUserEmail).not.toHaveBeenCalled();
    expect(mockNotifyActionChange).toHaveBeenCalledWith({
      actionName: "do-thing",
    });
  });

  it("falls back to resolveDevUserEmail when no user header is sent", async () => {
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:1", "k");
    const token = getDevActionToken()!;
    mockResolveDevUserEmail.mockResolvedValue("resolved@example.test");
    const run = vi.fn(async (_params: unknown, ctx: unknown) => ctx);
    const handler = mountedHandler({ "do-thing": { run } as any });
    const event: any = {
      _headers: { [DEV_ACTION_TOKEN_HEADER]: token },
      _body: { name: "do-thing" },
    };

    const response = await handler(event);
    expect(mockResolveDevUserEmail).toHaveBeenCalledTimes(1);
    expect((response.result as any).userEmail).toBe("resolved@example.test");
  });

  it("returns 500 with the thrown message when the action fails, without notifying a change", async () => {
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:1", "k");
    const token = getDevActionToken()!;
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    const handler = mountedHandler({ "do-thing": { run } as any });
    const event: any = {
      _headers: { [DEV_ACTION_TOKEN_HEADER]: token },
      _body: { name: "do-thing" },
    };

    const response = await handler(event);
    expect(response).toEqual({ ok: false, error: "boom" });
    expect(event._status).toBe(500);
    expect(mockNotifyActionChange).not.toHaveBeenCalled();
  });

  it("skips notifyActionChange for a read-only action", async () => {
    writeDevActionDiscoveryFile(tmpDir, "http://127.0.0.1:1", "k");
    const token = getDevActionToken()!;
    const run = vi.fn(async () => "ok");
    const handler = mountedHandler({
      "read-thing": { run, readOnly: true } as any,
    });
    const event: any = {
      _headers: { [DEV_ACTION_TOKEN_HEADER]: token },
      _body: { name: "read-thing" },
    };

    await handler(event);
    expect(mockNotifyActionChange).not.toHaveBeenCalled();
  });
});

describe("auth guard exemption", () => {
  // The template auth middleware (`runAuthGuard`) 401s anonymous
  // /_agent-native/* requests before any route runs. The dev route must be
  // let through for loopback, non-production requests or `pnpm action`
  // forwarding silently degrades to "Unauthorized".
  it("keeps the loopback dev-action bypass in auth.ts", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "auth.ts"),
      "utf8",
    );
    const index = source.indexOf(`p === "${DEV_ACTION_ROUTE}"`);
    expect(index).toBeGreaterThan(-1);
    const bypass = source.slice(index, index + 200);
    expect(bypass).toContain('resolveDeployEnvironment() !== "production"');
    expect(bypass).toContain("isLoopbackRequest(event)");
  });
});
