import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { execSync } from 'child_process';
import * as pty from 'node-pty';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Known CLI tools and their install packages + env vars to strip
const CLI_REGISTRY: Record<string, { installPackage: string; stripEnv: string[] }> = {
  claude: {
    installPackage: '@anthropic-ai/claude-code',
    stripEnv: ['CLAUDECODE', 'CLAUDE_CODE_SESSION'],
  },
  codex: {
    installPackage: '@openai/codex',
    stripEnv: [],
  },
  gemini: {
    installPackage: '@google/gemini-cli',
    stripEnv: [],
  },
  opencode: {
    installPackage: 'opencode',
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
    appDir: '.',
    appPort: 8080,
    port: 3333,
    command: 'claude',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--app-dir':
        result.appDir = args[++i];
        break;
      case '--app-port':
        result.appPort = parseInt(args[++i], 10);
        break;
      case '--port':
        result.port = parseInt(args[++i], 10);
        break;
      case '--command':
        result.command = args[++i];
        break;
    }
  }

  return result;
}

const config = parseArgs(process.argv.slice(2));
const appDir = path.resolve(config.appDir);
const shell = os.platform() === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/zsh';

// Read app package.json for name
let appName = path.basename(appDir);
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'));
  if (pkg.name) appName = pkg.name.replace(/^@[^/]+\//, '');
} catch {}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/api/app-info') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ name: appName, dir: appDir }));
    return;
  }
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server });

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function installCLI(ws: WebSocket, command: string, installPackage: string): Promise<boolean> {
  const sendStatus = (status: string, message: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'setup-status', status, message }));
    }
  };

  sendStatus('installing', `Installing ${command} CLI...`);

  try {
    execSync(`npm install -g ${installPackage}`, {
      stdio: 'pipe',
      timeout: 120000,
    });

    if (commandExists(command)) {
      sendStatus('installed', `${command} CLI installed successfully!`);
      return true;
    }
  } catch (err) {
    console.error('[harness] npm install failed:', err);
  }

  sendStatus('failed', `Failed to install ${command} CLI. Please install it manually: npm install -g ${installPackage}`);
  return false;
}

// WebSocket handling — each connection gets a PTY
wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const command = url.searchParams.get('command') || config.command;
  const extraFlags = url.searchParams.get('flags') || '';
  const fullCommand = extraFlags ? `${command} ${extraFlags}` : command;
  console.log('[harness] WebSocket connected, spawning PTY:', fullCommand);

  // Check if CLI is installed; if not, try to install it
  if (!commandExists(command)) {
    const registry = CLI_REGISTRY[command];
    if (registry) {
      console.log(`[harness] ${command} CLI not found, attempting install...`);
      const installed = await installCLI(ws, command, registry.installPackage);
      if (!installed) {
        if (ws.readyState === WebSocket.OPEN) ws.close();
        return;
      }
    }
  }

  // Build env, stripping CLI-specific nesting vars
  const registry = CLI_REGISTRY[command];
  const env: Record<string, string | undefined> = { ...process.env, TERM: 'xterm-256color' };
  if (registry) {
    for (const v of registry.stripEnv) delete env[v];
  }

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, ['-l', '-c', fullCommand], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: appDir,
      env: env as Record<string, string>,
    });
  } catch (err) {
    console.error('[harness] Failed to spawn PTY:', err);
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
      ws.send(JSON.stringify({
        type: 'setup-status',
        status: 'not-found',
        message: `Command "${command}" not found. Please install it first.`,
      }));
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (data: Buffer | string) => {
    const str = typeof data === 'string' ? data : data.toString();

    try {
      const msg = JSON.parse(str);

      if (msg.type === 'builder.setEnvVars' && Array.isArray(msg.data?.vars)) {
        const envPath = path.join(appDir, '.env');
        const vars: Array<{ key: string; value: string }> = msg.data.vars;

        let lines: string[] = [];
        try {
          lines = fs.readFileSync(envPath, 'utf-8').split('\n');
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

        while (lines.length > 0 && lines[lines.length - 1] === '') {
          lines.pop();
        }
        fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'env-vars-saved',
            keys: vars.map((v) => v.key),
          }));
        }
        return;
      }

      if (msg.type === 'resize' && msg.cols && msg.rows) {
        ptyProcess.resize(msg.cols, msg.rows);
        return;
      }
    } catch {
      // Not JSON — regular terminal input
    }

    ptyProcess.write(str);
  });

  ws.on('close', () => {
    console.log('[harness] WebSocket closed, killing PTY');
    ptyProcess.kill();
  });
});

server.listen(config.port, () => {
  console.log(`[harness] WebSocket server on ws://localhost:${config.port}/ws`);
  console.log(`[harness] App dir: ${appDir}`);
  console.log(`[harness] Default command: ${config.command}`);
});
