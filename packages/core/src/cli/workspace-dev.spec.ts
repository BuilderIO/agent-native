import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialWorkspaceAppIds,
  isWorkspaceWatcherLimitError,
  runWorkspaceDev,
  shouldEagerStartWorkspaceApps,
  shouldPrewarmWorkspaceApps,
  shouldUsePollingFileWatcher,
  workspacePrewarmConcurrency,
  type WorkspaceDevHandle,
} from "./workspace-dev.js";

let tmpDir: string | undefined;
let handle: WorkspaceDevHandle | undefined;

afterEach(() => {
  handle?.shutdown();
  handle = undefined;
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("workspace dev startup", () => {
  it("starts only Dispatch by default and starts other apps on first visit", async () => {
    tmpDir = makeWorkspace(["dispatch", "starter"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;

    expect(fake.startedApps()).toEqual(["dispatch"]);

    await fetch(`${url}/_workspace/apps`);
    expect(fake.startedApps()).toEqual(["dispatch"]);

    const res = await fetch(`${url}/starter`, {
      headers: { accept: "text/html" },
    });
    expect(await res.text()).toContain("Starting Starter");
    expect(fake.startedApps()).toEqual(["dispatch", "starter"]);
  });

  it("starts every app in eager mode", async () => {
    tmpDir = makeWorkspace(["dispatch", "starter", "todo"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      args: ["--eager"],
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    expect(fake.startedApps()).toEqual(["dispatch", "starter", "todo"]);
  });

  it("prewarms non-default apps in the background after the gateway is ready", async () => {
    tmpDir = makeWorkspace(["dispatch", "starter", "todo"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: {
        ...testEnv(),
        // Opt in to prewarm for this test (testEnv disables it by default).
        WORKSPACE_NO_PREWARM: "",
        WORKSPACE_PREWARM_DELAY_MS: "0",
      },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    // Only the default app is started synchronously; prewarm catches up in
    // the background.
    expect(fake.startedApps().includes("dispatch")).toBe(true);

    await waitUntil(() => {
      const ids = new Set(fake.startedApps());
      return ids.has("starter") && ids.has("todo");
    });

    expect(new Set(fake.startedApps())).toEqual(
      new Set(["dispatch", "starter", "todo"]),
    );
  });

  it("does not prewarm when --no-prewarm is passed", async () => {
    tmpDir = makeWorkspace(["dispatch", "starter", "todo"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      args: ["--no-prewarm"],
      env: {
        ...testEnv(),
        WORKSPACE_NO_PREWARM: "",
        WORKSPACE_PREWARM_DELAY_MS: "0",
      },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    // Give any (hypothetically) scheduled prewarm a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.startedApps()).toEqual(["dispatch"]);
  });

  it("passes the public workspace OAuth origin separately from the local gateway", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: {
        ...testEnv(),
        APP_URL: "https://workspace.example.test/dispatch",
      },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    const env = fake.calls()[0]?.options?.env;
    expect(env?.WORKSPACE_GATEWAY_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(env?.VITE_WORKSPACE_GATEWAY_URL).toBe(env?.WORKSPACE_GATEWAY_URL);
    expect(env?.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON).toBe(
      env?.AGENT_NATIVE_WORKSPACE_APPS_JSON,
    );
    expect(env?.VITE_WORKSPACE_OAUTH_ORIGIN).toBe(
      "https://workspace.example.test",
    );
  });

  it("passes workspace app route access through local dev manifests and env", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    makeApp(tmpDir, "portal", {
      audience: "public",
      publicPaths: ["/", "/pricing"],
      protectedPaths: ["/admin"],
    });
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      args: ["--eager"],
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    const portalEnv = fake
      .calls()
      .find((call) => call.options?.env?.APP_NAME === "portal")?.options?.env;
    expect(portalEnv?.AGENT_NATIVE_WORKSPACE_APP_AUDIENCE).toBe("public");
    expect(portalEnv?.AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS).toBe(
      '["/","/pricing"]',
    );
    expect(portalEnv?.AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS).toBe(
      '["/admin"]',
    );
    expect(portalEnv?.VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE).toBe("public");
    expect(portalEnv?.VITE_AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS).toBe(
      '["/","/pricing"]',
    );
    expect(portalEnv?.VITE_AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS).toBe(
      '["/admin"]',
    );
    expect(
      JSON.parse(portalEnv?.AGENT_NATIVE_WORKSPACE_APPS_JSON ?? "[]").find(
        (app: any) => app.id === "portal",
      ),
    ).toMatchObject({
      audience: "public",
      publicPaths: ["/", "/pricing"],
      protectedPaths: ["/admin"],
    });
  });

  it("uses polling watchers in Builder-style remote dev environments", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: {
        ...testEnv(),
        BUILDER_PROJECT_ID: "builder-project",
      },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    const env = fake.calls()[0]?.options?.env;
    expect(env?.CHOKIDAR_USEPOLLING).toBe("1");
    expect(env?.CHOKIDAR_INTERVAL).toBe("1000");
    expect(env?.TSC_WATCHFILE).toBe("DynamicPriorityPolling");
    expect(env?.TSC_WATCHDIRECTORY).toBe("DynamicPriorityPolling");
  });

  it("strips inherited watcher env vars when polling is explicitly disabled", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: {
        ...testEnv(),
        // Container detected (would normally auto-enable polling) ...
        BUILDER_PROJECT_ID: "builder-project",
        // ... but operator explicitly disabled it.
        AGENT_NATIVE_DEV_USE_POLLING: "0",
        // Inherited from a stale parent shell — must NOT leak through.
        CHOKIDAR_USEPOLLING: "1",
        CHOKIDAR_INTERVAL: "500",
        TSC_WATCHFILE: "DynamicPriorityPolling",
        TSC_WATCHDIRECTORY: "DynamicPriorityPolling",
      },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    const env = fake.calls()[0]?.options?.env;
    expect(env?.CHOKIDAR_USEPOLLING).toBeUndefined();
    expect(env?.CHOKIDAR_INTERVAL).toBeUndefined();
    expect(env?.TSC_WATCHFILE).toBeUndefined();
    expect(env?.TSC_WATCHDIRECTORY).toBeUndefined();
  });

  it("preserves user-set watcher env vars when polling is not explicitly disabled", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: {
        ...testEnv(),
        // No container, no explicit toggle — auto-detection says no polling.
        // The user's custom TSC_WATCHFILE override must still pass through.
        TSC_WATCHFILE: "UseFsEventsWithFallbackDynamicPolling",
      },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    const env = fake.calls()[0]?.options?.env;
    expect(env?.TSC_WATCHFILE).toBe("UseFsEventsWithFallbackDynamicPolling");
    expect(env?.CHOKIDAR_USEPOLLING).toBeUndefined();
  });

  it("uses the root list as fallback when Dispatch is absent", async () => {
    tmpDir = makeWorkspace(["starter"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;

    const res = await fetch(url, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Agent-Native Workspace");
    expect(fake.startedApps()).toEqual([]);
  });

  it("redirects root requests with query strings to Dispatch", async () => {
    tmpDir = makeWorkspace(["dispatch", "starter"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;

    const res = await fetch(`${url}/?builderPreview=1`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dispatch?builderPreview=1");
  });

  it("refreshes the root fallback app list before rendering", async () => {
    tmpDir = makeWorkspace(["starter"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;
    makeApp(tmpDir, "todo");

    const res = await fetch(`${url}/?fallback=1`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("/todo");
    expect(html).toContain("Todo");
  });

  it("detects new apps without starting them until requested", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;
    makeApp(tmpDir, "todo");

    const apps = (await (
      await fetch(`${url}/_workspace/apps`)
    ).json()) as Array<{
      id: string;
      running: boolean;
    }>;
    expect(apps.map((app) => app.id)).toEqual(["dispatch", "todo"]);
    expect(apps.find((app) => app.id === "todo")?.running).toBe(false);
    expect(fake.startedApps()).toEqual(["dispatch"]);

    await fetch(`${url}/todo`, { headers: { accept: "text/html" } });
    expect(fake.startedApps()).toEqual(["dispatch", "todo"]);
  });

  it("marks a cold app ready while serving the loading page", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: { ...testEnv(), WORKSPACE_PROXY_READY_TIMEOUT_MS: "1000" },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;
    const app = handle.apps.find((candidate) => candidate.id === "dispatch");
    expect(app).toBeDefined();

    const first = await fetch(`${url}/dispatch`, {
      headers: { accept: "text/html" },
    });
    expect(await first.text()).toContain("Starting Dispatch");

    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>Dispatch ready</h1>");
    });
    await new Promise<void>((resolve) => {
      upstream.listen(app!.port, "127.0.0.1", resolve);
    });
    try {
      await waitUntil(() => app!.ready === true);

      const second = await fetch(`${url}/dispatch`, {
        headers: { accept: "text/html" },
      });
      expect(await second.text()).toContain("Dispatch ready");
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("runs a workspace install before starting a newly generated app without installed bins", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;
    makeApp(tmpDir, "todo", { installVite: false });

    const res = await fetch(`${url}/todo`, {
      headers: { accept: "text/html" },
    });
    expect(await res.text()).toContain(
      "installing this app&#39;s dependencies",
    );

    const installCall = fake.calls().at(-1);
    expect(installCall).toMatchObject({
      command: "pnpm",
      args: [
        "--dir",
        tmpDir,
        "install",
        "--no-frozen-lockfile",
        "--prefer-offline",
      ],
    });
    expect(fake.startedApps()).toEqual(["dispatch"]);

    createViteBin(path.join(tmpDir, "apps", "todo"));
    installCall?.child.emit("exit", 0, null);

    expect(fake.startedApps()).toEqual(["dispatch", "todo"]);
  });

  it("shows the last child-process error while waiting to retry", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;

    await fetch(`${url}/dispatch`, {
      headers: { accept: "text/html" },
    });
    const appCall = fake.calls().at(-1);
    expect(appCall).toBeDefined();

    appCall?.child.stderr?.emit(
      "data",
      "Error: Cannot find module '@agent-native/example'\n",
    );
    appCall?.child.emit("exit", 1, null);

    const res = await fetch(`${url}/dispatch`, {
      headers: { accept: "text/html" },
    });
    const html = await res.text();

    expect(html).toContain("App failed to start: Dispatch");
    expect(html).toContain("Cannot find module");
    expect(html).toContain("@agent-native/example");
    expect(fake.startedApps()).toEqual(["dispatch"]);
  });

  it("turns a never-ready child process into a visible retrying failure", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = await runWorkspaceDev({
      root: tmpDir,
      env: { ...testEnv(), WORKSPACE_PROXY_READY_TIMEOUT_MS: "50" },
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    const { url } = await handle.ready;

    const first = await fetch(`${url}/dispatch`, {
      headers: { accept: "text/html" },
    });
    expect(await first.text()).toContain("Starting Dispatch");

    await waitUntil(() => Boolean(handle?.apps[0]?.lastFailure), 500);

    const res = await fetch(`${url}/dispatch`, {
      headers: { accept: "text/html" },
    });
    const html = await res.text();

    expect(html).toContain("App failed to start: Dispatch");
    expect(html).toContain("Timed out waiting 50ms");
    expect(html).toContain("127.0.0.1:");
    expect(fake.calls().at(-1)?.child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("workspace dev helpers", () => {
  it("parses eager mode from args or env", () => {
    expect(shouldEagerStartWorkspaceApps(["--eager"], {})).toBe(true);
    expect(shouldEagerStartWorkspaceApps([], { WORKSPACE_EAGER: "1" })).toBe(
      true,
    );
    expect(shouldEagerStartWorkspaceApps([], {})).toBe(false);
  });

  it("defaults prewarm on in lazy mode and respects opt-outs", () => {
    expect(shouldPrewarmWorkspaceApps([], {})).toBe(true);
    expect(shouldPrewarmWorkspaceApps(["--no-prewarm"], {})).toBe(false);
    expect(shouldPrewarmWorkspaceApps([], { WORKSPACE_NO_PREWARM: "1" })).toBe(
      false,
    );
    // Eager mode already starts every app — prewarm has nothing to do.
    expect(shouldPrewarmWorkspaceApps(["--eager"], {})).toBe(false);
    expect(shouldPrewarmWorkspaceApps([], { WORKSPACE_EAGER: "1" })).toBe(
      false,
    );
  });

  it("parses prewarm concurrency from arg or env, falling back to 2", () => {
    expect(workspacePrewarmConcurrency([], {})).toBe(2);
    expect(workspacePrewarmConcurrency(["--prewarm-concurrency=4"], {})).toBe(
      4,
    );
    expect(
      workspacePrewarmConcurrency([], { WORKSPACE_PREWARM_CONCURRENCY: "3" }),
    ).toBe(3);
    // Bogus values clamp back to the default.
    expect(
      workspacePrewarmConcurrency([], { WORKSPACE_PREWARM_CONCURRENCY: "0" }),
    ).toBe(2);
    expect(
      workspacePrewarmConcurrency([], {
        WORKSPACE_PREWARM_CONCURRENCY: "nope",
      }),
    ).toBe(2);
    // CLI flag wins over env.
    expect(
      workspacePrewarmConcurrency(["--prewarm-concurrency=5"], {
        WORKSPACE_PREWARM_CONCURRENCY: "9",
      }),
    ).toBe(5);
  });

  it("selects the boot app ids for lazy and eager startup", () => {
    const apps = [{ id: "dispatch" }, { id: "starter" }];
    expect(initialWorkspaceAppIds(apps, "dispatch", false)).toEqual([
      "dispatch",
    ]);
    expect(initialWorkspaceAppIds(apps, "starter", false, false)).toEqual([]);
    expect(initialWorkspaceAppIds(apps, "dispatch", true)).toEqual([
      "dispatch",
      "starter",
    ]);
  });

  it("treats file watcher limit errors as handled polling fallback", () => {
    expect(isWorkspaceWatcherLimitError({ code: "ENOSPC" })).toBe(true);
    expect(isWorkspaceWatcherLimitError({ code: "EMFILE" })).toBe(true);
    expect(isWorkspaceWatcherLimitError({ code: "EACCES" })).toBe(false);
  });

  it("enables polling watchers for managed remote dev unless explicitly disabled", () => {
    expect(shouldUsePollingFileWatcher({ BUILDER_PROJECT_ID: "1" })).toBe(true);
    expect(
      shouldUsePollingFileWatcher({
        BUILDER_PROJECT_ID: "1",
        AGENT_NATIVE_DEV_USE_POLLING: "false",
      }),
    ).toBe(false);
    expect(
      shouldUsePollingFileWatcher({
        CHOKIDAR_USEPOLLING: "1",
      }),
    ).toBe(true);
  });
});

function testEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WORKSPACE_HOST: "127.0.0.1",
    WORKSPACE_PORT: "0",
    WORKSPACE_APP_PORT_START: "19100",
    WORKSPACE_NO_OPEN: "1",
    WORKSPACE_PROXY_READY_TIMEOUT_MS: "50",
    // Existing assertions count "exec vite" spawns and expect just the
    // default-app entry; the background prewarm queue would race those
    // counters. Tests that exercise prewarm opt in explicitly by clearing
    // this in their own env override.
    WORKSPACE_NO_PREWARM: "1",
  };
}

function makeWorkspace(apps: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-workspace-dev-"));
  fs.mkdirSync(path.join(dir, "apps"), { recursive: true });
  for (const app of apps) makeApp(dir, app);
  return dir;
}

function makeApp(
  workspaceRoot: string,
  app: string,
  opts: {
    audience?: "internal" | "public";
    installVite?: boolean;
    protectedPaths?: string[];
    publicPaths?: string[];
  } = {},
): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  fs.mkdirSync(appDir, { recursive: true });
  const pkg: Record<string, unknown> = {
    name: app,
    displayName: app.charAt(0).toUpperCase() + app.slice(1),
  };
  if (opts.audience || opts.protectedPaths || opts.publicPaths) {
    pkg["agent-native"] = {
      workspaceApp: {
        ...(opts.audience ? { audience: opts.audience } : {}),
        ...(opts.publicPaths ? { publicPaths: opts.publicPaths } : {}),
        ...(opts.protectedPaths ? { protectedPaths: opts.protectedPaths } : {}),
      },
    };
  }
  fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(pkg));
  if (opts.installVite !== false) createViteBin(appDir);
}

function createViteBin(appDir: string): void {
  const binDir = path.join(appDir, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "vite"), "");
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

function fakeSpawn(): {
  spawnProcess: typeof spawn;
  calls: () => Array<{
    command: string;
    args: string[];
    options?: { env?: NodeJS.ProcessEnv };
    child: ChildProcess & EventEmitter;
  }>;
  startedApps: () => string[];
} {
  const calls: Array<{
    command: string;
    args: string[];
    options?: { env?: NodeJS.ProcessEnv };
    child: ChildProcess & EventEmitter;
  }> = [];
  const spawnProcess = vi.fn(
    (
      command: string,
      args: string[],
      options?: { env?: NodeJS.ProcessEnv },
    ) => {
      const child = new EventEmitter() as ChildProcess;
      child.stdout = new EventEmitter() as ChildProcess["stdout"];
      child.stderr = new EventEmitter() as ChildProcess["stderr"];
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
        child.emit("exit", 0, null);
        return true;
      }) as ChildProcess["kill"];
      child.unref = vi.fn() as ChildProcess["unref"];
      calls.push({
        command,
        args,
        options,
        child: child as ChildProcess & EventEmitter,
      });
      return child;
    },
  ) as unknown as typeof spawn;

  return {
    spawnProcess,
    calls: () => calls,
    startedApps: () =>
      calls
        .filter(
          (call) =>
            call.command === "pnpm" &&
            call.args[0] === "--dir" &&
            call.args[2] === "exec",
        )
        .map((call) => path.basename(call.args[1])),
  };
}
