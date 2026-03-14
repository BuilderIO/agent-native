import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { execSync, execFile } from "child_process";
import * as pty from "node-pty";
import os from "os";
import path from "path";
import fs from "fs";

import {
  withChatLock,
  snapshotDataDir,
  diffSnapshots,
  buildCliArgs,
  ASYNC_SYSTEM_PROMPT,
  type DataSnapshot,
} from "./utils.js";

// Known CLI tools and their install packages + env vars to strip
const CLI_REGISTRY: Record<
  string,
  { installPackage: string; stripEnv: string[] }
> = {
  claude: {
    installPackage: "@anthropic-ai/claude-code",
    stripEnv: ["CLAUDECODE", "CLAUDE_CODE_SESSION"],
  },
  codex: {
    installPackage: "@openai/codex",
    stripEnv: [],
  },
  gemini: {
    installPackage: "@google/gemini-cli",
    stripEnv: [],
  },
  opencode: {
    installPackage: "opencode-ai",
    stripEnv: [],
  },
};

// Parse CLI args
function parseArgs(args: string[]): {
  appDir: string;
  appPort: number;
  port: number;
  command: string;
} {
  const result = {
    appDir: ".",
    appPort: 8080,
    port: 3333,
    command: "claude",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--app-dir":
        result.appDir = args[++i];
        break;
      case "--app-port":
        result.appPort = parseInt(args[++i], 10);
        break;
      case "--port":
        result.port = parseInt(args[++i], 10);
        break;
      case "--command":
        result.command = args[++i];
        break;
    }
  }

  return result;
}

const config = parseArgs(process.argv.slice(2));
const appDir = path.resolve(config.appDir);
const shell =
  os.platform() === "win32" ? "cmd.exe" : process.env.SHELL || "/bin/zsh";

// Read app package.json for name
let appName = path.basename(appDir);
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(appDir, "package.json"), "utf-8"),
  );
  if (pkg.name) appName = pkg.name.replace(/^@[^/]+\//, "");
} catch {}

function execCli(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        env: env as Record<string, string>,
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for all responses
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/api/app-info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: appName, dir: appDir }));
      return;
    }

    if (req.url === "/api/chat" && req.method === "POST") {
      let body: { message: string; context?: string };
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      if (!body.message || typeof body.message !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "message field is required" }));
        return;
      }

      const command = config.command;

      // Check CLI is installed; if not, use npx
      let effectiveCommand = command;
      if (!commandExists(command)) {
        const registry = CLI_REGISTRY[command];
        if (registry?.installPackage) {
          effectiveCommand = `npx --yes ${registry.installPackage}`;
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: `CLI "${command}" not found on PATH` }),
          );
          return;
        }
      }

      try {
        const result = await withChatLock(async () => {
          const dataDir = path.join(appDir, "data");
          const beforeSnap = snapshotDataDir(dataDir);

          // Build env, stripping CLI-specific vars
          const registry = CLI_REGISTRY[command];
          const env: Record<string, string | undefined> = { ...process.env };
          if (registry) {
            for (const v of registry.stripEnv) delete env[v];
          }

          const cliArgs = buildCliArgs(command, body.message, body.context);
          // If using npx, split the effective command and prepend to args
          const effectiveParts = effectiveCommand.split(" ");
          const execCommand = effectiveParts[0];
          const args = [...effectiveParts.slice(1), ...cliArgs];
          const response = await execCli(execCommand, args, appDir, env);

          const afterSnap = snapshotDataDir(dataDir);
          const filesChanged = diffSnapshots(beforeSnap, afterSnap, dataDir);

          // Enforcement: check for changes outside data/ using git if available
          const warnings: string[] = [];
          try {
            const gitDiff = execSync("git diff --name-only", {
              cwd: appDir,
              encoding: "utf-8",
              timeout: 5000,
            }).trim();
            if (gitDiff) {
              for (const file of gitDiff.split("\n")) {
                if (!file.startsWith("data/")) {
                  warnings.push(`Reverted unauthorized change to: ${file}`);
                  try {
                    execSync(`git checkout -- "${file}"`, {
                      cwd: appDir,
                      stdio: "pipe",
                      timeout: 5000,
                    });
                  } catch {}
                }
              }
            }
          } catch {
            // Not a git repo or git not available — skip enforcement
          }

          return {
            response: response.trim(),
            filesChanged,
            ...(warnings.length > 0 ? { warnings } : {}),
          };
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: err.message || "CLI invocation failed" }),
        );
      }
      return;
    }

    res.writeHead(404);
    res.end();
  },
);
const wss = new WebSocketServer({ server });

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// WebSocket handling — each connection gets a PTY
wss.on("connection", async (ws: WebSocket, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const command = url.searchParams.get("command") || config.command;
  const extraFlags = url.searchParams.get("flags") || "";
  console.log("[harness] WebSocket connected for command:", command);

  // Check if CLI is installed; if not, use npx to run it
  let useNpx = false;
  if (!commandExists(command)) {
    const registry = CLI_REGISTRY[command];
    if (registry?.installPackage) {
      console.log(`[harness] ${command} CLI not found, will use npx`);
      useNpx = true;
    } else {
      const sendStatus = (status: string, message: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "setup-status", status, message }));
        }
      };
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
  const fullCommand = extraFlags ? `${baseCommand} ${extraFlags}` : baseCommand;
  console.log("[harness] Spawning PTY:", fullCommand);

  // Build env, stripping CLI-specific nesting vars
  const registry = CLI_REGISTRY[command];
  const env: Record<string, string | undefined> = {
    ...process.env,
    TERM: "xterm-256color",
  };
  if (registry) {
    for (const v of registry.stripEnv) delete env[v];
  }

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, ["-l", "-c", fullCommand], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: appDir,
      env: env as Record<string, string>,
    });
  } catch (err) {
    console.error("[harness] Failed to spawn PTY:", err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\n\x1b[31m[harness] Failed to spawn PTY: ${err}\x1b[0m\r\n`);
      ws.close();
    }
    return;
  }

  console.log(`[harness] PTY spawned (pid: ${ptyProcess.pid})`);

  ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[harness] PTY exited with code ${exitCode}`);
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

      if (msg.type === "builder.setEnvVars" && Array.isArray(msg.data?.vars)) {
        const envPath = path.join(appDir, ".env");
        const vars: Array<{ key: string; value: string }> = msg.data.vars;

        let lines: string[] = [];
        try {
          lines = fs.readFileSync(envPath, "utf-8").split("\n");
        } catch {}

        for (const { key, value } of vars) {
          const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
          const entry = `${key}=${value}`;
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
              keys: vars.map((v) => v.key),
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
    console.log("[harness] WebSocket closed, killing PTY");
    ptyProcess.kill();
  });
});

server.listen(config.port, () => {
  console.log(`[harness] WebSocket server on ws://localhost:${config.port}/ws`);
  console.log(`[harness] App dir: ${appDir}`);
  console.log(`[harness] Default command: ${config.command}`);
});
