import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DesktopAppRuntimeStatus } from "@shared/ipc-channels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findFreeLocalAppPort,
  isLocalAppBuildErrorOutput,
  isLocalAppServerReadyStatus,
  LOCAL_APP_MAX_START_ATTEMPTS,
  localAppNotReadyReason,
  localAppServerEnv,
  LocalAppServerManager,
  type LocalAppServerChild,
  type LocalAppServerConfig,
} from "./local-app-servers";

class FakeChild extends EventEmitter implements LocalAppServerChild {
  static nextPid = 4_000;
  pid = FakeChild.nextPid++;
  exitCode: number | null = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  signals: string[] = [];

  override once(event: string, listener: (...args: never[]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    this.killed = true;
    return true;
  }

  exit(code: number): void {
    this.exitCode = code;
    this.emit("exit", code);
  }
}

interface Harness {
  manager: LocalAppServerManager;
  statuses: DesktopAppRuntimeStatus[];
  spawned: Array<{
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    child: FakeChild;
  }>;
  reachable: Set<string>;
  answersAfterSpawns: { value: number };
  files: Set<string>;
  timers: Array<{ callback: () => void; ms: number; cleared: boolean }>;
  killedGroups: number[];
  apps: Map<string, LocalAppServerConfig>;
  quitting: { value: boolean };
  logDir: string;
}

function weatherApp(root: string): LocalAppServerConfig {
  return {
    id: "local-weather",
    name: "Weather",
    localPath: path.join(root, "weather"),
    devUrl: "http://localhost:5181",
    devCommand: "pnpm exec agent-native dev --port 5181 --host 127.0.0.1",
  };
}

function installedFiles(app: LocalAppServerConfig): string[] {
  return [
    path.join(app.localPath, "package.json"),
    path.join(app.localPath, "node_modules", ".bin", "agent-native"),
  ];
}

function createHarness(logDir: string): Harness {
  const statuses: DesktopAppRuntimeStatus[] = [];
  const spawned: Harness["spawned"] = [];
  const reachable = new Set<string>();
  const answersAfterSpawns = { value: Number.POSITIVE_INFINITY };
  const files = new Set<string>();
  const timers: Harness["timers"] = [];
  const killedGroups: number[] = [];
  const apps = new Map<string, LocalAppServerConfig>();
  const quitting = { value: false };
  const manager = new LocalAppServerManager({
    getApp: (appId) => apps.get(appId) ?? null,
    isManaged: (appId) => apps.has(appId),
    spawn: (command, options) => {
      const child = new FakeChild();
      spawned.push({ command, cwd: options.cwd, env: options.env, child });
      return child;
    },
    isReachable: async (url) =>
      reachable.has(url) ||
      (spawned.length >= answersAfterSpawns.value &&
        spawned.at(-1)?.child.exitCode === null),
    emitStatus: (status) => statuses.push(status),
    baseEnv: () => ({ PATH: "/usr/bin", HOME: "/home/me" }),
    isQuitting: () => quitting.value,
    logDir: () => logDir,
    killProcessGroup: (pid) => {
      killedGroups.push(pid);
    },
    fileExists: (filePath) => files.has(filePath),
    sleep: async () => undefined,
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (timer) => {
      (timer as unknown as { cleared: boolean }).cleared = true;
    },
    console: { log: () => undefined, error: () => undefined },
  });
  return {
    manager,
    statuses,
    spawned,
    reachable,
    answersAfterSpawns,
    files,
    timers,
    killedGroups,
    apps,
    quitting,
    logDir,
  };
}

function firstChild(harness: Harness): FakeChild {
  const first = harness.spawned.at(0);
  if (!first) throw new Error("No dev server was started.");
  return first.child;
}

async function runPendingTimers(harness: Harness): Promise<void> {
  const pending = harness.timers.filter((timer) => !timer.cleared);
  harness.timers.length = 0;
  for (const timer of pending) {
    timer.cleared = true;
    timer.callback();
  }
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

describe("LocalAppServerManager", () => {
  let root: string;
  let harness: Harness;
  let app: LocalAppServerConfig;

  beforeEach(() => {
    root = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-local-servers-"),
    );
    harness = createHarness(path.join(root, "logs"));
    app = weatherApp(root);
    harness.apps.set(app.id, app);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("starts the dev server on demand with the Desktop-owned environment", async () => {
    for (const file of installedFiles(app)) harness.files.add(file);
    harness.manager.setDemand(app.id, "active-app", true);
    expect(harness.timers).toHaveLength(1);
    expect(harness.timers[0]?.ms).toBe(0);

    harness.answersAfterSpawns.value = 1;
    await runPendingTimers(harness);
    expect(harness.spawned).toHaveLength(1);
    await vi.waitFor(() =>
      expect(harness.statuses.at(-1)).toEqual({
        appId: app.id,
        state: "running",
        message: "Preview ready.",
      }),
    );

    const started = harness.spawned.at(0);
    expect(started?.command).toBe(app.devCommand);
    expect(started?.cwd).toBe(app.localPath);
    expect(started?.env).toMatchObject({
      PATH: "/usr/bin",
      AUTH_DISABLED: "true",
      BROWSER: "none",
    });
    expect(harness.manager.isRunning(app.id)).toBe(true);
  });

  it("reuses a server that already answers instead of starting another", async () => {
    for (const file of installedFiles(app)) harness.files.add(file);
    harness.reachable.add(app.devUrl);
    harness.manager.setDemand(app.id, "chat-first-preview", true);
    await runPendingTimers(harness);

    expect(harness.spawned).toHaveLength(0);
    expect(harness.statuses.at(-1)?.state).toBe("running");
  });

  it("waits for the agent to scaffold and install before starting, without spending start attempts", async () => {
    harness.manager.setDemand(app.id, "chat-first-preview", true);
    await runPendingTimers(harness);
    expect(harness.statuses.at(-1)).toEqual({
      appId: app.id,
      state: "waiting",
      message: "The coding agent is creating this app.",
    });

    harness.files.add(path.join(app.localPath, "package.json"));
    for (let i = 0; i < LOCAL_APP_MAX_START_ATTEMPTS + 5; i += 1) {
      await runPendingTimers(harness);
    }
    expect(harness.statuses.at(-1)?.message).toBe(
      "Installing the app's dependencies.",
    );
    expect(harness.spawned).toHaveLength(0);

    harness.files.add(
      path.join(app.localPath, "node_modules", ".bin", "agent-native"),
    );
    harness.reachable.add(app.devUrl);
    await runPendingTimers(harness);
    expect(harness.statuses.at(-1)?.state).toBe("running");
  });

  it("stops the server when the last demand goes away", async () => {
    for (const file of installedFiles(app)) harness.files.add(file);
    harness.manager.setDemand(app.id, "active-app", true);
    harness.manager.setDemand(app.id, "chat-first-preview", true);
    harness.answersAfterSpawns.value = 1;
    await runPendingTimers(harness);
    const pid = firstChild(harness).pid;

    harness.manager.setDemand(app.id, "active-app", false);
    expect(harness.killedGroups).toEqual([]);
    harness.manager.setDemand(app.id, "chat-first-preview", false);
    expect(harness.killedGroups).toEqual([pid]);
    expect(harness.manager.isRunning(app.id)).toBe(false);
  });

  it("stops every server when Desktop quits and does not restart them", async () => {
    for (const file of installedFiles(app)) harness.files.add(file);
    harness.manager.setDemand(app.id, "active-app", true);
    harness.answersAfterSpawns.value = 1;
    await runPendingTimers(harness);
    const child = firstChild(harness);

    harness.quitting.value = true;
    harness.manager.stopAll();
    expect(harness.killedGroups).toEqual([child.pid]);
    child.exit(143);
    expect(harness.timers.filter((timer) => !timer.cleared)).toHaveLength(0);
    expect(harness.manager.runningAppIds()).toEqual([]);
  });

  it("reports a crashed server, restarts it, and keeps its output in a log", async () => {
    for (const file of installedFiles(app)) harness.files.add(file);
    harness.manager.setDemand(app.id, "active-app", true);
    const ready = runPendingTimers(harness);
    await vi.waitFor(() => expect(harness.spawned).toHaveLength(1));
    const child = firstChild(harness);
    child.stderr.emit(
      "data",
      Buffer.from("SyntaxError: Unexpected token in app/routes/_index.tsx"),
    );
    child.exit(1);
    await ready;

    expect(harness.statuses).toContainEqual({
      appId: app.id,
      state: "error",
      message: "The local preview reported a build error.",
    });
    expect(harness.statuses.at(-1)).toEqual({
      appId: app.id,
      state: "error",
      message: "The local preview process exited unexpectedly.",
    });
    expect(harness.timers.at(-1)?.ms).toBe(3_000);

    const log = fs.readFileSync(harness.manager.logPath(app.id) ?? "", "utf8");
    expect(log).toContain("SyntaxError: Unexpected token");
    expect(log).toContain("dev server exited (1)");

    harness.answersAfterSpawns.value = 2;
    await runPendingTimers(harness);
    expect(harness.spawned).toHaveLength(2);
    expect(harness.statuses.at(-1)?.state).toBe("running");
  });

  it("keeps a ready preview showing through the agent's mid-edit build errors", async () => {
    for (const file of installedFiles(app)) harness.files.add(file);
    harness.manager.setDemand(app.id, "chat-first-preview", true);
    harness.answersAfterSpawns.value = 1;
    await runPendingTimers(harness);
    expect(harness.statuses.at(-1)?.state).toBe("running");

    firstChild(harness).stderr.emit(
      "data",
      Buffer.from(
        "[vite] Internal server error: Transform failed with 1 error",
      ),
    );
    expect(harness.statuses.at(-1)?.state).toBe("running");
    expect(
      fs.readFileSync(harness.manager.logPath(app.id) ?? "", "utf8"),
    ).toContain("Transform failed");
  });

  it("restarts a running app after the agent changes it, so new migrations apply", async () => {
    for (const file of installedFiles(app)) harness.files.add(file);
    harness.manager.restartForChanges(app.id);
    expect(harness.statuses).toHaveLength(0);

    harness.manager.setDemand(app.id, "chat-first-preview", true);
    harness.answersAfterSpawns.value = 1;
    await runPendingTimers(harness);
    const first = firstChild(harness);

    harness.manager.restartForChanges(app.id);
    expect(harness.killedGroups).toEqual([first.pid]);
    expect(harness.statuses.at(-1)).toEqual({
      appId: app.id,
      state: "starting",
      message: "Applying the latest changes.",
    });
    first.exit(143);
    expect(harness.statuses.at(-1)?.state).toBe("starting");

    harness.answersAfterSpawns.value = 2;
    await runPendingTimers(harness);
    expect(harness.spawned).toHaveLength(2);
    expect(harness.statuses.at(-1)?.state).toBe("running");
  });

  it("ignores apps Desktop does not manage", async () => {
    harness.manager.setDemand("mail", "active-app", true);
    await runPendingTimers(harness);
    expect(harness.spawned).toHaveLength(0);
    expect(harness.manager.hasDemand("mail")).toBe(false);
  });
});

describe("local app server helpers", () => {
  it("waits out the dev gateway's startup errors before calling an app ready", () => {
    expect(isLocalAppServerReadyStatus(200)).toBe(true);
    expect(isLocalAppServerReadyStatus(302)).toBe(true);
    expect(isLocalAppServerReadyStatus(500)).toBe(true);
    expect(isLocalAppServerReadyStatus(502)).toBe(false);
    expect(isLocalAppServerReadyStatus(503)).toBe(false);
    expect(isLocalAppServerReadyStatus(504)).toBe(false);
    expect(isLocalAppServerReadyStatus(0)).toBe(false);
  });

  it("only bypasses sign-in for the Desktop-run server's own environment", () => {
    const base = { PATH: "/bin", AUTH_DISABLED: "false" };
    expect(localAppServerEnv(base)).toMatchObject({
      PATH: "/bin",
      AUTH_DISABLED: "true",
      AGENT_NATIVE_DEV_HOST: "127.0.0.1",
    });
    expect(base.AUTH_DISABLED).toBe("false");
  });

  it("explains what a folder still needs before it can run", () => {
    const files = new Set<string>();
    const exists = (filePath: string) => files.has(filePath);
    expect(localAppNotReadyReason("/apps/w", exists)).toBe(
      "The coding agent is creating this app.",
    );
    files.add(path.join("/apps/w", "package.json"));
    expect(localAppNotReadyReason("/apps/w", exists)).toBe(
      "Installing the app's dependencies.",
    );
    files.add(path.join("/apps/w", "node_modules", ".bin", "agent-native"));
    expect(localAppNotReadyReason("/apps/w", exists)).toBeNull();
  });

  it("separates build errors from routine dev server warnings", () => {
    expect(
      isLocalAppBuildErrorOutput(
        "Failed to resolve dependency: react-markdown, present in client 'optimizeDeps.include'",
      ),
    ).toBe(false);
    expect(isLocalAppBuildErrorOutput("[vite] warning: large chunk")).toBe(
      false,
    );
    expect(
      isLocalAppBuildErrorOutput(
        "[vite] Internal server error: Transform failed with 1 error",
      ),
    ).toBe(true);
    expect(
      isLocalAppBuildErrorOutput("Error: listen EADDRINUSE: 127.0.0.1:5181"),
    ).toBe(true);
  });

  it("picks a port no app claims and nothing is listening on", async () => {
    const busy = new Set([5181]);
    await expect(
      findFreeLocalAppPort([5180], {
        isFree: async (port) => !busy.has(port),
      }),
    ).resolves.toBe(5182);
    await expect(
      findFreeLocalAppPort([5180], {
        start: 5180,
        end: 5181,
        isFree: async (port) => !busy.has(port),
      }),
    ).rejects.toThrow("No free local port");
  });
});
