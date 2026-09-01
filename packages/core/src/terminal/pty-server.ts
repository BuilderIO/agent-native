/**
 * PTY WebSocket Server
 *
 * Creates an HTTP server with WebSocket support that spawns PTY processes
 * for AI CLI tools. Each WebSocket connection gets its own PTY.
 *
 * Used by both the embedded AgentTerminal component and the CLI frame.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
} from "http";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "os";
import path from "path";

import {
  CLI_REGISTRY,
  isAllowedCommand,
  resolveCommandPath,
  terminalPath,
} from "./cli-registry.js";

// Lazy singletons for Node-only modules (only available in Node.js)
let _cp: typeof import("child_process") | undefined;
async function getChildProcess(): Promise<typeof import("child_process")> {
  if (!_cp) {
    _cp = await import("node:child_process");
  }
  return _cp;
}

export function resolvePtySpawnHelper(ptyPackagePath: string): string {
  const helper = path.join(
    path.dirname(ptyPackagePath),
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  return helper
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked");
}

export function ensurePtySpawnHelperExecutable(helper: string): void {
  if (!fs.existsSync(helper)) return;
  if (!(fs.statSync(helper).mode & 0o100)) {
    fs.chmodSync(helper, 0o755);
    console.log(
      `[terminal] Fixed non-executable node-pty spawn-helper at ${helper}`,
    );
  }
}

export function ensurePtySpawnHelperPermissions(): void {
  if (os.platform() === "win32") return;
  try {
    const req = createRequire(import.meta.url);
    const ptyPkg = req.resolve("node-pty/package.json");
    const helper = resolvePtySpawnHelper(ptyPkg);
    ensurePtySpawnHelperExecutable(helper);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") return;
    console.warn(
      "[terminal] Could not verify node-pty spawn-helper permissions:",
      (err as Error).message,
    );
  }
}

/**
 * Kill a process and all its descendants.
 * node-pty's kill() only sends a signal to the shell, but child processes
 * (like `builder`) may be in their own process group and survive as orphans.
 */
async function killProcessTree(
  pid: number,
  _logPrefix: string,
  killParent?: () => void,
  isParentExited: () => boolean = () => false,
): Promise<void> {
  const cp = await getChildProcess();

  if (os.platform() === "win32") {
    if (isParentExited()) {
      killParent?.();
      return;
    }
    try {
      cp.execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } catch {}
    return;
  }

  // Find all descendant PIDs (children, grandchildren, etc.)
  const descendants: number[] = [];
  function findDescendants(parentPid: number) {
    try {
      const output = cp
        .execSync(`pgrep -P ${parentPid}`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
        })
        .trim();
      if (output) {
        for (const line of output.split("\n")) {
          const childPid = parseInt(line, 10);
          if (childPid && !isNaN(childPid)) {
            descendants.push(childPid);
            findDescendants(childPid);
          }
        }
      }
    } catch {
      // pgrep returns non-zero when no children found
    }
  }
  findDescendants(pid);

  // Kill descendants first (deepest first), then the parent
  for (const childPid of descendants.reverse()) {
    try {
      process.kill(childPid, "SIGTERM");
    } catch {}
  }

  try {
    if (killParent) killParent();
    else process.kill(pid, "SIGTERM");
  } catch {
    // coercion-ok: the process may exit between enumeration and termination.
  }

  // Force-kill any survivors after a short delay
  setTimeout(() => {
    for (const childPid of descendants) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    if (!isParentExited()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // coercion-ok: the process may exit before the delayed cleanup signal.
      }
    }
  }, 500);
}

