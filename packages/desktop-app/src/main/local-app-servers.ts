import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import type { DesktopAppRuntimeStatus } from "@shared/ipc-channels";

export type LocalAppServerDemandSource = "active-app" | "chat-first-preview";

export interface LocalAppServerConfig {
  id: string;
  name: string;
  localPath: string;
  devUrl: string;
  devCommand: string;
}

export interface LocalAppServerChild {
  pid?: number | undefined;
  exitCode: number | null;
  killed: boolean;
  stdout?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  stderr?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface LocalAppServerDeps {
  getApp(appId: string): LocalAppServerConfig | null;
  isManaged(appId: string): boolean;
  spawn(
    command: string,
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ): LocalAppServerChild;
  isReachable(url: string): Promise<boolean>;
  emitStatus(status: DesktopAppRuntimeStatus): void;
  baseEnv(): NodeJS.ProcessEnv;
  isQuitting(): boolean;
  logDir(): string | null;
  killProcessGroup?(pid: number, signal: NodeJS.Signals): void;
  fileExists?(filePath: string): boolean;
  sleep?(ms: number): Promise<void>;
  setTimer?(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer?(timer: ReturnType<typeof setTimeout>): void;
  console?: Pick<Console, "log" | "error">;
}

export const LOCAL_APP_MAX_START_ATTEMPTS = 20;
const READY_POLL_ATTEMPTS = 120;
const READY_POLL_MS = 750;
const WAIT_RETRY_MS = 2_000;
const CRASH_RETRY_MS = 3_000;
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const RESTART_EXIT_WAIT_MS = 5_000;

export function localAppServerEnv(
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    BROWSER: "none",
    AUTH_DISABLED: "true",
    NODE_ENV: "development",
  };
}

export function isLocalAppServerReadyStatus(status: number): boolean {
  return status > 0 && status !== 502 && status !== 503 && status !== 504;
}

export function localAppNotReadyReason(
  localPath: string,
  fileExists: (filePath: string) => boolean = fs.existsSync,
): string | null {
  if (!fileExists(path.join(localPath, "package.json"))) {
    return "The coding agent is creating this app.";
  }
  const bin = path.join(localPath, "node_modules", ".bin");
  if (
    !fileExists(path.join(bin, "agent-native")) &&
    !fileExists(path.join(bin, "agent-native.cmd"))
  ) {
    return "Installing the app's dependencies.";
  }
  return null;
}

export function isLocalAppBuildErrorOutput(text: string): boolean {
  if (/failed to resolve dependency/i.test(text)) return false;
  return /(\bSyntaxError\b|\bTypeError\b|\bReferenceError\b|\bERR_[A-Z_]+|\[vite\].*\berror\b|Internal server error|Pre-transform error|Transform failed|Build failed|Cannot find (module|package)|EADDRINUSE)/i.test(
    text,
  );
}

export function localAppLogFileName(appId: string): string {
  return `${appId.replace(/[^A-Za-z0-9._-]+/g, "_") || "app"}.log`;
}

export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findFreeLocalAppPort(
  claimed: Iterable<number>,
  options: {
    start?: number;
    end?: number;
    isFree?: (port: number) => Promise<boolean>;
  } = {},
): Promise<number> {
  const start = options.start ?? 5180;
  const end = options.end ?? 5999;
  const isFree = options.isFree ?? ((port: number) => isPortFree(port));
  const used = new Set(claimed);
  for (let port = start; port <= end; port += 1) {
    if (used.has(port)) continue;
    if (await isFree(port)) return port;
  }
  throw new Error(`No free local port between ${start} and ${end}.`);
}

export class LocalAppServerManager {
  private readonly processes = new Map<string, LocalAppServerChild>();
  private readonly retryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly starts = new Set<string>();
  private readonly startAttempts = new Map<string, number>();
  private readonly demand = new Map<string, Set<LocalAppServerDemandSource>>();
  private readonly lastStatus = new Map<string, string>();
  private readonly stoppedChildren = new WeakSet<LocalAppServerChild>();

  constructor(private readonly deps: LocalAppServerDeps) {}

  private get fileExists(): (filePath: string) => boolean {
    return this.deps.fileExists ?? fs.existsSync;
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep
      ? this.deps.sleep(ms)
      : new Promise((resolve) => setTimeout(resolve, ms));
  }

