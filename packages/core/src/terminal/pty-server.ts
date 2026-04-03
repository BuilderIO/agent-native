/**
 * PTY WebSocket Server
 *
 * Creates an HTTP server with WebSocket support that spawns PTY processes
 * for AI CLI tools. Each WebSocket connection gets its own PTY.
 *
 * Used by both the embedded AgentTerminal component and the CLI harness.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
} from "http";
import { execSync } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";
import {
  CLI_REGISTRY,
  commandExists,
  isAllowedCommand,
} from "./cli-registry.js";

/**
 * Kill a process and all its descendants.
 * node-pty's kill() only sends a signal to the shell, but child processes
 * (like `builder`) may be in their own process group and survive as orphans.
 */
function killProcessTree(pid: number, logPrefix: string): void {
  if (os.platform() === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } catch {}
    return;
  }

  // Find all descendant PIDs (children, grandchildren, etc.)
  const descendants: number[] = [];
  function findDescendants(parentPid: number) {
    try {
      const output = execSync(`pgrep -P ${parentPid}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
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
    process.kill(pid, "SIGTERM");
  } catch {}

  // Force-kill any survivors after a short delay
  setTimeout(() => {
    for (const childPid of descendants) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
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
  /** Log prefix for console output. Defaults to '[terminal]' */
  logPrefix?: string;
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
    logPrefix = "[terminal]",
  } = options;

  // Dynamic imports for optional native dependencies
  const { WebSocketServer, WebSocket } = await import("ws");
  const pty = await import("node-pty");

  const resolvedAppDir = path.resolve(appDir);
  const shell =
    os.platform() === "win32" ? "cmd.exe" : process.env.SHELL || "/bin/zsh";

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

  // Handle WebSocket upgrades with optional auth
  server.on("upgrade", async (req, socket, head) => {
    if (authCheck) {
      try {
        const allowed = await authCheck(req);
        if (!allowed) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // Track active PTY processes for cleanup
  const activePtys = new Set<ReturnType<typeof pty.spawn>>();

  wss.on("connection", (ws: InstanceType<typeof WebSocket>, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const command = url.searchParams.get("command") || defaultCommand;
    const extraFlags = url.searchParams.get("flags") || "";
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

    // Check if CLI is installed; if not, use npx to run it
    let useNpx = false;
    if (!commandExists(command)) {
      const registry = CLI_REGISTRY[command];
      if (registry?.installPackage) {
        console.log(`${logPrefix} ${command} CLI not found, will use npx`);
        useNpx = true;
      } else {
        sendStatus(
          "not-found",
          `"${command}" not found on PATH. Please install it manually.`,
        );
        if (ws.readyState === WebSocket.OPEN) ws.close();
        return;
      }
    }

    // Build the command — use npx if CLI not found locally
    const baseCommand = useNpx
      ? `npx --yes ${CLI_REGISTRY[command].installPackage}`
      : command;
    const fullCommand = extraFlags
      ? `${baseCommand} ${extraFlags}`
      : baseCommand;
    console.log(`${logPrefix} Spawning PTY: ${fullCommand}`);

    // Build env, stripping CLI-specific nesting vars
    const registry = CLI_REGISTRY[command];
    const env: Record<string, string | undefined> = {
      ...process.env,
      TERM: "xterm-256color",
    };
    if (registry) {
      for (const v of registry.stripEnv) delete env[v];
    }

    let ptyProcess: ReturnType<typeof pty.spawn>;
    try {
      ptyProcess = pty.spawn(shell, ["-l", "-c", fullCommand], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: resolvedAppDir,
        env: env as Record<string, string>,
      });
    } catch (err) {
      console.error(`${logPrefix} Failed to spawn PTY:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          `\r\n\x1b[31m${logPrefix} Failed to spawn PTY: ${err}\x1b[0m\r\n`,
        );
        ws.close();
      }
      return;
    }

    activePtys.add(ptyProcess);
    console.log(`${logPrefix} PTY spawned (pid: ${ptyProcess.pid})`);

    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`${logPrefix} PTY exited with code ${exitCode}`);
      activePtys.delete(ptyProcess);
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

    ws.on("message", (data: Buffer | string) => {
      const str = typeof data === "string" ? data : data.toString();

      try {
        const msg = JSON.parse(str);

        if (
          msg.type === "builder.setEnvVars" &&
          Array.isArray(msg.data?.vars)
        ) {
          const envPath = path.join(resolvedAppDir, ".env");
          const vars: Array<{ key: string; value: string }> = msg.data.vars;

          // Validate env var names and sanitize values
          const validKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
          const sanitizedVars = vars.filter(({ key }) => {
            if (!validKeyPattern.test(key)) {
              console.warn(`${logPrefix} Rejected invalid env var key: ${key}`);
              return false;
            }
            return true;
          });

          let lines: string[] = [];
          try {
            lines = fs.readFileSync(envPath, "utf-8").split("\n");
          } catch {}

          for (const { key, value } of sanitizedVars) {
            // Strip newlines/null bytes to prevent line injection
            const safeValue = value.replace(/[\r\n\0]/g, "");
            // Quote values containing #, spaces, or quotes so dotenv parses correctly
            const needsQuoting = /[# "']/.test(safeValue);
            const quotedValue = needsQuoting
              ? `"${safeValue.replace(/"/g, '\\"')}"`
              : safeValue;
            const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
            const entry = `${key}=${quotedValue}`;
            if (idx !== -1) {
              lines[idx] = entry;
            } else {
              lines.push(entry);
            }
          }

          while (lines.length > 0 && lines[lines.length - 1] === "") {
            lines.pop();
          }
          fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "env-vars-saved",
                keys: sanitizedVars.map((v) => v.key),
              }),
            );
          }
          return;
        }

        if (msg.type === "resize" && msg.cols && msg.rows) {
          ptyProcess.resize(msg.cols, msg.rows);
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
      activePtys.delete(ptyProcess);
      killProcessTree(ptyProcess.pid, logPrefix);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(
        `${logPrefix} PTY WebSocket server on ws://localhost:${actualPort}/ws`,
      );

      resolve({
        server,
        port: actualPort,
        close: () => {
          for (const p of activePtys) {
            killProcessTree(p.pid, logPrefix);
          }
          activePtys.clear();
          wss.close();
          server.close();
        },
      });
    });
  });
}