export interface PtyServerOptions {
  /** Working directory for PTY processes. Defaults to process.cwd() */
  appDir?: string;
  /** Default CLI command. Defaults to 'claude' */
  command?: string;
  /** Port to listen on. Defaults to 0 (random available port) */
  port?: number;
  /** Auth check for WebSocket upgrade requests. Return false to reject. */
  authCheck?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /** Trusted host arguments appended to each validated CLI command. */
  getCommandArgs?: (command: string) => string[] | Promise<string[]>;
  /** Trusted environment additions for the validated CLI command. */
  getEnvironment?: (
    command: string,
  ) => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
  /** Per-connection setup for trusted host capabilities and cleanup. */
  getSessionSetup?: (
    command: string,
    context: PtySessionContext | null,
  ) => PtySessionSetup | Promise<PtySessionSetup>;
  /** Log prefix for console output. Defaults to '[terminal]' */
  logPrefix?: string;
}

export interface PtySessionContext {
  appId: string;
  path?: string;
  view?: string;
}

export interface PtySessionSetup {
  /** Trusted arguments appended to the selected CLI command. */
  commandArgs?: string[];
  /** Trusted environment additions for the selected CLI command. */
  environment?: NodeJS.ProcessEnv;
  /** Releases per-connection resources such as scoped MCP relays. */
  onClose?: () => void | Promise<void>;
}

export interface PtyServerResult {
  /** The underlying HTTP server */
  server: HttpServer;
  /** The actual port the server is listening on */
  port: number;
  /** Shut down the server and kill all PTY processes */
  close: () => void;
}

