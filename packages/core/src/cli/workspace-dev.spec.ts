import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialWorkspaceAppIds,
  runWorkspaceDev,
  shouldEagerStartWorkspaceApps,
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
    handle = runWorkspaceDev({
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
    handle = runWorkspaceDev({
      root: tmpDir,
      args: ["--eager"],
      env: testEnv(),
      spawnProcess: fake.spawnProcess,
      openBrowser: false,
    });
    await handle.ready;

    expect(fake.startedApps()).toEqual(["dispatch", "starter", "todo"]);
  });

  it("uses the root list as fallback when Dispatch is absent", async () => {
    tmpDir = makeWorkspace(["starter"]);
    const fake = fakeSpawn();
    handle = runWorkspaceDev({
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
    handle = runWorkspaceDev({
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
    handle = runWorkspaceDev({
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
    handle = runWorkspaceDev({
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

  it("runs a workspace install before starting a newly generated app without installed bins", async () => {
    tmpDir = makeWorkspace(["dispatch"]);
    const fake = fakeSpawn();
    handle = runWorkspaceDev({
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
    expect(await res.text()).toContain("installing this app's dependencies");

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
});

describe("workspace dev helpers", () => {
  it("parses eager mode from args or env", () => {
    expect(shouldEagerStartWorkspaceApps(["--eager"], {})).toBe(true);
    expect(shouldEagerStartWorkspaceApps([], { WORKSPACE_EAGER: "1" })).toBe(
      true,
    );
    expect(shouldEagerStartWorkspaceApps([], {})).toBe(false);
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
});

function testEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WORKSPACE_HOST: "127.0.0.1",
    WORKSPACE_PORT: "0",
    WORKSPACE_APP_PORT_START: "19100",
    WORKSPACE_NO_OPEN: "1",
    WORKSPACE_PROXY_READY_TIMEOUT_MS: "50",
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
  opts: { installVite?: boolean } = {},
): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({
      name: app,
      displayName: app.charAt(0).toUpperCase() + app.slice(1),
    }),
  );
  if (opts.installVite !== false) createViteBin(appDir);
}

function createViteBin(appDir: string): void {
  const binDir = path.join(appDir, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "vite"), "");
}

function fakeSpawn(): {
  spawnProcess: typeof spawn;
  calls: () => Array<{
    command: string;
    args: string[];
    child: ChildProcess & EventEmitter;
  }>;
  startedApps: () => string[];
} {
  const calls: Array<{
    command: string;
    args: string[];
    child: ChildProcess & EventEmitter;
  }> = [];
  const spawnProcess = vi.fn((command: string, args: string[]) => {
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
    calls.push({ command, args, child: child as ChildProcess & EventEmitter });
    return child;
  }) as unknown as typeof spawn;

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