  reportStatus(status: DesktopAppRuntimeStatus): void {
    this.emit(status);
  }

  private emit(status: DesktopAppRuntimeStatus): void {
    const signature = `${status.state}\0${status.message ?? ""}`;
    if (this.lastStatus.get(status.appId) === signature) return;
    this.lastStatus.set(status.appId, signature);
    this.deps.emitStatus(status);
  }

  resetStatusCache(): void {
    this.lastStatus.clear();
  }

  restartForChanges(appId: string): void {
    const child = this.processes.get(appId);
    if (!child?.pid || !this.hasDemand(appId)) return;
    this.startAttempts.delete(appId);
    this.emit({
      appId,
      state: "starting",
      message: "Applying the latest changes.",
    });
    let started = false;
    const startAgain = () => {
      if (started) return;
      started = true;
      this.scheduleStart(appId, 0);
    };
    child.once("exit", startAgain);
    (this.deps.setTimer ?? setTimeout)(startAgain, RESTART_EXIT_WAIT_MS);
    this.stopProcess(appId);
  }

  hasDemand(appId: string): boolean {
    return (this.demand.get(appId)?.size ?? 0) > 0;
  }

  runningAppIds(): string[] {
    return [...this.processes.keys()];
  }

  isRunning(appId: string): boolean {
    return Boolean(this.processes.get(appId)?.pid);
  }

  logPath(appId: string): string | null {
    const dir = this.deps.logDir();
    return dir ? path.join(dir, localAppLogFileName(appId)) : null;
  }

  setDemand(
    appId: string,
    source: LocalAppServerDemandSource,
    demanded: boolean,
  ): void {
    if (!appId) return;
    const sources = this.demand.get(appId) ?? new Set();
    if (demanded) {
      if (!this.deps.isManaged(appId)) return;
      sources.add(source);
      this.demand.set(appId, sources);
      if (!this.isRunning(appId)) this.scheduleStart(appId, 0);
      return;
    }

    sources.delete(source);
    if (sources.size > 0) {
      this.demand.set(appId, sources);
      return;
    }
    this.demand.delete(appId);
    this.clearRetry(appId);
    this.startAttempts.delete(appId);
    this.stopProcess(appId);
  }

  stop(appId: string): void {
    this.demand.delete(appId);
    this.clearRetry(appId);
    this.startAttempts.delete(appId);
    this.stopProcess(appId);
  }

  stopAll(): void {
    for (const appId of new Set([
      ...this.processes.keys(),
      ...this.demand.keys(),
      ...this.retryTimers.keys(),
    ])) {
      this.stop(appId);
    }
  }

  private clearRetry(appId: string): void {
    const timer = this.retryTimers.get(appId);
    if (timer) (this.deps.clearTimer ?? clearTimeout)(timer);
    this.retryTimers.delete(appId);
  }

  scheduleStart(appId: string, delay = WAIT_RETRY_MS): void {
    if (this.deps.isQuitting() || !this.hasDemand(appId)) return;
    this.clearRetry(appId);
    const setTimer = this.deps.setTimer ?? setTimeout;
    this.retryTimers.set(
      appId,
      setTimer(() => {
        this.retryTimers.delete(appId);
        void this.ensureRunning(appId);
      }, delay),
    );
  }

  private stopProcess(appId: string): void {
    const child = this.processes.get(appId);
    if (!child) return;
    this.processes.delete(appId);
    this.stoppedChildren.add(child);
    if (process.platform !== "win32" && child.pid) {
      try {
        (
          this.deps.killProcessGroup ??
          ((pid, signal) => process.kill(-pid, signal))
        )(child.pid, "SIGTERM");
        return;
      } catch {
        // coercion-ok: the group may already be gone; fall back to the child.
      }
    }
    child.kill("SIGTERM");
  }

  private appendLog(appId: string, text: string): void {
    const logPath = this.logPath(appId);
    if (!logPath) return;
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      try {
        if (fs.statSync(logPath).size > LOG_MAX_BYTES) {
          fs.renameSync(logPath, `${logPath}.1`);
        }
      } catch {
        // coercion-ok: no log yet.
      }
      fs.appendFileSync(logPath, text.endsWith("\n") ? text : `${text}\n`);
    } catch {
      // coercion-ok: logging must never stop the preview.
    }
  }