export async function createPtyWebSocketServer(
  options: PtyServerOptions = {},
): Promise<PtyServerResult> {
  const {
    appDir = process.cwd(),
    command: defaultCommand = "claude",
    port = 0,
    authCheck,
    getCommandArgs,
    getEnvironment,
    getSessionSetup,
    logPrefix = "[terminal]",
  } = options;

  ensurePtySpawnHelperPermissions();

  // Dynamic imports for optional native dependencies
  const { WebSocketServer, WebSocket } = await import("ws");
  const pty = await import("node-pty");

  const resolvedAppDir = path.resolve(appDir);

  const server = createHttpServer((req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });
  let closed = false;

  // Handle WebSocket upgrades with optional auth
  server.on("upgrade", async (req, socket, head) => {
    if (closed) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    if (authCheck) {
      try {
        const allowed = await authCheck(req);
        if (closed || socket.destroyed) {
          socket.destroy();
          return;
        }
        if (!allowed) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch {
        if (closed || socket.destroyed) {
          socket.destroy();
          return;
        }
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    if (closed) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (closed) {
        ws.close();
        return;
      }
      wss.emit("connection", ws, req);
    });
  });

  // Track idempotent disposers so server shutdown covers every live socket.
  const activeDisposers = new Set<() => void>();

  wss.on("connection", async (ws: InstanceType<typeof WebSocket>, req) => {
    if (closed) {
      ws.close();
      return;
    }

    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const command = url.searchParams.get("command") || defaultCommand;
    const extraFlags = url.searchParams.get("flags") || "";
    const context = readPtySessionContext(url);
    console.log(`${logPrefix} WebSocket connected for command: ${command}`);

    const sendStatus = (status: string, message: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "setup-status", status, message }));
      }
    };

    // Validate command against allowlist to prevent injection
    if (!isAllowedCommand(command)) {
      sendStatus(
        "not-found",
        `"${command}" is not a recognized CLI. Allowed: ${Object.keys(CLI_REGISTRY).join(", ")}`,
      );
      if (ws.readyState === WebSocket.OPEN) ws.close();
      return;
    }

    // Reject flags containing shell metacharacters
    if (extraFlags && /[;&|`$(){}\n\r<>]/.test(extraFlags)) {
      sendStatus("failed", "Invalid flags: shell metacharacters not allowed");
      if (ws.readyState === WebSocket.OPEN) ws.close();
      return;
    }

    let connectionClosed = false;
    const markConnectionClosed = () => {
      connectionClosed = true;
    };
    ws.once("close", markConnectionClosed);
    let sessionSetup: PtySessionSetup | undefined;
    let sessionSetupClosed = false;
    const closeSessionSetup = () => {
      if (!sessionSetup || sessionSetupClosed) return;
      sessionSetupClosed = true;
      void Promise.resolve(sessionSetup.onClose?.()).catch((error) => {
        console.warn(`${logPrefix} Session cleanup failed:`, error);
      });
    };

    let commandArgs: string[] = [];
    let commandEnvironment: NodeJS.ProcessEnv = {};
    try {
      if (getSessionSetup) {
        sessionSetup = await getSessionSetup(command, context);
        commandArgs = sessionSetup.commandArgs ?? [];
        commandEnvironment = sessionSetup.environment ?? {};
      }
      if (getCommandArgs) {
        const additionalArgs = await getCommandArgs(command);
        commandArgs = [...commandArgs, ...additionalArgs];
      }
      if (getEnvironment) {
        commandEnvironment = {
          ...commandEnvironment,
          ...(await getEnvironment(command)),
        };
      }
    } catch (error) {
      closeSessionSetup();
      if (closed) {
        ws.close();
        return;
      }
      sendStatus(
        "failed",
        error instanceof Error
          ? error.message
          : "The terminal command could not be configured.",
      );
      if (ws.readyState === WebSocket.OPEN) ws.close();
      return;
    }

    if (connectionClosed || ws.readyState !== WebSocket.OPEN || closed) {
      closeSessionSetup();
      ws.close();
      return;
    }

    let extraArgumentList: string[] = [];
    try {
      extraArgumentList = parseTerminalArguments(extraFlags);
    } catch (error) {
      closeSessionSetup();
      sendStatus(
        "failed",
        error instanceof Error ? error.message : "Invalid terminal flags.",
      );
      if (ws.readyState === WebSocket.OPEN) ws.close();
      return;
    }

    if (connectionClosed || ws.readyState !== WebSocket.OPEN || closed) {
      closeSessionSetup();
      ws.close();
      return;
    }

    // Build env, stripping CLI-specific nesting vars
    const registry = CLI_REGISTRY[command];
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...commandEnvironment,
      TERM: "xterm-256color",
    };
    if (registry) {
      for (const v of registry.stripEnv) delete env[v];
    }

    env.PATH = await terminalPath(env);
    const commandPath = await resolveCommandPath(command, env);
    if (connectionClosed || ws.readyState !== WebSocket.OPEN || closed) {
      closeSessionSetup();
      ws.close();
      return;
    }
    let spawnCommand = commandPath;
    let spawnArgs = [...commandArgs, ...extraArgumentList];
    if (!spawnCommand) {
      if (!registry?.installPackage) {
        closeSessionSetup();
        sendStatus(
          "not-found",
          `"${command}" not found on PATH. Please install it manually.`,
        );
        if (ws.readyState === WebSocket.OPEN) ws.close();
        return;
      }
      const npxPath = await resolveCommandPath("npx", env);
      if (!npxPath) {
        closeSessionSetup();
        sendStatus(
          "not-found",
          `"${command}" not found on PATH and npx is unavailable.`,
        );
        if (ws.readyState === WebSocket.OPEN) ws.close();
        return;
      }
      console.log(`${logPrefix} ${command} CLI not found, will use npx`);
      spawnCommand = npxPath;
      spawnArgs = ["--yes", registry.installPackage, ...spawnArgs];
    }
    console.log(`${logPrefix} Spawning PTY for ${command}`);

    const preparedSpawn = preparePtySpawn(spawnCommand, spawnArgs);
    let ptyProcess: ReturnType<typeof pty.spawn>;
    try {
      ptyProcess = pty.spawn(preparedSpawn.command, preparedSpawn.args, {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: resolvedAppDir,
        env: env as Record<string, string>,
      });
    } catch (err) {
      console.error(`${logPrefix} Failed to spawn PTY:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        sendStatus(
          "failed",
          `Failed to spawn PTY: ${err instanceof Error ? err.message : String(err)}`,
        );
        ws.close();
      }
      closeSessionSetup();
      return;
    }

    let disposed = false;
    let parentExited = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      activeDisposers.delete(dispose);
      closeSessionSetup();
      const killPty = () => {
        try {
          ptyProcess.kill();
        } catch (err) {
          console.warn(`${logPrefix} PTY cleanup failed:`, err);
        }
      };
      void killProcessTree(
        ptyProcess.pid,
        logPrefix,
        killPty,
        () => parentExited,
      ).catch((err) => {
        console.warn(`${logPrefix} PTY tree cleanup failed:`, err);
        killPty();
      });
    };
    activeDisposers.add(dispose);
    console.log(`${logPrefix} PTY spawned (pid: ${ptyProcess.pid})`);

    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`${logPrefix} PTY exited with code ${exitCode}`);
      parentExited = true;
      dispose();
      if (exitCode === 127 && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "setup-status",
            status: "not-found",
            message: `Command "${command}" not found. Please install it first.`,
          }),
        );
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    ws.on("message", async (data: Buffer | string) => {
      const str = typeof data === "string" ? data : data.toString();

      try {
        const msg = JSON.parse(str);

        if (
          msg.type === "agentNative.setEnvVars" &&
          Array.isArray(msg.data?.vars)
        ) {
          const vars: Array<{ key: string; value: string }> = msg.data.vars;

          // Legacy bridge message. Keep validating the keys, but do not persist
          // them to .env or process.env; key storage is DB-scoped.
          const validKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
          const sanitizedVars = vars.filter(({ key }) => {
            if (!validKeyPattern.test(key)) {
              console.warn(`${logPrefix} Rejected invalid env var key: ${key}`);
              return false;
            }
            return true;
          });

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "env-vars-saved",
                keys: sanitizedVars.map((v) => v.key),
                storage: "scoped-secrets",
              }),
            );
          }
          return;
        }

        if (msg.type === "resize" && msg.cols != null && msg.rows != null) {
          const cols = Math.max(
            1,
            Math.min(65535, Math.trunc(Number(msg.cols))),
          );
          const rows = Math.max(
            1,
            Math.min(65535, Math.trunc(Number(msg.rows))),
          );
          if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
          ptyProcess.resize(cols, rows);
          return;
        }
      } catch {
        // Not JSON — regular terminal input
      }

      ptyProcess.write(str);
    });

    ws.on("close", () => {
      console.log(
        `${logPrefix} WebSocket closed, killing PTY tree (pid: ${ptyProcess.pid})`,
      );
      dispose();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      if (process.env.DEBUG)
        console.log(
          `${logPrefix} PTY WebSocket server on ws://localhost:${actualPort}/ws`,
        );

      resolve({
        server,
        port: actualPort,
        close: () => {
          if (closed) return;
          closed = true;
          for (const dispose of [...activeDisposers]) dispose();
          wss.close();
          server.close();
        },
      });
    });
  });
}

function readPtySessionContext(url: URL): PtySessionContext | null {
  const appId = url.searchParams.get("appId")?.trim();
  if (!appId) return null;
  const pathValue = url.searchParams.get("path")?.trim();
  const view = url.searchParams.get("view")?.trim();
  return {
    appId,
    ...(pathValue ? { path: pathValue } : {}),
    ...(view ? { view } : {}),
  };
}

export function preparePtySpawn(
  commandPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform !== "win32") return { command: commandPath, args };
  const extension = path.extname(commandPath).toLowerCase();
  if (extension !== ".cmd" && extension !== ".bat") {
    return { command: commandPath, args };
  }
  return {
    command: process.env.ComSpec || process.env.COMSPEC || "cmd.exe",
    args: ["/d", "/s", "/c", commandPath, ...args],
  };
}

export function parseTerminalArguments(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!value) return [];
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  const preserveBackslashes = platform === "win32";

  const pushCurrent = () => {
    if (current) args.push(current);
    current = "";
  };

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'" && !preserveBackslashes) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      pushCurrent();
    } else {
      current += character;
    }
  }

  if (escaped || quote) {
    throw new Error("Invalid flags: unterminated terminal argument");
  }
  pushCurrent();
  return args;
}
