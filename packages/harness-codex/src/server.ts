import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { execSync } from 'child_process';
import * as pty from 'node-pty';
import os from 'os';
import path from 'path';
import fs from 'fs';

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
    command: 'codex',
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
  if (pkg.name) appName = pkg.name.replace(/^@[^/]+\//, ''); // strip scope
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

// Check if a command exists on PATH
function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Install codex and notify client via WebSocket
async function installCodex(ws: WebSocket): Promise<boolean> {
  const sendStatus = (status: string, message: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'setup-status', status, message }));
    }
  };

  sendStatus('installing', 'Installing Codex CLI...');

  try {
    execSync('npm install -g @openai/codex', {
      stdio: 'pipe',
      timeout: 120000,
    });

    if (commandExists('codex')) {
      sendStatus('installed', 'Codex CLI installed successfully!');
      return true;
    }
  } catch (err) {
    console.error('[harness] npm install failed:', err);
  }

  sendStatus('failed', 'Failed to install Codex CLI. Please install it manually: npm install -g @openai/codex');
  return false;
}

// WebSocket handling — each connection gets a PTY
wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const extraFlags = url.searchParams.get('flags') || '';
  const fullCommand = extraFlags ? `${config.command} ${extraFlags}` : config.command;
  console.log('[harness] WebSocket connected, spawning PTY:', fullCommand);

  // Check if codex is installed; if not, try to install it
  if (config.command === 'codex' && !commandExists('codex')) {
    console.log('[harness] Codex CLI not found, attempting install...');
    const installed = await installCodex(ws);
    if (!installed) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
      return;
    }
  }

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, ['-l', '-c', fullCommand], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: appDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      } as Record<string, string>,
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
        message: `Command "${config.command}" not found. Please install it first.`,
      }));
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (data: Buffer | string) => {
    const str = typeof data === 'string' ? data : data.toString();

    // Handle JSON control messages from the client
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
  console.log(`[harness] Command: ${config.command}`);
});