  async ensureRunning(appId: string): Promise<void> {
    if (
      this.deps.isQuitting() ||
      !this.hasDemand(appId) ||
      !this.deps.isManaged(appId) ||
      this.starts.has(appId)
    ) {
      return;
    }
    const appConfig = this.deps.getApp(appId);
    if (!appConfig) return;
    if (this.isRunning(appId)) return;

    this.starts.add(appId);
    try {
      if (await this.deps.isReachable(appConfig.devUrl)) {
        this.emit({ appId, state: "running", message: "Preview ready." });
        return;
      }

      const notReady = localAppNotReadyReason(
        appConfig.localPath,
        this.fileExists,
      );
      if (notReady) {
        this.emit({ appId, state: "waiting", message: notReady });
        this.scheduleStart(appId);
        return;
      }

      if (!this.hasDemand(appId)) return;
      this.emit({
        appId,
        state: "starting",
        message: `Starting ${appConfig.name}.`,
      });
      const attempts = (this.startAttempts.get(appId) ?? 0) + 1;
      this.startAttempts.set(appId, attempts);
      this.appendLog(
        appId,
        `\n[desktop] ${new Date().toISOString()} start #${attempts}: ${appConfig.devCommand}`,
      );
      const child = this.deps.spawn(appConfig.devCommand, {
        cwd: appConfig.localPath,
        env: localAppServerEnv(this.deps.baseEnv()),
      });
      this.processes.set(appId, child);
      let ready = false;
      const out = this.deps.console ?? console;
      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString();
        this.appendLog(appId, text);
        if (!text.trim()) return;
        out.log(`[desktop-app:${appId}] ${text.trim()}`);
        if (!ready) {
          this.emit({
            appId,
            state: "starting",
            message: "Building the local preview.",
          });
        }
      });
      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        this.appendLog(appId, text);
        if (!text.trim()) return;
        out.error(`[desktop-app:${appId}] ${text.trim()}`);
        if (!ready && isLocalAppBuildErrorOutput(text)) {
          this.emit({
            appId,
            state: "error",
            message: "The local preview reported a build error.",
          });
        }
      });
      child.once("error", (error) => {
        this.appendLog(appId, `[desktop] spawn error: ${error.message}`);
        if (this.processes.get(appId) === child) this.processes.delete(appId);
        this.emit({
          appId,
          state: "error",
          message: "The local preview could not start.",
        });
      });
      child.once("exit", (code) => {
        this.appendLog(appId, `[desktop] dev server exited (${code})`);
        if (this.processes.get(appId) === child) this.processes.delete(appId);
        if (this.stoppedChildren.has(child)) return;
        if (this.deps.isQuitting() || !this.hasDemand(appId)) return;
        this.emit({
          appId,
          state: code === 0 ? "stopped" : "error",
          message:
            code === 0
              ? `${appConfig.name} stopped.`
              : "The local preview process exited unexpectedly.",
        });
        if (
          (this.startAttempts.get(appId) ?? 0) < LOCAL_APP_MAX_START_ATTEMPTS
        ) {
          this.scheduleStart(appId, CRASH_RETRY_MS);
        }
      });

      for (let attempt = 0; attempt < READY_POLL_ATTEMPTS; attempt += 1) {
        if (!this.hasDemand(appId)) {
          this.stopProcess(appId);
          return;
        }
        if (await this.deps.isReachable(appConfig.devUrl)) {
          ready = true;
          this.startAttempts.delete(appId);
          this.emit({ appId, state: "running", message: "Preview ready." });
          return;
        }
        if (child.exitCode !== null || child.killed) return;
        if (this.processes.get(appId) !== child) return;
        await this.sleep(READY_POLL_MS);
      }
      this.emit({
        appId,
        state: "error",
        message: "The local preview did not become ready.",
      });
    } catch (error) {
      this.appendLog(
        appId,
        `[desktop] start failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.emit({
        appId,
        state: "error",
        message: "The local preview could not start.",
      });
    } finally {
      this.starts.delete(appId);
    }
  }
}
